import 'reflect-metadata'

/**
 * verify:upload-scene —— 扫码上传的小程序场景码。
 *
 * 背景：一体机原先的扫码上传二维码编的是**网页地址**，里面直接带 sessionId +
 * uploadToken。产品负责人 2026-09-08 要求「微信扫码直接打开小程序，而不是一个网页」。
 * 微信 scene 上限 32 字符，塞不下会话凭据，所以扫码只能带一个短的不透明码，
 * 由服务端换回上传凭据。
 *
 * 这条门禁跑**真实 RedisService**（打到进程内 RESP 桩），不是自己写的假对象 ——
 * 单次兑换靠的是 Redis 的 GETDEL 原子性，用假对象验等于验自己写的那份实现。
 *
 * 钉住四件事：
 * ① 明文永不落库：Redis 里存的是 sha256，不是 scene 本身；
 * ② 兑换一次性：同一张码第二次换不到东西；
 * ③ 兑换会轮换 uploadToken：旧网页二维码当场作废；
 * ④ 失败路径不当预言机：格式错/查无此码/已过期/已用掉，对外是同一个错误码。
 */
import { createHash } from 'node:crypto'
import { Redis } from 'ioredis'
import { RedisService } from '../src/common/redis/redis.service'
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
      eval: async (_script: string, _numKeys: string, key: string, value: string) => {
        const ttl = await client.ttl(key)
        if (ttl <= 0) return 0
        await client.setex(key, ttl, value)
        return 1
      },
    })
  }
  const redis = new RedisService(client as never)
  const service = new UploadSessionsService(redis as never, null as never, null as never)

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
    '兑换发的是**新**上传令牌',
    redeemed.uploadToken.length > 0 && redeemed.uploadToken !== created.uploadToken,
    '复用旧令牌等于服务端存了明文',
  )

  // ── 四、一次性 + 轮换 ─────────────────────────────────────────────────
  check(
    '同一张码第二次兑换失败',
    (await errorCodeOf(() => service.resolveScene(created.sceneToken))) === 'UPLOAD_SCENE_UNUSABLE',
    '不是一次性的话，二维码被拍照传播后人人可用',
  )
  {
    // 先直查落盘的哈希：这条不依赖任何下游服务，坏了就是坏在轮换本身。
    const raw = (await client.get(`upload_session:${created.sessionId}`)) as string
    const h = (s: string): string => createHash('sha256').update(s).digest('hex')
    check(
      '落盘的 uploadTokenHash 已换成新令牌的哈希',
      raw.includes(h(redeemed.uploadToken)) && !raw.includes(h(created.uploadToken)),
      '没落盘等于没轮换',
    )
    const fakeFile = { buffer: Buffer.from('x'), originalname: 'a.pdf', mimetype: 'application/pdf', size: 1 }
    const oldTokenCode = await errorCodeOf(() =>
      service.uploadFile({ sessionId: created.sessionId, uploadToken: created.uploadToken, file: fakeFile as never }),
    )
    check(
      '兑换后旧上传令牌立即作废',
      oldTokenCode === 'UPLOAD_TOKEN_INVALID',
      `实际 ${oldTokenCode} —— 旧网页二维码应当当场失效`,
    )
  }

  // ── 五、失败路径不当预言机 ────────────────────────────────────────────
  {
    const codes = await Promise.all([
      errorCodeOf(() => service.resolveScene('!!!bad!!!')),               // 格式错
      errorCodeOf(() => service.resolveScene('x'.repeat(40))),            // 超长
      errorCodeOf(() => service.resolveScene('aaaaaaaaaaaaaaaaaaaaaaaa')), // 格式对但查无此码
      errorCodeOf(() => service.resolveScene(created.sceneToken)),        // 已被用掉
    ])
    check(
      '四类失败对外是同一个错误码',
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

  client.disconnect()
  await server?.close()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${failed.length === 0 ? `✅ ALL PASS (${results.length} checks)` : `❌ ${failed.length} 项失败`} — 扫码上传场景码`)
  if (failed.length > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
