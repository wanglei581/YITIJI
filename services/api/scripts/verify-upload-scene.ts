import 'reflect-metadata'

/**
 * verify:upload-scene —— 扫码上传的小程序场景码。
 *
 * 背景：一体机原先的扫码上传二维码编的是**网页地址**，里面直接带 sessionId +
 * uploadToken。产品负责人 2026-09-08 要求「微信扫码直接打开小程序，而不是一个网页」。
 * 微信 scene 上限 32 字符，塞不下会话凭据，所以扫码只能带一个短的不透明码，
 * 由服务端换回上传凭据。
 *
 * 这条门禁跑**真实 RedisService**（有 REDIS_URL 打真实例，没有就打进程内 RESP 桩），不是
 * 自己写的假对象 —— 兑换在上传锁内重读会话、按条件写回，用假对象验等于验自己写的那份实现。
 *
 * 钉住四件事：
 * ① 明文永不落库：Redis 里存的是 sha256，不是 scene 本身；
 * ② 会话有效期内可重复兑换（2026-10-29 起，原因见 upload-scene.ts ②）：同一张码每次拿到
 *    同一把派生令牌，两次兑换之间谁先上传都只成功一次；
 * ③ 首次兑换换掉 create 下发的令牌：那把随之作废，之后再兑换不再写会话；
 * ④ 失败路径不当预言机：格式错/查无此码/改错一个字/已收到文件/已过期/已作废，对外是同一个错误码。
 */
import { spawn } from 'node:child_process'
import { createHash, createHmac } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Redis } from 'ioredis'
import { RedisService, UPLOAD_SESSION_PHASE_UNCHECKED } from '../src/common/redis/redis.service'
import { UploadSessionsService } from '../src/upload-sessions/upload-sessions.service'
import { isWellFormedSceneToken, sceneIndexKey } from '../src/upload-sessions/upload-scene'
import { startInMemoryRedis } from './support/inmemory-redis-server'

const results: Array<{ name: string; ok: boolean }> = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push({ name, ok })
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`)
}
async function errorCodeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return '<no-error>'
  } catch (e) {
    const body = (e as { response?: { error?: { code?: string } } }).response
    return body?.error?.code ?? `<${(e as Error).name}>`
  }
}

/** 与 services/api/src/miniapp-code/miniapp-code.service.ts 的 SCENE_PATTERN 同源。 */
const WECHAT_SCENE_PATTERN = /^[A-Za-z0-9!#$&'()*+,/:;=?@\-._~%]{1,32}$/

async function main(): Promise<void> {
  // 派生令牌用文件签名密钥（CI 的作业环境里有）；单跑本脚本时给一把测试值，取不到会直接报错。
  process.env['FILE_SIGNING_SECRET'] ||= 'verify-upload-scene-signing-secret-0123456789'
  // 有真 Redis 就用真的（CI 里一定有）。桩只是「本机没有 Redis」时的退路 ——
  // 桩不实现有序集合和 Lua，下面要就地补语义，而每一处补语义都是一次「验的是我自己
  // 写的那份实现」的风险。所以真 Redis 优先，桩降级，并在输出里如实标注跑的是哪一种。
  const externalRedisUrl = process.env['REDIS_URL']
  const server = externalRedisUrl ? null : await startInMemoryRedis()
  const client = new Redis(externalRedisUrl ?? (server as { url: string }).url, { maxRetriesPerRequest: 2 })
  console.log(`  （Redis：${externalRedisUrl ? '真实实例' : '进程内 RESP 桩'}）`)
  if (!externalRedisUrl) {
    // 以下补丁**只在桩上生效**，真 Redis 路径一个都不打。
    Object.assign(client, {
      // 桩不实现有序集合，而会话的过期索引用的正是 ZADD/ZRANGEBYSCORE。
      // 那条链路不在本门禁范围内（由 verify:upload-sessions 覆盖）。
      zadd: async () => 1,
      zrangebyscore: async () => [] as string[],
      zrem: async () => 1,
      /**
       * 桩刻意不实现 Lua（见 support/inmemory-redis-server.ts 的边界说明），
       * 而 `RedisService.setExistingWithCurrentTtl` 正是一段 4 行 Lua：
       * 「取 TTL；TTL<=0 就不写；否则按原 TTL SET 回去」。
       * 这里用 TTL + SETEX 忠实复刻它的语义 —— 兑换时那次**写入是真的发生的**。
       */
      eval: async (script: string, numKeys: number, ...rest: string[]) => {
        const keyCount = Number(numKeys)
        const keys = rest.slice(0, keyCount)
        const args = rest.slice(keyCount)
        // compareAndSetSession：锁、状态、无文件、TTL 同一次判断后才写。
        if (script.includes('UPLOAD_SESSION_COMMIT')) {
          const sessionKey = keys[0] ?? ''
          const lockKey = keys[1] ?? ''
          const [lockToken, nextValue, expectedStatus, expectedFile, expectedPhase, cleanupValue, cleanupTtl, indexScore, indexMember] = args
          const ttl = await client.ttl(sessionKey)
          if (ttl <= 0) return 0
          if ((await client.get(lockKey)) !== lockToken) return -1
          const raw = await client.get(sessionKey)
          if (!raw) return 0
          const session = JSON.parse(raw) as {
            status?: string
            file?: { fileId?: string } | null
            bind?: { phase?: string } | null
          }
          const actualId = session.file?.fileId ?? null
          if (session.status !== expectedStatus) return -2
          if (!expectedFile) {
            if (actualId) return -2
          } else if (actualId !== expectedFile) {
            return -2
          }
          if (expectedPhase !== undefined && expectedPhase !== UPLOAD_SESSION_PHASE_UNCHECKED) {
            const actualPhase = session.bind?.phase ?? ''
            if (expectedPhase === '' ? Boolean(actualPhase) : actualPhase !== expectedPhase) return -2
          }
          const cleanupKey = keys[2]
          let parsedCleanupTtl = 0
          if (cleanupKey && cleanupValue) {
            parsedCleanupTtl = Number(cleanupTtl)
            if (!Number.isFinite(parsedCleanupTtl) || parsedCleanupTtl <= 0) return -2
          }
          await client.setex(sessionKey, ttl, nextValue ?? '')
          if (cleanupKey && cleanupValue && parsedCleanupTtl > 0) {
            await client.setex(cleanupKey, parsedCleanupTtl, cleanupValue)
            if (keys[3] && indexMember) await client.zadd(keys[3], indexScore ?? '0', indexMember)
          }
          return 1
        }
        const key = keys[0] ?? ''
        const value = args[0] ?? ''
        // getAndDelIfEquals：值相等才删。上传锁释放走这条，不能误当成 SETEX。
        if (script.includes('redis.call(\'DEL\'')) {
          const current = await client.get(key)
          if (current === null) return 0
          if (current !== value) return -1
          await client.del(key)
          return 1
        }
        const ttl = await client.ttl(key)
        if (ttl <= 0) return 0
        await client.setex(key, ttl, value)
        return 1
      },
    })
  }
  const redis = new RedisService(client as never)
  {
    await client.setex('upload_session:atomic', 60, JSON.stringify({ status: 'uploaded', file: { fileId: 'file_atomic' } }))
    await client.setex('upload_session_upload_lock:atomic', 30, 'token-1')
    const wrote = await redis.compareAndSetSession(
      'upload_session:atomic',
      'upload_session_upload_lock:atomic',
      'token-1',
      JSON.stringify({ status: 'uploaded', file: { fileId: 'file_atomic' }, bind: { phase: 'intent', fileId: 'file_atomic' } }),
      'uploaded',
      'file_atomic',
      '',
      {
        key: 'upload_session_cleanup:atomic',
        value: JSON.stringify({ file: { fileId: 'file_atomic' }, bind: { phase: 'intent' } }),
        ttlSeconds: 60,
        indexKey: 'upload_session_expiry_index',
        indexScore: 1,
        indexMember: 'atomic',
      },
    )
    const mirrored = await client.get('upload_session_cleanup:atomic')
    const sessionRaw = await client.get('upload_session:atomic')
    check(
      '会员确认意图同一次写入会话和清理记录',
      wrote === 'updated' && Boolean(mirrored?.includes('file_atomic') && mirrored.includes('intent') && sessionRaw?.includes('intent')),
    )
    await client.del('upload_session:atomic', 'upload_session_upload_lock:atomic', 'upload_session_cleanup:atomic')
  }
  // 上传只需要一个落地桩：门禁验的是会话与令牌，不是文件服务。
  let stubFiles = 0
  const filesStub = {
    upload: async (args: { buffer: Buffer; filename: string; mimeType: string }) => ({
      fileId: `scene_stub_${++stubFiles}`,
      filename: args.filename,
      sizeBytes: args.buffer.length,
      mimeType: args.mimeType,
      sha256: 'a'.repeat(64),
      fileExpiresAt: null,
    }),
  }
  const service = new UploadSessionsService(redis as never, null as never, filesStub as never)
  const fakeFile = { buffer: Buffer.from('x'), originalname: 'a.pdf', mimetype: 'application/pdf', size: 1 }
  const newSession = () => service.create({ purpose: 'print_doc', mode: 'temporary', channel: 'phone_h5', uploadUrl: '/m/upload' })
  const upload = (sessionId: string, uploadToken: string) =>
    errorCodeOf(() => service.uploadFile({ sessionId, uploadToken, file: fakeFile as never }))

  const created = await service.create({
    purpose: 'print_doc',
    mode: 'temporary',
    channel: 'phone_h5',
    uploadUrl: '/m/upload',
  })

  // ── 一、码本身要能过微信那一关 ─────────────────────────────────────────
  check('创建返回 sceneToken', typeof created.sceneToken === 'string' && created.sceneToken.length > 0)
  check(
    'sceneToken 不超过微信 32 字符上限',
    created.sceneToken.length <= 32,
    `实际 ${created.sceneToken.length}`,
  )
  check(
    'sceneToken 落在微信允许的字符集内',
    WECHAT_SCENE_PATTERN.test(created.sceneToken),
    '否则 getwxacodeunlimit 会直接拒绝',
  )
  check(
    'sceneToken 与上传/控制令牌互不相同',
    created.sceneToken !== created.uploadToken && created.sceneToken !== created.controlToken,
  )

  // ── 二、明文永不落库 ──────────────────────────────────────────────────
  // 逐个键值扫，而不是只看会话记录 —— 索引键当初就是最容易顺手写成明文的地方。
  {
    // 桩只实现 SCAN 不实现 KEYS；SCAN 也更接近生产上该用的写法。
    const keys: string[] = []
    let cursor = '0'
    do {
      const [next, batch] = await client.scan(cursor, 'MATCH', 'upload_session*', 'COUNT', 200)
      keys.push(...batch)
      cursor = next
    } while (cursor !== '0')
    const values = await Promise.all(keys.map((k) => client.get(k).catch(() => null)))
    const plaintextHits = [...keys, ...values.filter((v): v is string => v !== null)].filter((s) =>
      s.includes(created.sceneToken),
    )
    check('Redis 里没有任何一处出现 scene 明文', plaintextHits.length === 0, plaintextHits.join(' | '))
    check(
      '索引键是 sha256(scene)',
      keys.includes(sceneIndexKey(created.sceneToken)),
      `期望键 ${sceneIndexKey(created.sceneToken).slice(0, 40)}…`,
    )
    const sessionRaw = await client.get(`upload_session:${created.sessionId}`)
    check(
      '会话记录里只有 sceneTokenHash',
      sessionRaw !== null
        && sessionRaw.includes(createHash('sha256').update(created.sceneToken).digest('hex'))
        && !sessionRaw.includes(created.sceneToken),
    )
  }

  // ── 三、兑换：拿得到能用的凭据，但拿不到控制凭据 ───────────────────────
  const redeemed = await service.resolveScene(created.sceneToken)
  check('兑换返回同一个 sessionId', redeemed.sessionId === created.sessionId)
  check('兑换返回 purpose 供手机端显示', redeemed.purpose === 'print_doc')
  check(
    '兑换不返回 controlToken（那是一体机侧凭据）',
    !Object.prototype.hasOwnProperty.call(redeemed, 'controlToken')
      && !JSON.stringify(redeemed).includes(created.controlToken),
  )
  check(
    '兑换发的不是 create 下发的那把令牌',
    redeemed.uploadToken.length > 0 && redeemed.uploadToken !== created.uploadToken,
    '复用旧令牌等于服务端存了明文',
  )
  check(
    '兑换令牌按规格派生：base64url(HMAC-SHA256(密钥, upload-scene-token:v1:sessionId:scene))',
    redeemed.uploadToken === createHmac('sha256', process.env['FILE_SIGNING_SECRET'] ?? '')
      .update(`upload-scene-token:v1:${created.sessionId}:${created.sceneToken}`)
      .digest('base64url'),
  )

  // ── 四、可重复兑换：同码同令牌；首次兑换才写会话，create 的原令牌随之作废 ──────────
  {
    const sessionKey = `upload_session:${created.sessionId}`
    const before = await client.get(sessionKey)
    const again = await service.resolveScene(created.sceneToken).catch(() => null)
    check(
      '同一张码二次兑换成功且令牌相同',
      again?.sessionId === created.sessionId && again?.uploadToken === redeemed.uploadToken,
      '一次性兑换会让码当场变死码：先被网页兑换再被小程序兑换、或同一人重扫都会失败',
    )
    check('二次兑换不再写会话（令牌哈希已相等）', (await client.get(sessionKey)) === before)
    // 再直查落盘的哈希：这条不依赖任何下游服务，坏了就是坏在换令牌本身。
    const raw = (await client.get(sessionKey)) as string
    const h = (s: string): string => createHash('sha256').update(s).digest('hex')
    check(
      '落盘的 uploadTokenHash 已换成派生令牌的哈希',
      raw.includes(h(redeemed.uploadToken)) && !raw.includes(h(created.uploadToken)),
      '没落盘等于没换',
    )
    const oldTokenCode = await upload(created.sessionId, created.uploadToken)
    check(
      'create 下发的原令牌在首次兑换后失效',
      oldTokenCode === 'UPLOAD_TOKEN_INVALID',
      `实际 ${oldTokenCode} —— 首次兑换必须把会话令牌换成派生令牌`,
    )
  }
  // 两次兑换之间，不论谁先拿令牌上传，都恰好成功一次；后来的人看到「已使用」。
  let uploadedScene = ''
  for (const order of ['后兑换的人先传', '先兑换的人先传'] as const) {
    const session = await newSession()
    const first = await service.resolveScene(session.sceneToken)
    const second = await service.resolveScene(session.sceneToken)
    const [winner, loser] = order === '后兑换的人先传' ? [second, first] : [first, second]
    const won = await upload(session.sessionId, winner.uploadToken)
    const lost = await upload(session.sessionId, loser.uploadToken)
    check(
      `两次兑换之间${order}：成功一次，另一人再传是 UPLOAD_SESSION_NOT_PENDING`,
      won === '<no-error>' && lost === 'UPLOAD_SESSION_NOT_PENDING',
      `实际 ${won} / ${lost}`,
    )
    uploadedScene = session.sceneToken
  }

  // ── 五、失败路径不当预言机 ────────────────────────────────────────────
  {
    const uploadedCode = await errorCodeOf(() => service.resolveScene(uploadedScene))
    check('上传后（会话 uploaded）再兑换 → UNUSABLE', uploadedCode === 'UPLOAD_SCENE_UNUSABLE', `实际 ${uploadedCode}`)

    const expiring = await newSession()
    const expiringKey = `upload_session:${expiring.sessionId}`
    const expiringRaw = JSON.parse((await client.get(expiringKey)) as string) as Record<string, unknown>
    expiringRaw['expiresAt'] = new Date(Date.now() - 1000).toISOString()
    // 必须用 SETEX 保住 TTL，理由同下面「六」：否则验的是夹具坏没坏。
    const expiringTtl = await client.ttl(expiringKey)
    if (expiringTtl <= 0) throw new Error('夹具异常：会话键没有 TTL，本条断言会验错东西')
    await client.setex(expiringKey, expiringTtl, JSON.stringify(expiringRaw))
    const expiredCode = await errorCodeOf(() => service.resolveScene(expiring.sceneToken))
    check('过期后再兑换 → UNUSABLE', expiredCode === 'UPLOAD_SCENE_UNUSABLE', `实际 ${expiredCode}`)

    const cancelled = await newSession()
    await service.cancel(cancelled.sessionId, cancelled.controlToken)
    const cancelledCode = await errorCodeOf(() => service.resolveScene(cancelled.sceneToken))
    check('作废后再兑换 → UNUSABLE', cancelledCode === 'UPLOAD_SCENE_UNUSABLE', `实际 ${cancelledCode}`)

    const probe = await newSession()
    const last = probe.sceneToken.slice(-1)
    const flipped = `${probe.sceneToken.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`
    const flippedCode = await errorCodeOf(() => service.resolveScene(flipped))
    const stillWorks = await service.resolveScene(probe.sceneToken).then(() => true, () => false)
    check(
      '改错一个字的码 → UNUSABLE（原码照常可兑）',
      flippedCode === 'UPLOAD_SCENE_UNUSABLE' && stillWorks,
      `实际 ${flippedCode} / 原码${stillWorks ? '可兑' : '不可兑'}`,
    )

    // 逐个跑：并发打同一会话会被锁挡成同一个码，就验不出各自的原因了。
    const codes: string[] = []
    for (const run of [
      () => service.resolveScene('!!!bad!!!'),                // 格式错
      () => service.resolveScene('x'.repeat(40)),             // 超长
      () => service.resolveScene('aaaaaaaaaaaaaaaaaaaaaaaa'), // 格式对但查无此码
    ]) codes.push(await errorCodeOf(run))
    codes.push(flippedCode, uploadedCode, expiredCode, cancelledCode)
    check(
      '七类失败对外是同一个错误码',
      new Set(codes).size === 1 && codes[0] === 'UPLOAD_SCENE_UNUSABLE',
      codes.join(' / '),
    )
  }
  check('格式校验拒绝空串与超长', !isWellFormedSceneToken('') && !isWellFormedSceneToken('y'.repeat(33)))

  // ── 六、滚动升级：旧构建创建的会话没有 sceneTokenHash，必须拒绝 ────────
  {
    const legacy = await service.create({
      purpose: 'print_doc', mode: 'temporary', channel: 'phone_h5', uploadUrl: '/m/upload',
    })
    const key = `upload_session:${legacy.sessionId}`
    const raw = JSON.parse((await client.get(key)) as string) as Record<string, unknown>
    delete raw['sceneTokenHash']          // 模拟旧构建写下的记录
    // 必须用 SETEX 保住 TTL：裸 SET 会把过期时间抹掉，于是 persist() 走
    // setExistingWithCurrentTtl 拿到 ttl<=0，抛的是 UPLOAD_SESSION_EXPIRED ——
    // 那样这条断言就变成「验夹具坏没坏」，而不是验 fail-closed。
    const ttl = await client.ttl(key)
    if (ttl <= 0) throw new Error('夹具异常：会话键没有 TTL，本条断言会验错东西')
    await client.setex(key, ttl, JSON.stringify(raw))
    const code = await errorCodeOf(() => service.resolveScene(legacy.sceneToken))
    check(
      '会话缺 sceneTokenHash 时兑换被拒（fail-closed）',
      code === 'UPLOAD_SCENE_UNUSABLE',
      `实际 ${code} —— 缺字段不能等于「任何 scene 都对」`,
    )
  }

  // ── 七、派生密钥取不到时报错，绝不回落成固定值 ───────────────────────────
  {
    const session = await newSession()
    const sessionKey = `upload_session:${session.sessionId}`
    const before = await client.get(sessionKey)
    const saved = process.env['FILE_SIGNING_SECRET']
    const outcomes: string[] = []
    for (const value of [undefined, 'too-short-signing-secret']) {
      if (value === undefined) delete process.env['FILE_SIGNING_SECRET']
      else process.env['FILE_SIGNING_SECRET'] = value
      outcomes.push(await service.resolveScene(session.sceneToken).then(() => 'issued', (e: Error) => e.message))
    }
    process.env['FILE_SIGNING_SECRET'] = saved
    check(
      '密钥缺失或过短时兑换直接报错，不发令牌、不改会话',
      outcomes.every((m) => m === 'FILE_SIGNING_SECRET environment variable must be set (≥ 32 chars)')
        && (await client.get(sessionKey)) === before,
      outcomes.join(' / '),
    )
  }

  client.disconnect()
  await server?.close()
  await checkPhaseSkipOnRealRedis()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${failed.length === 0 ? `✅ ALL PASS (${results.length} checks)` : `❌ ${failed.length} 项失败`} — 扫码上传场景码`)
  if (failed.length > 0) process.exit(1)
}

async function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

/** 独立 redis-server 上跑 RedisService 的真 Lua。进程内桩不证明 ARGV 语义。 */
async function checkPhaseSkipOnRealRedis(): Promise<void> {
  const port = await freeLoopbackPort()
  if (port === 0 || port === 6379) throw new Error(`refusing redis port ${port}`)
  const dir = await mkdtemp(join(tmpdir(), 'upload-session-lua-'))
  const child = spawn('redis-server', [
    '--bind', '127.0.0.1',
    '--port', String(port),
    '--save', '',
    '--appendonly', 'no',
    '--daemonize', 'no',
    '--protected-mode', 'yes',
    '--dir', dir,
  ], { stdio: ['pipe', 'ignore', 'pipe'] })
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.end()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
    })
    if (open) break
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  const real = new Redis(`redis://127.0.0.1:${port}`, { maxRetriesPerRequest: 1, connectTimeout: 1000 })
  try {
    if ((await real.ping()) !== 'PONG') throw new Error('isolated redis did not answer ping')
    const service = new RedisService(real as never)
    await real.set('upload_session:phase', JSON.stringify({
      status: 'uploaded',
      file: { fileId: 'f1' },
      bind: { phase: 'intent' },
    }), 'EX', 60)
    await real.set('upload_session_upload_lock:phase', 'tok', 'EX', 30)
    const wrote = await service.compareAndSetSession(
      'upload_session:phase',
      'upload_session_upload_lock:phase',
      'tok',
      JSON.stringify({ status: 'uploaded', file: { fileId: 'f1' }, bind: { phase: 'copied' } }),
      'uploaded',
      'f1',
      null,
      {
        key: 'upload_session_cleanup:phase',
        value: '{"kept":1}',
        ttlSeconds: 60,
        indexKey: 'upload_session_expiry_index',
        indexScore: 1,
        indexMember: 'phase',
      },
    )
    check(
      '真实 Redis：不检查阶段时，已有 bind 仍能原子写入清理记录',
      wrote === 'updated' && (await real.get('upload_session_cleanup:phase')) === '{"kept":1}',
      `实际 ${wrote}`,
    )
    await real.set('upload_session:phase2', JSON.stringify({
      status: 'uploaded',
      file: { fileId: 'f2' },
      bind: { phase: 'intent' },
    }), 'EX', 60)
    await real.set('upload_session_upload_lock:phase2', 'tok', 'EX', 30)
    const blocked = await service.compareAndSetSession(
      'upload_session:phase2',
      'upload_session_upload_lock:phase2',
      'tok',
      JSON.stringify({ status: 'uploaded', file: { fileId: 'f2' } }),
      'uploaded',
      'f2',
      '',
      {
        key: 'upload_session_cleanup:phase2',
        value: '{"no":1}',
        ttlSeconds: 60,
        indexKey: 'upload_session_expiry_index',
        indexScore: 2,
        indexMember: 'phase2',
      },
    )
    check(
      '真实 Redis：空阶段仍要求当前没有 bind',
      blocked === 'conflict' && (await real.get('upload_session_cleanup:phase2')) === null,
      `实际 ${blocked}`,
    )
  } finally {
    real.disconnect()
    child.kill('SIGTERM')
    await rm(dir, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
