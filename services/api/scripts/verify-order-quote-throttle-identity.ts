/**
 * 报价 POST /orders/quote 限流计数维度门禁（B-01）。
 *
 * 守的事实（对应 src/payment/order-quote-throttle.ts 的口径）：
 *
 *   1. 同一出口 IP 下，不同会员各有自己的每分钟 10 次；
 *   2. 桶键只来自验签后的 sub：同一人跨四种请求体、换 jti（重新登录）、换出口，都共用一份额度；
 *   3. 自报的身份开不出新桶：body 里的 terminalId、会员号，以及 x-terminal-id 请求头；
 *   4. 未认证不绕过：没有令牌、坏令牌、过期令牌、别的密钥签的、内部令牌、没有 jti 的令牌，
 *      都与匿名请求共用同一个 IP 的 10 次，打满之后仍是 429，而且永不回 401；
 *   5. 会员 tracker 不碰存储：没绑定验签时一律按 IP（fail-closed）；模块销毁时复位。
 *      binder 注入 JwtService 与现有 TerminalSessionService，不注入 Redis / Prisma。
 *   6. `ip-wide` 单 IP 天花板对本路由仍然有效；
 *   7. 静态：控制器用 @OrderQuoteThrottle()，没有鉴权守卫，不再写裸 @Throttle、不用 TerminalScopedThrottle。
 *   8. 终端分支（有界再验，不是「任意超限永远 0 次存储读」）：
 *      正缓存命中含 429 那次为 0 次 get / findUnique；换票、过期、淘汰后的下一跳最多再验一次；
 *      桶是 t: + 终端号摘要，换票不重置每分钟 10 次。多进程上限是 N×K，本脚本只证明单进程。
 *
 * 全程用真实的 ThrottlerGuard、真实的 buildThrottlerConfig()、真实的报价控制器、真实的 JwtService
 * 签发与验签、真实的 TerminalSessionService.validate。Redis 与 Prisma 只用本文件里的内存适配器计数，
 * 不连接活的 Redis、PostgreSQL 或生产。只把报价业务（OrderQuoteService）换成桩。
 * 测试应用打开 trust proxy，用 X-Forwarded-For 模拟不同出口 IP（只在测试里这样做；线上取 IP 规则不变）。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Module, ServiceUnavailableException, UnauthorizedException, type INestApplication } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { resetRedisCooldownForTests } from '../src/common/redis/redis-degradation'
import { buildThrottlerConfig, resolveVerifiedTerminalOrIpTracker } from '../src/common/throttler/terminal-throttle'
import { OrderQuoteController } from '../src/payment/order-quote.controller'
import { OrderQuoteService } from '../src/payment/order-quote.service'
import {
  ORDER_QUOTE_LIMIT_PER_MINUTE,
  ORDER_QUOTE_TERMINAL_LIMITS,
  OrderQuoteThrottleBinder,
  bindOrderQuoteMemberVerifier,
  orderQuoteGetTracker,
} from '../src/payment/order-quote-throttle'
import { TerminalSessionService } from '../src/terminals/terminal-session.service'

const API_ROOT = path.resolve(__dirname, '..')
const SECRET = 'verify-order-quote-throttle-secret-0001'
const OTHER_SECRET = 'verify-order-quote-throttle-other-0002'
const LIMIT = ORDER_QUOTE_LIMIT_PER_MINUTE

const signer = new JwtService({ secret: SECRET })
const otherSigner = new JwtService({ secret: OTHER_SECRET })

function memberToken(sub: string, jti: string): string {
  return signer.sign({ sub }, { audience: 'enduser', jwtid: jti, expiresIn: '30m' })
}

// 四条小程序报价路径的请求体形状（print-upload、print-store、print-pay、package-confirm）。
const FILE_URL = 'https://files.example.invalid/signed/f-7a31?sig=0193'
const BODIES: Array<Record<string, unknown>> = [
  { fileUrl: FILE_URL, params: { copies: 1, colorMode: 'black_white', duplex: 'simplex' } },
  { fileUrl: FILE_URL, params: { copies: 2, colorMode: 'black_white', duplex: 'simplex' }, terminalId: 'KSK-001' },
  { fileUrl: FILE_URL, params: { copies: 1, colorMode: 'black_white', duplex: 'duplex_long_edge', pageRange: '1-2' } },
  { lines: [{ fileUrl: FILE_URL, copies: 1 }, { fileUrl: `${FILE_URL}&b=2`, copies: 1, pageRange: '1' }] },
]

const quoteStub = {
  calls: 0,
  async quote(): Promise<unknown> {
    quoteStub.calls += 1
    return { amountCents: 0, billablePages: 1, billingPageSource: 'server', lines: [] }
  },
}

type TerminalRow = { enabled: boolean; credentialGeneration: number }

const redisAdapter = {
  store: new Map<string, string>(),
  gets: 0,
  setExs: 0,
  getDels: 0,
  failGet: null as Error | null,
  hold: null as Promise<void> | null,
  async get(key: string): Promise<string | null> {
    this.gets += 1
    const hold = this.hold
    if (hold) await hold
    if (this.failGet) throw this.failGet
    return this.store.get(key) ?? null
  },
  async setEx(key: string, _ttl: number, value: string): Promise<void> {
    this.setExs += 1
    this.store.set(key, value)
  },
  async getDel(key: string): Promise<string | null> {
    this.getDels += 1
    const value = this.store.get(key) ?? null
    this.store.delete(key)
    return value
  },
}

const prismaAdapter = {
  findUniques: 0,
  rows: new Map<string, TerminalRow>(),
  terminal: {
    findUnique: async (args: { where: { id: string } }): Promise<TerminalRow | null> => {
      prismaAdapter.findUniques += 1
      return prismaAdapter.rows.get(args.where.id) ?? null
    },
  },
}

const tokenValidator = {
  calls: 0,
  async validateTerminalToken(): Promise<void> {
    tokenValidator.calls += 1
  },
}

const sessions = new TerminalSessionService(
  redisAdapter as never,
  { terminal: prismaAdapter.terminal } as never,
  tokenValidator,
)

type QuoteOpts = { auth?: string; body?: Record<string, unknown>; terminalHeader?: string; sessionToken?: string }

function nestErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('getResponse' in error)) return null
  const response = (error as { getResponse: () => unknown }).getResponse()
  if (!response || typeof response !== 'object') return null
  const code = (response as { error?: { code?: unknown } }).error?.code
  return typeof code === 'string' ? code : null
}

function seedTerminal(terminalId: string, token: string, opts: { enabled?: boolean; generation?: number; storedGeneration?: number } = {}): void {
  const storedGeneration = opts.storedGeneration ?? opts.generation ?? 1
  redisAdapter.store.set(sessions.sessionKey(token), JSON.stringify({
    terminalId,
    generation: storedGeneration,
    issuedAt: '2026-10-22T00:00:00.000Z',
  }))
  prismaAdapter.rows.set(terminalId, {
    enabled: opts.enabled ?? true,
    credentialGeneration: opts.generation ?? storedGeneration,
  })
}

function useMonoClock(): { set: (value: number) => void; get: () => number; restore: () => void } {
  const perf = performance as { now: () => number }
  const original = perf.now
  let current = 8_000_000
  perf.now = () => current
  return {
    set(value: number) { current = value },
    get: () => current,
    restore() { perf.now = original },
  }
}

async function waitFor(ready: () => boolean, label: string): Promise<void> {
  const started = Date.now()
  while (!ready()) {
    if (Date.now() - started > 2_000) throw new Error(`等待超时: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function startApp(ipWideLimit: number): Promise<{ app: INestApplication; baseUrl: string }> {
  // buildThrottlerConfig() 在建配置时读一次 env，所以必须在定义模块之前写入。
  process.env['THROTTLE_IP_WIDE_PER_MINUTE'] = String(ipWideLimit)
  @Module({
    imports: [ThrottlerModule.forRoot(buildThrottlerConfig()), JwtModule.register({ secret: SECRET })],
    controllers: [OrderQuoteController],
    providers: [
      { provide: OrderQuoteService, useValue: quoteStub },
      { provide: TerminalSessionService, useValue: sessions },
      OrderQuoteThrottleBinder,
      { provide: APP_GUARD, useClass: ThrottlerGuard },
    ],
  })
  class ProbeModule {}
  const app = await NestFactory.create(ProbeModule, { logger: false })
  // 只在测试里信任 X-Forwarded-For，用来模拟不同出口 IP。
  app.getHttpAdapter().getInstance().set('trust proxy', true)
  await app.listen(0, '127.0.0.1')
  const url = await app.getUrl()
  return { app, baseUrl: url.replace('[::1]', '127.0.0.1') }
}

const seenStatuses: number[] = []

async function quote(baseUrl: string, ip: string, opts: QuoteOpts = {}): Promise<number> {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': ip }
  if (opts.auth) headers['authorization'] = opts.auth
  if (opts.terminalHeader) headers['x-terminal-id'] = opts.terminalHeader
  if (opts.sessionToken) headers['x-terminal-session-token'] = opts.sessionToken
  const res = await fetch(`${baseUrl}/orders/quote`, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? BODIES[0]),
  })
  const text = await res.text()
  seenStatuses.push(res.status)
  if (res.status !== 200 && res.status !== 429) {
    console.error(`unexpected status ${res.status} body ${text.slice(0, 400)}`)
  }
  return res.status
}

/** 注释里可以点名禁用符号；门禁只扫代码。 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

async function quoteMany(baseUrl: string, ip: string, times: number, opts: QuoteOpts = {}): Promise<number[]> {
  const out: number[] = []
  for (let i = 0; i < times; i += 1) out.push(await quote(baseUrl, ip, opts))
  return out
}

const allOk = (n: number): number[] => Array<number>(n).fill(200)

async function verifyRuntime(): Promise<void> {
  const { app, baseUrl } = await startApp(1000)
  try {
    // ── 1. 同一出口 IP，不同会员各有自己的 10 次 ─────────────────────────
    const ipHall = '203.0.113.10'
    for (const sub of ['m-zhao', 'm-qian', 'm-sun', 'm-li', 'm-zhou']) {
      const auth = `Bearer ${memberToken(sub, `${sub}-s1`)}`
      assert.deepEqual(await quoteMany(baseUrl, ipHall, LIMIT, { auth }), allOk(LIMIT), `同出口会员 ${sub} 应有独立的 ${LIMIT} 次`)
      assert.equal(await quote(baseUrl, ipHall, { auth }), 429, `会员 ${sub} 第 ${LIMIT + 1} 次应 429（刷量仍限）`)
    }
    console.log(`  PASS 同一出口 IP 下 5 个会员各 ${LIMIT} 次全部 200，各自第 ${LIMIT + 1} 次 429`)

    // ── 2a. 同一人跨四种请求体共用额度 ──────────────────────────────────
    const ipShop = '203.0.113.20'
    const authWu = `Bearer ${memberToken('m-wu', 'm-wu-s1')}`
    const mixed: number[] = []
    for (let i = 0; i < LIMIT; i += 1) mixed.push(await quote(baseUrl, ipShop, { auth: authWu, body: BODIES[i % BODIES.length] }))
    assert.deepEqual(mixed, allOk(LIMIT), '同一会员四种请求体合计 10 次应全部 200')
    for (const body of BODIES) assert.equal(await quote(baseUrl, ipShop, { auth: authWu, body }), 429, '同一会员换请求体不能多拿额度')
    console.log('  PASS 同一会员跨四种请求体共用 10 次，第 11 次起不论哪种都 429')

    // ── 2b. 同一 sub、不同 jti（重新登录）共用额度 ─────────────────────
    const ipHome = '203.0.113.30'
    const zheng1 = `Bearer ${memberToken('m-zheng', 'm-zheng-s1')}`
    const zheng2 = `Bearer ${memberToken('m-zheng', 'm-zheng-s2')}`
    const zheng3 = `Bearer ${memberToken('m-zheng', 'm-zheng-s3')}`
    assert.deepEqual(await quoteMany(baseUrl, ipHome, 5, { auth: zheng1 }), allOk(5))
    assert.deepEqual(await quoteMany(baseUrl, ipHome, 5, { auth: zheng2 }), allOk(5))
    assert.equal(await quote(baseUrl, ipHome, { auth: zheng3 }), 429, '同一 sub 换 jti 不能重置额度')
    console.log('  PASS 同一 sub 三个不同 jti 共用 10 次，换令牌不重置额度')

    // ── 2c. 同一会员换出口 IP 仍是同一个桶 ────────────────────────────
    const authWang = `Bearer ${memberToken('m-wang', 'm-wang-s1')}`
    assert.deepEqual(await quoteMany(baseUrl, '203.0.113.40', LIMIT, { auth: authWang }), allOk(LIMIT))
    assert.equal(await quote(baseUrl, '198.51.100.40', { auth: authWang }), 429, '会员换出口 IP 不能换到一份新额度')
    console.log('  PASS 同一会员换出口 IP 仍是同一个桶')

    // ── 3. 自报身份开不出新桶：body 字段与 x-terminal-id ─────────────────
    const ipKiosk = '203.0.113.50'
    const selfReported: number[] = []
    for (let i = 0; i < LIMIT; i += 1) {
      selfReported.push(
        await quote(baseUrl, ipKiosk, {
          body: { ...BODIES[1], terminalId: `KSK-${100 + i}`, memberId: `m-forged-${i}`, endUserId: `u-forged-${i}` },
          terminalHeader: `forged-terminal-${i}`,
        }),
      )
    }
    assert.deepEqual(selfReported, allOk(LIMIT), '同一 IP 匿名 10 次（每次换自报身份）应全部 200')
    assert.equal(
      await quote(baseUrl, ipKiosk, { body: { ...BODIES[1], terminalId: 'KSK-999', memberId: 'm-new' }, terminalHeader: 'forged-new' }),
      429,
      '换一个自报的终端号或会员号不能开出新桶',
    )
    console.log('  PASS body 里的 terminalId、会员号和 x-terminal-id 都开不出新桶')

    // ── 4. 未认证不绕过：干净 IP 上与匿名共用一个 IP 的 10 次 ─────────────
    const ipClean = '203.0.113.60'
    const expired = signer.sign({ sub: 'm-expired', exp: Math.floor(Date.now() / 1000) - 120 }, { audience: 'enduser', jwtid: 'm-expired-s1' })
    const invalid: Array<[string, string]> = [
      ['垃圾 Bearer', 'Bearer not-a-jwt'],
      ['别的密钥签的令牌', `Bearer ${otherSigner.sign({ sub: 'm-zhao' }, { audience: 'enduser', jwtid: 'x-1', expiresIn: '30m' })}`],
      ['过期会员令牌', `Bearer ${expired}`],
      ['内部令牌（没有 enduser audience）', `Bearer ${signer.sign({ sub: 'admin-1', role: 'admin' }, { expiresIn: '30m' })}`],
      ['没有 jti 的令牌', `Bearer ${signer.sign({ sub: 'm-nojti' }, { audience: 'enduser', expiresIn: '30m' })}`],
    ]
    const cleanRun: number[] = []
    for (let i = 0; i < 5; i += 1) cleanRun.push(await quote(baseUrl, ipClean))
    for (const [, auth] of invalid) cleanRun.push(await quote(baseUrl, ipClean, { auth }))
    assert.deepEqual(cleanRun, allOk(LIMIT), '干净 IP 上匿名 5 次加 5 种坏令牌各 1 次，合计 10 次应全部 200（共用同一个 IP 桶）')
    for (const [label, auth] of invalid) assert.equal(await quote(baseUrl, ipClean, { auth }), 429, `${label}在 IP 桶打满后仍应 429，开不出新桶`)
    assert.equal(await quote(baseUrl, ipClean), 429, '匿名请求在 IP 桶打满后应 429')
    assert.equal(await quote(baseUrl, ipClean, { auth: 'bearer' }), 429, '只有 bearer 前缀没有令牌也按 IP')
    console.log('  PASS 坏令牌、过期令牌、内部令牌、没有 jti 的令牌都与匿名共用 IP 的 10 次，打满后仍 429')

    // ── 5a. 没绑定验签时一律按 IP（fail-closed）──────────────────────────
    bindOrderQuoteMemberVerifier(null)
    try {
      const ipUnbound = '203.0.113.70'
      const authFeng = `Bearer ${memberToken('m-feng', 'm-feng-s1')}`
      assert.deepEqual(await quoteMany(baseUrl, ipUnbound, LIMIT, { auth: authFeng }), allOk(LIMIT))
      assert.equal(await quote(baseUrl, ipUnbound), 429, '没绑定验签时，有效会员令牌也只能落在 IP 桶')
    } finally {
      app.get(OrderQuoteThrottleBinder).onModuleInit()
    }
    console.log('  PASS 没绑定验签时有效会员令牌也按 IP 计（fail-closed）')

    assert.ok(!seenStatuses.includes(401), `报价不应回 401（身份只决定额度归属），实际出现过: ${[...new Set(seenStatuses)].join(',')}`)
    console.log('  PASS 全程没有 401')
    assert.equal(ioSnapshot().gets, 0, '会员与匿名路径不得 redis.get')
    assert.equal(ioSnapshot().finds, 0, '会员与匿名路径不得 findUnique')
    assert.equal(ioSnapshot().setExs, 0, '会员与匿名路径不得 setEx')
    assert.equal(ioSnapshot().getDels, 0, '会员与匿名路径不得 getDel')
    assert.equal(ioSnapshot().tokenChecks, 0, '会员与匿名路径不得 validateTerminalToken')
    console.log('  PASS 会员、匿名、自报身份的 HTTP 全程存储读和续期都是 0')
    assert.ok(quoteStub.calls > 0, '报价业务桩应被调用过（请求确实穿过了限流）')
  } finally {
    await app.close()
  }

  // ── 5b. 模块销毁时复位：之后有效令牌也按 IP ───────────────────────────
  const afterClose = orderQuoteGetTracker({ ip: '203.0.113.80', headers: { authorization: `Bearer ${memberToken('m-chen', 'm-chen-s1')}` } })
  assert.equal(afterClose, '203.0.113.80', '模块销毁后验签应复位，tracker 退回纯 IP')
  console.log('  PASS 模块销毁时验签复位，tracker 退回纯 IP')
}


function ioSnapshot(): { gets: number; setExs: number; getDels: number; finds: number; tokenChecks: number } {
  return {
    gets: redisAdapter.gets,
    setExs: redisAdapter.setExs,
    getDels: redisAdapter.getDels,
    finds: prismaAdapter.findUniques,
    tokenChecks: tokenValidator.calls,
  }
}

function defer(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function trackerInput(ip: string, terminalId?: string, sessionToken?: string, auth?: string): Record<string, unknown> {
  const headers: Record<string, string> = {}
  if (auth) headers.authorization = auth
  if (terminalId) headers['x-terminal-id'] = terminalId
  if (sessionToken) headers['x-terminal-session-token'] = sessionToken
  return { ip, headers }
}

async function expectInvalid(run: () => Promise<unknown>): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof UnauthorizedException, '应抛出真实 UnauthorizedException')
    assert.equal(nestErrorCode(error), 'TERMINAL_SESSION_INVALID')
    return true
  })
}

async function expectRetryable(run: () => Promise<unknown>): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException, '应抛出真实 ServiceUnavailableException')
    assert.equal(nestErrorCode(error), 'TERMINAL_SESSION_RETRYABLE')
    return true
  })
}

async function assertInvalidTicketUsesIp(
  baseUrl: string,
  label: string,
  ip: string,
  terminalId: string,
  token: string,
  expectedFinds: number,
): Promise<void> {
  const opts = { terminalHeader: terminalId, sessionToken: token }
  const before = ioSnapshot()
  assert.equal(await quote(baseUrl, ip, opts), 200, `${label} 应 200，报价不因终端票失败回 401`)
  const mid = ioSnapshot()
  assert.equal(mid.gets - before.gets, 1, `${label} 应恰好 1 次 get`)
  assert.equal(mid.finds - before.finds, expectedFinds, `${label} 的 findUnique 次数不对`)
  assert.deepEqual(await quoteMany(baseUrl, ip, LIMIT - 1, opts), allOk(LIMIT - 1), `${label} 应继续落在同一个 IP 桶`)
  assert.equal(await quote(baseUrl, ip, opts), 429, `${label} 打满 IP 桶后应 429`)
  const after = ioSnapshot()
  assert.equal(after.gets, mid.gets, `${label} 负缓存不应再 get`)
  assert.equal(after.finds, mid.finds, `${label} 负缓存不应再 findUnique`)
  console.log(`  PASS ${label}：落在 IP 桶，负缓存不再读存储`)
}

async function verifyTerminalIdentity(): Promise<void> {
  console.log('  -- 终端身份合同（真实 TerminalSessionService + 内存适配器）')
  let app: INestApplication | undefined
  let clock: ReturnType<typeof useMonoClock> | undefined
  let releaseHold: (() => void) | null = null
  try {
    const started = await startApp(1000)
    app = started.app
    const { baseUrl } = started
    const mono = useMonoClock()
    clock = mono
    const armHold = (): { release: () => void } => {
      const gate = defer()
      redisAdapter.hold = gate.promise
      const release = (): void => {
        redisAdapter.hold = null
        gate.resolve()
      }
      releaseHold = release
      return { release }
    }

    const sharedIp = '203.0.113.150'
    const fiveBuckets: string[] = []
    for (const name of ['a', 'b', 'c', 'd', 'e']) {
      const terminalId = `term-five-${name}`
      const token = `five-tok-${name}`
      seedTerminal(terminalId, token)
      const opts = { terminalHeader: terminalId, sessionToken: token }
      const before = ioSnapshot()
      assert.equal(await quote(baseUrl, sharedIp, opts), 200, `${name} 首跳应 200`)
      const warmed = ioSnapshot()
      assert.equal(warmed.gets, before.gets + 1, `${name} 首跳应 1 次 get`)
      assert.equal(warmed.finds, before.finds + 1, `${name} 首跳应 1 次 findUnique`)
      assert.deepEqual(await quoteMany(baseUrl, sharedIp, LIMIT - 1, opts), allOk(LIMIT - 1))
      assert.equal(await quote(baseUrl, sharedIp, opts), 429, `${name} 第 ${LIMIT + 1} 次应 429`)
      const after = ioSnapshot()
      assert.equal(after.gets, warmed.gets, `${name} 命中期含 429 不得再 get`)
      assert.equal(after.finds, warmed.finds, `${name} 命中期含 429 不得再 findUnique`)
      const bucket = orderQuoteGetTracker(trackerInput(sharedIp, terminalId, token))
      assert.equal(typeof bucket, 'string', `${name} 命中应同步返回桶名`)
      assert.equal(bucket, resolveVerifiedTerminalOrIpTracker({}, terminalId))
      assert.equal(ioSnapshot().gets, after.gets, `${name} 同步命中不得再 get`)
      fiveBuckets.push(bucket as string)
    }
    assert.equal(new Set(fiveBuckets).size, 5, '五台终端应是五个桶')
    console.log('  PASS 同一 IP 五台终端各 10 次 200、第 11 次 429，命中期 0 次存储读')

    {
      const ip = '203.0.113.151'
      const terminalId = 'term-rotate'
      for (const token of ['rot-a', 'rot-b', 'rot-c']) seedTerminal(terminalId, token)
      const before = ioSnapshot()
      assert.deepEqual(await quoteMany(baseUrl, ip, 5, { terminalHeader: terminalId, sessionToken: 'rot-a' }), allOk(5))
      const afterA = ioSnapshot()
      assert.equal(afterA.gets, before.gets + 1)
      assert.equal(afterA.finds, before.finds + 1)
      assert.deepEqual(await quoteMany(baseUrl, ip, 5, { terminalHeader: terminalId, sessionToken: 'rot-b' }), allOk(5))
      const afterB = ioSnapshot()
      assert.equal(afterB.gets, afterA.gets + 1, '换票第一跳应再 get 1 次')
      assert.equal(afterB.finds, afterA.finds + 1, '换票第一跳应再 findUnique 1 次')
      assert.equal(await quote(baseUrl, ip, { terminalHeader: terminalId, sessionToken: 'rot-c' }), 429, '换票不得重置终端额度')
      const afterC = ioSnapshot()
      assert.equal(afterC.gets, afterB.gets + 1)
      assert.equal(afterC.finds, afterB.finds + 1)
      assert.equal(await quote(baseUrl, ip, { terminalHeader: terminalId, sessionToken: 'rot-c' }), 429)
      assert.equal(ioSnapshot().gets, afterC.gets, '新票进入正缓存后不得再 get')
      const bucketA = orderQuoteGetTracker(trackerInput(ip, terminalId, 'rot-a'))
      const bucketC = orderQuoteGetTracker(trackerInput(ip, terminalId, 'rot-c'))
      const expected = resolveVerifiedTerminalOrIpTracker({}, terminalId)
      assert.equal(bucketA, expected)
      assert.equal(bucketC, expected)
      console.log('  PASS 换票仍是同一个终端桶，第 11 次 429，每张新票最多再验 1 次')
    }

    {
      const ip = '203.0.113.152'
      const terminalId = 'term-member-first'
      const token = 'member-first-tok'
      seedTerminal(terminalId, token)
      const auth = `Bearer ${memberToken('m-priority', 'm-priority-s1')}`
      const before = ioSnapshot()
      const tracked = orderQuoteGetTracker(trackerInput(ip, terminalId, token, auth))
      assert.equal(typeof tracked, 'string')
      assert.notEqual(tracked, ip)
      assert.notEqual(tracked, resolveVerifiedTerminalOrIpTracker({}, terminalId))
      assert.equal(ioSnapshot().gets, before.gets)
      assert.equal(ioSnapshot().finds, before.finds)
      const opts = { auth, terminalHeader: terminalId, sessionToken: token }
      assert.deepEqual(await quoteMany(baseUrl, ip, LIMIT, opts), allOk(LIMIT))
      assert.equal(await quote(baseUrl, ip, opts), 429)
      assert.equal(ioSnapshot().gets, before.gets, '带会员令牌时不得 get')
      assert.equal(ioSnapshot().finds, before.finds, '带会员令牌时不得 findUnique')
      assert.equal(await quote(baseUrl, ip, { terminalHeader: terminalId, sessionToken: token }), 200, '会员打满后终端桶仍可用')
      assert.equal(ioSnapshot().gets, before.gets + 1)
      assert.equal(ioSnapshot().finds, before.finds + 1)
      console.log('  PASS 会员令牌优先于终端票，会员路径 0 次存储读，终端桶不被会员请求消耗')
    }

    {
      const before = ioSnapshot()
      const ipBody = '203.0.113.153'
      assert.deepEqual(
        await quoteMany(baseUrl, ipBody, LIMIT, { body: { ...BODIES[1], terminalId: 'KSK-BODY-ONLY' } }),
        allOk(LIMIT),
      )
      assert.equal(await quote(baseUrl, ipBody, { body: { ...BODIES[1], terminalId: 'KSK-BODY-NEW' } }), 429)
      const ipHead = '203.0.113.154'
      for (let i = 0; i < LIMIT; i += 1) {
        assert.equal(await quote(baseUrl, ipHead, { terminalHeader: `head-only-${i}` }), 200)
      }
      assert.equal(await quote(baseUrl, ipHead, { terminalHeader: 'head-only-new' }), 429)
      assert.equal(ioSnapshot().gets, before.gets, '只有 body 终端号或只有 x-terminal-id 时不得 get')
      assert.equal(ioSnapshot().finds, before.finds)
      console.log('  PASS 只有 body terminalId 或只有 x-terminal-id 时 get 为 0，并共用 IP 桶')
    }

    {
      const blankBefore = ioSnapshot()
      await expectInvalid(() => sessions.validate(' ', 'blank-term'))
      await expectInvalid(() => sessions.validate('term-blank-token', ' '))
      assert.equal(ioSnapshot().gets, blankBefore.gets, '空终端号或空票在读 Redis 之前失败')
      assert.equal(ioSnapshot().finds, blankBefore.finds)

      const missingBefore = ioSnapshot()
      await expectInvalid(() => sessions.validate('term-missing', 'missing-direct-tok'))
      assert.equal(ioSnapshot().gets, missingBefore.gets + 1)
      assert.equal(ioSnapshot().finds, missingBefore.finds, '缺会话不得 findUnique')

      redisAdapter.store.set(sessions.sessionKey('mismatch-direct-tok'), JSON.stringify({
        terminalId: 'term-owner',
        generation: 1,
        issuedAt: '2026-10-22T00:00:00.000Z',
      }))
      const mismatchBefore = ioSnapshot()
      await expectInvalid(() => sessions.validate('term-other', 'mismatch-direct-tok'))
      assert.equal(ioSnapshot().gets, mismatchBefore.gets + 1)
      assert.equal(ioSnapshot().finds, mismatchBefore.finds, '终端号不一致不得 findUnique')

      seedTerminal('term-disabled-direct', 'disabled-direct-tok', { enabled: false })
      const disabledBefore = ioSnapshot()
      await expectInvalid(() => sessions.validate('term-disabled-direct', 'disabled-direct-tok'))
      assert.equal(ioSnapshot().gets, disabledBefore.gets + 1)
      assert.equal(ioSnapshot().finds, disabledBefore.finds + 1)

      seedTerminal('term-gen-direct', 'gen-direct-tok', { generation: 4, storedGeneration: 1 })
      const genBefore = ioSnapshot()
      await expectInvalid(() => sessions.validate('term-gen-direct', 'gen-direct-tok'))
      assert.equal(ioSnapshot().gets, genBefore.gets + 1)
      assert.equal(ioSnapshot().finds, genBefore.finds + 1)

      redisAdapter.failGet = new Error('ECONNREFUSED')
      try {
        const errBefore = ioSnapshot()
        await expectRetryable(() => sessions.validate('term-retry-direct', 'retry-direct-tok'))
        assert.equal(ioSnapshot().gets, errBefore.gets + 1)
        assert.equal(ioSnapshot().finds, errBefore.finds, '存储错误不得 findUnique')
      } finally {
        redisAdapter.failGet = null
        resetRedisCooldownForTests()
      }
      console.log('  PASS 真实 Nest 异常：空票、缺会话、终端号不一致、停用、代次不符、存储错误')
    }

    await assertInvalidTicketUsesIp(baseUrl, '缺会话', '203.0.113.140', 'term-absent-http', 'absent-http-tok', 0)
    redisAdapter.store.set(sessions.sessionKey('mismatch-http-tok'), JSON.stringify({
      terminalId: 'term-mismatch-owner',
      generation: 1,
      issuedAt: '2026-10-22T00:00:00.000Z',
    }))
    await assertInvalidTicketUsesIp(baseUrl, '票内终端号不一致', '203.0.113.141', 'term-mismatch-header', 'mismatch-http-tok', 0)
    seedTerminal('term-disabled-http', 'disabled-http-tok', { enabled: false })
    await assertInvalidTicketUsesIp(baseUrl, '终端已停用', '203.0.113.142', 'term-disabled-http', 'disabled-http-tok', 1)
    seedTerminal('term-gen-http', 'gen-http-tok', { generation: 9, storedGeneration: 2 })
    await assertInvalidTicketUsesIp(baseUrl, '凭证代次不一致', '203.0.113.143', 'term-gen-http', 'gen-http-tok', 1)

    {
      const ip = '203.0.113.144'
      const terminalId = 'term-store-http'
      const token = 'store-http-tok'
      seedTerminal(terminalId, token)
      const opts = { terminalHeader: terminalId, sessionToken: token }
      redisAdapter.failGet = new Error('ECONNREFUSED')
      const before = ioSnapshot()
      try {
        assert.equal(await quote(baseUrl, ip, opts), 200, '存储错误应按 IP 返回 200')
        assert.equal(ioSnapshot().gets, before.gets + 1)
        assert.equal(ioSnapshot().finds, before.finds)
        assert.equal(await quote(baseUrl, ip, opts), 200, '静默期内仍按 IP')
        assert.equal(ioSnapshot().gets, before.gets + 1, '静默期不得再 get')
        assert.equal(ioSnapshot().finds, before.finds)
      } finally {
        redisAdapter.failGet = null
        resetRedisCooldownForTests()
      }
      const recovered = ioSnapshot()
      assert.equal(await quote(baseUrl, ip, opts), 200, '恢复后应进入终端桶')
      assert.equal(ioSnapshot().gets, recovered.gets + 1, '存储错误不得写成负缓存')
      assert.equal(ioSnapshot().finds, recovered.finds + 1)
      assert.deepEqual(await quoteMany(baseUrl, ip, LIMIT - 1, opts), allOk(LIMIT - 1))
      assert.equal(await quote(baseUrl, ip, opts), 429, '恢复后的终端桶仍是每分钟 10 次')
      assert.equal(ioSnapshot().gets, recovered.gets + 1)
      assert.equal(ioSnapshot().finds, recovered.finds + 1)
      console.log('  PASS 存储错误按 IP 返回且不写负缓存；恢复后终端桶仍是 10 次')
    }

    {
      const ip = '203.0.113.133'
      const terminalId = 'term-flight'
      const token = 'flight-tok'
      seedTerminal(terminalId, token)
      const opts = { terminalHeader: terminalId, sessionToken: token }
      const before = ioSnapshot()
      const statuses = await Promise.all(Array.from({ length: 5 }, () => quote(baseUrl, ip, opts)))
      assert.deepEqual(statuses, allOk(5))
      const after = ioSnapshot()
      assert.equal(after.gets, before.gets + 1, '同票并发 HTTP 只允许 1 次 get')
      assert.equal(after.finds, before.finds + 1, '同票并发 HTTP 只允许 1 次 findUnique')
      console.log('  PASS 同票 5 路并发 HTTP：1 次 get、1 次 findUnique')
    }

    {
      const ip = '203.0.113.134'
      const terminalId = 'term-flight-sync'
      const token = 'flight-sync-tok'
      seedTerminal(terminalId, token)
      const before = ioSnapshot()
      const hold = armHold()
      const pending: Array<Promise<string>> = []
      for (let i = 0; i < 5; i += 1) {
        pending.push(Promise.resolve(orderQuoteGetTracker(trackerInput(ip, terminalId, token))).then((value) => value))
      }
      assert.equal(ioSnapshot().gets, before.gets + 1, '同一张票重叠在途时只 get 1 次')
      hold.release()
      const buckets = await Promise.all(pending)
      assert.equal(ioSnapshot().gets, before.gets + 1)
      assert.equal(ioSnapshot().finds, before.finds + 1)
      const expected = resolveVerifiedTerminalOrIpTracker({}, terminalId)
      assert.ok(buckets.every((bucket) => bucket === expected), '重叠的同一张票应得到同一个终端桶')
      console.log('  PASS 同票 singleflight：重叠期间 1 次读，结果是终端桶')
    }

    {
      const ip = '203.0.113.155'
      const before = ioSnapshot()
      const total = ORDER_QUOTE_TERMINAL_LIMITS.unknownPerIp + 5
      const statuses = await Promise.all(
        Array.from({ length: total }, (_, index) =>
          quote(baseUrl, ip, { terminalHeader: `unknown-${index}`, sessionToken: `unknown-tok-${index}` }),
        ),
      )
      const after = ioSnapshot()
      assert.equal(after.gets - before.gets, ORDER_QUOTE_TERMINAL_LIMITS.unknownPerIp, 'K+5 张缺席票的 get 应等于 K')
      assert.ok(after.gets - before.gets <= ORDER_QUOTE_TERMINAL_LIMITS.unknownPerIp)
      assert.equal(after.finds, before.finds, '缺席票不得 findUnique')
      assert.equal(statuses.filter((status) => status === 200).length, LIMIT)
      assert.equal(statuses.filter((status) => status === 429).length, total - LIMIT)
      console.log('  PASS 同一 IP 并发 K+5 张未知票：get=K，findUnique=0')
    }

    {
      const capacity = ORDER_QUOTE_TERMINAL_LIMITS.positiveCapacity
      const before = ioSnapshot()
      const terms = Array.from({ length: capacity + 1 }, (_, index) => ({
        id: `evict-${index}`,
        token: `evict-tok-${index}`,
        ip: `10.4.${Math.floor(index / 200)}.${(index % 200) + 1}`,
      }))
      for (const term of terms) {
        seedTerminal(term.id, term.token)
        assert.equal(await quote(baseUrl, term.ip, { terminalHeader: term.id, sessionToken: term.token }), 200)
      }
      const filled = ioSnapshot()
      assert.equal(filled.gets, before.gets + capacity + 1)
      assert.equal(filled.finds, before.finds + capacity + 1)
      const oldest = terms[0]
      assert.equal(await quote(baseUrl, oldest.ip, { terminalHeader: oldest.id, sessionToken: oldest.token }), 200)
      const reread = ioSnapshot()
      assert.equal(reread.gets, filled.gets + 1, '被淘汰的最旧票必须再 get')
      assert.equal(reread.finds, filled.finds + 1, '被淘汰且会话还在时必须再 findUnique')
      const recent = terms[capacity]
      assert.equal(await quote(baseUrl, recent.ip, { terminalHeader: recent.id, sessionToken: recent.token }), 200)
      assert.equal(ioSnapshot().gets, reread.gets, '未被淘汰的最近一票仍应命中')
      console.log(`  PASS 正缓存容量 ${capacity}：最旧票被挤掉后再验 1 次，最近一票仍命中`)
    }

    {
      const ip = '203.0.113.132'
      const terminalId = 'term-expire'
      const token = 'expire-tok'
      seedTerminal(terminalId, token)
      const opts = { terminalHeader: terminalId, sessionToken: token }
      const before = ioSnapshot()
      assert.equal(await quote(baseUrl, ip, opts), 200)
      const warmed = ioSnapshot()
      assert.equal(warmed.gets, before.gets + 1)
      assert.equal(warmed.finds, before.finds + 1)
      assert.deepEqual(await quoteMany(baseUrl, ip, LIMIT - 1, opts), allOk(LIMIT - 1))
      assert.equal(await quote(baseUrl, ip, opts), 429)
      assert.equal(ioSnapshot().gets, warmed.gets)
      assert.equal(ioSnapshot().finds, warmed.finds)
      mono.set(mono.get() + ORDER_QUOTE_TERMINAL_LIMITS.positiveTtlMs + 1)
      assert.equal(await quote(baseUrl, ip, opts), 429, '过期后再验不得重置已用完的额度')
      const again = ioSnapshot()
      assert.equal(again.gets, warmed.gets + 1, '过期后的下一跳只再 get 1 次')
      assert.equal(again.finds, warmed.finds + 1, '过期后的下一跳只再 findUnique 1 次')
      assert.equal(await quote(baseUrl, ip, opts), 429)
      assert.equal(ioSnapshot().gets, again.gets, '再验之后重新进入命中窗口')
      assert.equal(ioSnapshot().finds, again.finds)
      console.log('  PASS 正缓存过期后的下一跳只再验 1 次，终端额度不重置')
    }

    {
      const ip = '203.0.113.130'
      const terminalId = 'term-ttl'
      const token = 'ttl-tok'
      seedTerminal(terminalId, token)
      const opts = { terminalHeader: terminalId, sessionToken: token }
      const before = ioSnapshot()
      const hold = armHold()
      const startedAt = mono.get()
      assert.equal(await quote(baseUrl, ip, opts), 200, '200ms 内未完成的验票应按 IP 返回')
      const whileHeld = ioSnapshot()
      assert.equal(whileHeld.gets, before.gets + 1)
      assert.equal(whileHeld.finds, before.finds, '调用方已返回时不得已经 findUnique')
      mono.set(startedAt + ORDER_QUOTE_TERMINAL_LIMITS.positiveTtlMs - 1_000)
      hold.release()
      await waitFor(() => ioSnapshot().finds === before.finds + 1, '200ms 之后的验票完成')
      const warmed = ioSnapshot()
      assert.equal(warmed.gets, before.gets + 1, '窗口内的迟到成功不得再 get')
      mono.set(startedAt + ORDER_QUOTE_TERMINAL_LIMITS.positiveTtlMs - 1)
      assert.deepEqual(await quoteMany(baseUrl, ip, LIMIT, opts), allOk(LIMIT), '超时的那一次没有占用终端额度')
      assert.equal(await quote(baseUrl, ip, opts), 429)
      const atHit = ioSnapshot()
      assert.equal(atHit.gets, warmed.gets, '开始后 59.999s 仍应命中')
      assert.equal(atHit.finds, warmed.finds)
      mono.set(startedAt + ORDER_QUOTE_TERMINAL_LIMITS.positiveTtlMs)
      assert.equal(await quote(baseUrl, ip, opts), 429, '到期后再验仍是原来的终端桶')
      const expired = ioSnapshot()
      assert.equal(expired.gets, atHit.gets + 1, '到期点用的是验票开始而不是完成时刻')
      assert.equal(expired.finds, atHit.finds + 1)
      console.log('  PASS 200ms 先按 IP；正缓存到期点是验票开始 + 60s')
    }

    {
      const ip = '203.0.113.131'
      const terminalId = 'term-late'
      const token = 'late-tok'
      seedTerminal(terminalId, token)
      const opts = { terminalHeader: terminalId, sessionToken: token }
      const before = ioSnapshot()
      const hold = armHold()
      const startedAt = mono.get()
      assert.equal(await quote(baseUrl, ip, opts), 200)
      assert.equal(ioSnapshot().gets, before.gets + 1)
      assert.equal(ioSnapshot().finds, before.finds)
      mono.set(startedAt + ORDER_QUOTE_TERMINAL_LIMITS.positiveTtlMs)
      hold.release()
      await waitFor(() => ioSnapshot().finds >= before.finds + 1, '超时窗口之后的验票结束')
      const afterLate = ioSnapshot()
      assert.equal(await quote(baseUrl, ip, opts), 200, '被丢弃的成功没有占用终端桶')
      const reread = ioSnapshot()
      assert.equal(reread.gets, afterLate.gets + 1, '超过开始 + 60s 的结果不得写入正缓存')
      assert.equal(reread.finds, afterLate.finds + 1)
      console.log('  PASS 超过验票开始 + 60s 的迟到成功整段丢弃')
    }

    app.get(OrderQuoteThrottleBinder).onModuleInit()
    resetRedisCooldownForTests()
    {
      const cap = ORDER_QUOTE_TERMINAL_LIMITS.unknownIpCapacity
      const before = ioSnapshot()
      for (let index = 0; index < cap; index += 1) {
        const ip = `10.7.${(index >> 8) & 255}.${index & 255}`
        const tracked = await orderQuoteGetTracker(trackerInput(ip, `bud-${index}`, `bud-tok-${index}`))
        assert.equal(tracked, ip, `预算内缺席票应退回 IP ${ip}`)
      }
      const filled = ioSnapshot()
      assert.equal(filled.gets, before.gets + cap)
      assert.equal(filled.finds, before.finds, '缺席票不得 findUnique')
      const blockedIp = '10.6.6.6'
      const blocked = await orderQuoteGetTracker(trackerInput(blockedIp, 'bud-over', 'bud-over-tok'))
      assert.equal(blocked, blockedIp)
      assert.equal(ioSnapshot().gets, filled.gets, '预算表满时不得淘汰他人，也不得再 get')
      assert.equal(ioSnapshot().finds, filled.finds)
      console.log(`  PASS 未知票 IP 预算表 ${cap}：满则直接 IP 桶且不再读`)
    }

    app.get(OrderQuoteThrottleBinder).onModuleInit()
    resetRedisCooldownForTests()
    {
      const cap = ORDER_QUOTE_TERMINAL_LIMITS.inflightCapacity
      const perIp = ORDER_QUOTE_TERMINAL_LIMITS.unknownPerIp
      const before = ioSnapshot()
      const hold = armHold()
      const pending: Array<Promise<string>> = []
      for (let index = 0; index < cap; index += 1) {
        const ip = `10.8.${Math.floor(index / perIp)}.1`
        pending.push(Promise.resolve(orderQuoteGetTracker(trackerInput(ip, `inf-${index}`, `inf-tok-${index}`))).then((value) => value))
      }
      const group = Math.floor((cap - 1) / perIp)
      const extraIp = `10.8.${group}.1`
      const extraPromise = Promise.resolve(orderQuoteGetTracker(trackerInput(extraIp, 'inf-extra', 'inf-extra-tok'))).then((value) => value)
      assert.equal(ioSnapshot().gets, before.gets + cap, '每个在途槽开始 1 次 get')
      assert.equal(ioSnapshot().finds, before.finds)
      hold.release()
      const extra = await extraPromise
      await Promise.all(pending)
      assert.equal(extra, extraIp, '在途槽满时应直接退回 IP')
      assert.equal(ioSnapshot().gets, before.gets + cap, '在途槽满不得再 get')
      assert.equal(ioSnapshot().finds, before.finds, '这些缺席票完成时也不得 findUnique')
      console.log(`  PASS 在途槽 ${cap}：满则本请求按 IP，不再开新的 validate`)
    }

    const end = ioSnapshot()
    assert.equal(end.setExs, 0, '终端合同不得 setEx')
    assert.equal(end.getDels, 0, '终端合同不得 getDel')
    assert.equal(end.tokenChecks, 0, '终端合同不得 validateTerminalToken')
    console.log('  PASS 终端合同没有 setEx、getDel、validateTerminalToken')
  } finally {
    redisAdapter.hold = null
    redisAdapter.failGet = null
    releaseHold?.()
    resetRedisCooldownForTests()
    clock?.restore()
    if (app) await app.close()
  }
}

async function verifyIpWideCeiling(): Promise<void> {
  const ceiling = 12
  const { app, baseUrl } = await startApp(ceiling)
  try {
    const ip = '203.0.113.90'
    const first = await quoteMany(baseUrl, ip, LIMIT, { auth: `Bearer ${memberToken('m-he', 'm-he-s1')}` })
    assert.deepEqual(first, allOk(LIMIT))
    const second = await quoteMany(baseUrl, ip, 3, { auth: `Bearer ${memberToken('m-lv', 'm-lv-s1')}` })
    assert.deepEqual(second, [200, 200, 429], `同一 IP 合计第 ${ceiling + 1} 次应被 ip-wide 天花板拦下`)
    console.log(`  PASS ip-wide 单 IP 天花板对报价仍生效（同 IP 多会员合计第 ${ceiling + 1} 次 429）`)

    seedTerminal('term-wide-a', 'wide-tok-a')
    seedTerminal('term-wide-b', 'wide-tok-b')
    const wideIp = '203.0.113.91'
    const wideBefore = ioSnapshot()
    assert.deepEqual(
      await quoteMany(baseUrl, wideIp, LIMIT, { terminalHeader: 'term-wide-a', sessionToken: 'wide-tok-a' }),
      allOk(LIMIT),
    )
    assert.deepEqual(
      await quoteMany(baseUrl, wideIp, 3, { terminalHeader: 'term-wide-b', sessionToken: 'wide-tok-b' }),
      [200, 200, 429],
      '两台已验终端合计仍被 ip-wide 拦住',
    )
    assert.equal(ioSnapshot().setExs, wideBefore.setExs)
    assert.equal(ioSnapshot().getDels, wideBefore.getDels)
    assert.equal(ioSnapshot().tokenChecks, wideBefore.tokenChecks)
    console.log(`  PASS ip-wide 对两台已验终端仍生效（同 IP 合计第 ${ceiling + 1} 次 429）`)
  } finally {
    await app.close()
    delete process.env['THROTTLE_IP_WIDE_PER_MINUTE']
  }
}

async function verifyStatic(): Promise<void> {
  const paramTypes = (Reflect as unknown as { getMetadata: (k: string, t: object) => unknown }).getMetadata(
    'design:paramtypes',
    OrderQuoteThrottleBinder,
  ) as unknown[] | undefined
  assert.deepEqual(paramTypes, [JwtService, TerminalSessionService], 'binder 注入 JwtService 与 TerminalSessionService，不注入 Redis 或 Prisma')

  const throttleSrc = await readFile(path.join(API_ROOT, 'src/payment/order-quote-throttle.ts'), 'utf8')
  const throttleCode = codeOnly(throttleSrc)
  assert.ok(throttleSrc.split('\n').length < 500, 'order-quote-throttle.ts 必须少于 500 行')
  assert.equal(orderQuoteGetTracker.constructor.name, 'Function', 'tracker 必须是同步函数')
  assert.equal(typeof orderQuoteGetTracker({ ip: '198.51.100.1', headers: {} }), 'string', '未绑定验签时 tracker 同步返回 IP，不能返回 Promise')
  assert.ok(!functionBody(throttleCode, 'orderQuoteGetTracker').includes('await'), 'orderQuoteGetTracker 函数体不能 await')
  const awaitAt = throttleCode.indexOf('await')
  const helperAt = throttleCode.indexOf('function runTerminalValidation')
  const helperEnd = helperAt + functionBody(throttleCode, 'runTerminalValidation').length + 'function runTerminalValidation'.length
  assert.equal([...throttleCode.matchAll(/\bawait\b/g)].length, 1, 'await 只能出现一处')
  assert.ok(awaitAt > helperAt && awaitAt < helperEnd, 'await 只能出现在终端验票辅助函数 runTerminalValidation')
  assert.ok(!/\bfrom\s+['"][^'"]*(redis|prisma)[^'"]*['"]/.test(throttleCode), 'order-quote-throttle.ts 不得 import Redis 或 Prisma')
  for (const banned of ['RedisService', 'PrismaService', 'resolveOptionalEndUser', 'touchMemberSession']) {
    assert.ok(!throttleCode.includes(`'${banned}'`) && !new RegExp(`\\b${banned}\\b`).test(throttleCode), `order-quote-throttle.ts 不得使用 ${banned}`)
  }
  for (const banned of ['.refresh(', '.issue(', 'createBootTicket', 'exchangeBootTicket', 'resolveTerminalScopedTracker', 'TerminalScopedThrottle']) {
    assert.ok(!throttleCode.includes(banned), `order-quote-throttle.ts 不得出现 ${banned}`)
  }
  assert.deepEqual(ORDER_QUOTE_TERMINAL_LIMITS, {
    positiveTtlMs: 60_000,
    positiveCapacity: 256,
    negativeTtlMs: 30_000,
    negativeCapacity: 256,
    unknownPerIp: 10,
    unknownWindowMs: 60_000,
    unknownIpCapacity: 1024,
    callerWaitMs: 200,
    inflightCapacity: 1024,
  })
  assert.equal(ORDER_QUOTE_TERMINAL_LIMITS.unknownPerIp, ORDER_QUOTE_LIMIT_PER_MINUTE)

  const guardsOnClass = (Reflect as unknown as { getMetadata: (k: string, t: object) => unknown }).getMetadata(GUARDS_METADATA, OrderQuoteController)
  const guardsOnHandler = (Reflect as unknown as { getMetadata: (k: string, t: object) => unknown }).getMetadata(
    GUARDS_METADATA,
    OrderQuoteController.prototype.quote,
  )
  assert.equal(guardsOnClass, undefined, '报价控制器不应有鉴权守卫（匿名路由）')
  assert.equal(guardsOnHandler, undefined, '报价方法不应有鉴权守卫（匿名路由）')

  const controllerSrc = await readFile(path.join(API_ROOT, 'src/payment/order-quote.controller.ts'), 'utf8')
  assert.ok(controllerSrc.includes('@OrderQuoteThrottle()'), '报价方法必须用 @OrderQuoteThrottle()')
  assert.ok(!/@Throttle\(/.test(controllerSrc), '报价控制器不得再写裸 @Throttle')
  assert.ok(!controllerSrc.includes('TerminalScopedThrottle'), '报价不得用 TerminalScopedThrottle（它信未验签的头）')

  const moduleSrc = await readFile(path.join(API_ROOT, 'src/print-jobs/print-jobs.module.ts'), 'utf8')
  assert.ok(moduleSrc.includes('OrderQuoteThrottleBinder'), 'PrintJobsModule 必须注册 OrderQuoteThrottleBinder，否则线上验签不会绑上')
  console.log('  PASS 静态：binder 注入 JwtService 与 TerminalSessionService；会员路径不 await；不 import Redis/Prisma；控制器无鉴权守卫')
}

function functionBody(code: string, name: string): string {
  const start = code.indexOf(`function ${name}`)
  assert.ok(start >= 0, `找不到函数 ${name}`)
  const brace = code.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1
    else if (code[i] === '}') {
      depth -= 1
      if (depth === 0) return code.slice(brace, i + 1)
    }
  }
  throw new Error(`函数 ${name} 没有结束`)
}

async function main(): Promise<void> {
  console.log('verify:order-quote-throttle-identity')
  await verifyStatic()
  await verifyRuntime()
  await verifyTerminalIdentity()
  await verifyIpWideCeiling()
  assert.ok(seenStatuses.length > 0, '必须打到真实 HTTP')
  assert.ok(!seenStatuses.includes(401), `报价不应回 401（身份只决定额度归属），实际状态: ${[...new Set(seenStatuses)].join(',')}`)
  assert.ok(
    seenStatuses.every((status) => status === 200 || status === 429),
    `报价只应出现 200 或 429，实际: ${[...new Set(seenStatuses)].join(',')}`,
  )
  assert.equal(ioSnapshot().setExs, 0, '报价全程不得 setEx')
  assert.equal(ioSnapshot().getDels, 0, '报价全程不得 getDel')
  assert.equal(ioSnapshot().tokenChecks, 0, '报价全程不得 validateTerminalToken')
  assert.ok(ioSnapshot().gets > 0, '终端合同必须打到真实 redis.get')
  assert.ok(ioSnapshot().finds > 0, '终端合同必须打到真实 findUnique')
  console.log(`  PASS 全部 ${seenStatuses.length} 次 HTTP 只有 200 与 429，没有 401`)
  console.log('  PASS 全程 setEx、getDel、validateTerminalToken 为 0')
  console.log('verify:order-quote-throttle-identity PASS')
}

main().catch((err: unknown) => {
  console.error('verify:order-quote-throttle-identity FAIL')
  console.error(err)
  process.exit(1)
})
