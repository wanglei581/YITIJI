/** 服务端计时门禁：真实 TrtcService/Redis registry，腾讯 fetch 与 Redis 传输用桩。 */
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { Redis } from 'ioredis'
import { randomUUID } from 'node:crypto'
import { TrtcService } from '../src/trtc/trtc.service'
import { TrtcSessionRegistry, readTrtcMaxSessionSeconds } from '../src/trtc/trtc-session-registry.service'

// 桩仅模拟 Redis 命令的存储效果，不替代被测服务的创建、计时、扫描、停止与恢复路径。
class MemoryRedis {
  values = new Map<string, string>()
  scores = new Map<string, number>()
  failWrites = false
  async get(key: string) { return this.values.get(key) ?? null }
  async set(key: string, value: string, ...args: unknown[]) {
    if (this.failWrites) throw new Error('redis down')
    if (args.includes('NX') && this.values.has(key)) return null
    this.values.set(key, value); return 'OK'
  }
  async zrangebyscore(_key: string, _min: unknown, max: number) {
    return [...this.scores].filter(([, score]) => score <= max).sort((a, b) => a[1] - b[1]).slice(0, 100).map(([id]) => id)
  }
  async zadd(_key: string, _xx: string, score: number, id: string) {
    if (this.scores.has(id)) this.scores.set(id, score)
  }
  async eval(script: string, count: number, ...args: (string | number)[]) {
    if (this.failWrites) throw new Error('redis down')
    const keys = args.slice(0, count).map(String), argv = args.slice(count).map(String)
    if (script.includes('session already exists')) {
      assert.ok(!this.values.has(keys[0]))
      this.values.set(keys[0], argv[0]); this.scores.set(argv[2], Number(argv[1]))
    } else if (script.includes('item.taskId')) {
      const record = JSON.parse(this.values.get(keys[0])!)
      assert.equal(record.stopped, false)
      record.taskId = argv[0]; this.values.set(keys[0], JSON.stringify(record)); this.values.set(keys[1], argv[1])
    } else if (script.includes('ZREM')) {
      this.values.set(keys[0], argv[0]); this.scores.delete(argv[1])
    } else if (this.values.get(keys[0]) === argv[0]) this.values.delete(keys[0])
    return 1
  }
}

async function main() {
  for (const value of [undefined, '', 'bad', '0', '-1', 'Infinity', '0.5', '31']) {
    assert.equal(readTrtcMaxSessionSeconds(value ?? ''), 600, `非法配置 ${value} 回落 10 分钟`)
  }
  assert.equal(readTrtcMaxSessionSeconds('1'), 60)
  assert.equal(readTrtcMaxSessionSeconds('30'), 1800)
  Object.assign(process.env, {
    TRTC_SDK_APP_ID: '1400000000', TRTC_SDK_SECRET_KEY: 'test', TENCENT_SECRET_ID: 'test',
    TENCENT_SECRET_KEY: 'test', TRTC_LLM_API_KEY: 'test', TRTC_TTS_APP_ID: '1300000000',
    TRTC_MAX_SESSION_MINUTES: '1', AI_ENDPOINT_ALLOWLIST: 'api.deepseek.com,trtc.tencentcloudapi.com',
  })
  const realFetch = globalThis.fetch, realNow = Date.now
  let now = 1_790_000_000_000, nextTask = 0, stopFailure = false, startLost = false
  const starts: Record<string, unknown>[] = [], stops: string[] = []
  const tasks = new Map<string, string>()
  const redis = new MemoryRedis()
  const make = () => new TrtcService(new TrtcSessionRegistry(redis as unknown as Redis))
  Date.now = () => now
  globalThis.fetch = async (_url, init) => {
    const action = (init?.headers as Record<string, string>)['X-TC-Action']
    const payload = JSON.parse(String(init?.body))
    if (action === 'StartAIConversation') {
      starts.push(payload)
      const task = `task-${++nextTask}`
      tasks.set(payload.SessionId, task)
      if (startLost) throw new Error('response lost after cloud start')
      return Response.json({ Response: { TaskId: task } })
    }
    if (action === 'DescribeAIConversation') {
      const task = tasks.get(payload.SessionId)
      return Response.json({ Response: task ? { TaskId: task } : { Error: { Code: 'FailedOperation.TaskNotExist', Message: 'stopped' } } })
    }
    assert.equal(action, 'StopAIConversation')
    if (stopFailure) throw new Error('stop unavailable')
    stops.push(payload.TaskId)
    return Response.json({ Response: {} })
  }
  let service = make()
  try {
    const first = await service.startSession('user-1')
    assert.equal(first.maxSessionSeconds, 60)
    assert.equal(Date.parse(first.expiresAt), now + 60_000)
    const sig = JSON.parse(inflateSync(Buffer.from(first.userSig.replace(/\*/g, '+').replace(/-/g, '/').replace(/_/g, '='), 'base64')).toString())
    assert.equal(sig['TLS.expire'], 90, 'UserSig 不超过上限 + 30 秒')
    now += 59_000
    await service.expireSessions()
    assert.equal(stops.length, 0, '截止前不提前停止')
    now += 1_000
    await service.expireSessions()
    assert.deepEqual(stops, [first.taskId], '没有任何客户端请求，服务端到点调用 StopAIConversation')
    await service.stopSession(first.taskId)
    await service.stopSession(first.taskId)
    assert.equal(stops.length, 1, '已到期会话重复 stop 幂等，无续期')
    const second = await service.startSession('user-1')
    assert.notEqual(second.roomId, first.roomId)
    assert.equal(starts.length, 2, '同一用户再开就是一次新的云会话')
    const deadline = second.expiresAt
    service.onModuleDestroy()
    now += 61_000
    service = make() // 仅进程对象更换，Redis 记录保留。
    service.onModuleInit()
    await new Promise(resolve => setTimeout(resolve, 10))
    service.onModuleDestroy()
    assert.ok(stops.includes(second.taskId), 'API 重启后初始化扫描补停到期任务')
    assert.equal(deadline, second.expiresAt, '重启不改截止时间')
    const third = await service.startSession('user-1')
    now += 60_000; stopFailure = true
    await service.expireSessions()
    assert.ok(redis.scores.size > 0, '停止失败不得丢失重试责任')
    stopFailure = false; now += 5_000
    await service.expireSessions()
    assert.ok(stops.includes(third.taskId), '停止失败后恢复仍补停')
    startLost = true
    await assert.rejects(() => service.startSession('user-1'))
    startLost = false; now += 61_000
    await service.expireSessions()
    assert.ok(stops.includes('task-4'), 'Start 响应丢失时通过 SessionId 找回任务并停止')
    redis.failWrites = true
    const before = starts.length
    await assert.rejects(() => service.startSession('user-1'))
    assert.equal(starts.length, before, 'Redis 不可用时不创建计费会话')
    console.log('PASS TRTC 配置回落、服务端到期、重启补停、幂等停止、停止重试、丢响应恢复、Redis fail-closed')
  } finally {
    service.onModuleDestroy(); globalThis.fetch = realFetch; Date.now = realNow
  }
}
async function verifyRealRedis() {
  // 这一段只碰 Redis、不碰数据库；CI 这一步不带 VERIFICATION_DATABASE_TARGET，只校验 Redis 是本机隔离实例。
  assert.match(process.env.REDIS_URL ?? '', /^redis:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/\d+)?$/, '只允许本机隔离 Redis（CI 的 redis 服务或本地临时实例）')
  const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 1500, maxRetriesPerRequest: 0, retryStrategy: () => null })
  redis.on('error', () => undefined)
  const registry = new TrtcSessionRegistry(redis)
  const sessionId = `verify-${randomUUID()}`, taskId = `verify-${randomUUID()}`
  const record = { sessionId, taskId: null, sdkAppId: 1, region: 'ap-guangzhou', startedAt: Date.now(), expiresAt: Date.now() + 60_000, stopped: false }
  try {
    await redis.connect()
    await registry.reserve(record)
    await registry.activate(record, taskId)
    assert.equal(await registry.sessionForTask(taskId), sessionId)
    assert.equal(await redis.ttl(`trtc:deadline:session:${sessionId}`), -1, '活跃记录不因到期 TTL 丢失停止责任')
    const due = await registry.due(record.expiresAt)
    assert.equal(due.find(item => item.sessionId === sessionId)?.expiresAt, record.expiresAt)
    let stopped = 0
    await registry.finish(sessionId, async () => { stopped++ })
    await registry.finish(sessionId, async () => { stopped++ })
    assert.equal(stopped, 1, '真实 Redis Lua 的幂等停止')
    assert.ok(await redis.ttl(`trtc:deadline:session:${sessionId}`) > 0, '停止后仅保留一天幂等记录')
    assert.ok(!(await registry.due(record.expiresAt)).some(item => item.sessionId === sessionId))
    // 孤儿索引：记录已不在的索引项会在扫描时被清掉。
    const orphanId = `verify-orphan-${randomUUID()}`
    await redis.zadd('trtc:deadline:index', 1, orphanId)
    await registry.due(Date.now())
    assert.equal(await redis.zscore('trtc:deadline:index', orphanId), null, '孤儿索引被清理')
    // 抢锁失败（另一方正在停）：直接返回、不调停止、不抛错。
    const busyId = `verify-busy-${randomUUID()}`
    await registry.reserve({ ...record, sessionId: busyId, taskId: null })
    await redis.set(`trtc:deadline:session:${busyId}:lock`, 'other', 'PX', 30_000)
    let busyStops = 0
    await registry.finish(busyId, async () => { busyStops++ })
    assert.equal(busyStops, 0, '锁被占时不重复停止')
    await redis.del(`trtc:deadline:session:${busyId}`, `trtc:deadline:session:${busyId}:lock`)
    await redis.zrem('trtc:deadline:index', busyId)
    console.log('PASS TRTC 真 Redis Lua：原子预写、截止不续期、幂等停止、索引清理、孤儿索引清理、抢锁不重复停')
  } finally {
    if (redis.status === 'ready') {
      await redis.del(`trtc:deadline:session:${sessionId}`, `trtc:deadline:task:${taskId}`, `trtc:deadline:session:${sessionId}:lock`)
      await redis.zrem('trtc:deadline:index', sessionId)
    }
    redis.disconnect()
  }
}
(process.argv.includes('--redis') ? verifyRealRedis() : main()).catch(error => { console.error(error); process.exitCode = 1 })
