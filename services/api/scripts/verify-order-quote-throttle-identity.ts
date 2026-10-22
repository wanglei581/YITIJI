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
 *   5. tracker 不碰存储：binder 只注入 JwtService；没绑定验签时一律按 IP（fail-closed）；
 *      模块销毁时复位；
 *   6. `ip-wide` 单 IP 天花板对本路由仍然有效；
 *   7. 静态：控制器用 @OrderQuoteThrottle()，没有鉴权守卫，不再写裸 @Throttle、不用 TerminalScopedThrottle。
 *
 * 全程用真实的 ThrottlerGuard、真实的 buildThrottlerConfig()、真实的报价控制器、真实的 JwtService
 * 签发与验签、真实 HTTP 请求；只把报价业务（OrderQuoteService）换成桩。不依赖数据库、Redis 或外部服务。
 * 测试应用打开 trust proxy，用 X-Forwarded-For 模拟不同出口 IP（只在测试里这样做；线上取 IP 规则不变）。
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Module, type INestApplication } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import { JwtModule, JwtService } from '@nestjs/jwt'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { buildThrottlerConfig } from '../src/common/throttler/terminal-throttle'
import { OrderQuoteController } from '../src/payment/order-quote.controller'
import { OrderQuoteService } from '../src/payment/order-quote.service'
import {
  ORDER_QUOTE_LIMIT_PER_MINUTE,
  OrderQuoteThrottleBinder,
  bindOrderQuoteMemberVerifier,
  orderQuoteGetTracker,
} from '../src/payment/order-quote-throttle'

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

async function startApp(ipWideLimit: number): Promise<{ app: INestApplication; baseUrl: string }> {
  // buildThrottlerConfig() 在建配置时读一次 env，所以必须在定义模块之前写入。
  process.env['THROTTLE_IP_WIDE_PER_MINUTE'] = String(ipWideLimit)
  @Module({
    imports: [ThrottlerModule.forRoot(buildThrottlerConfig()), JwtModule.register({ secret: SECRET })],
    controllers: [OrderQuoteController],
    providers: [
      { provide: OrderQuoteService, useValue: quoteStub },
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

async function quote(
  baseUrl: string,
  ip: string,
  opts: { auth?: string; body?: Record<string, unknown>; terminalHeader?: string } = {},
): Promise<number> {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': ip }
  if (opts.auth) headers['authorization'] = opts.auth
  if (opts.terminalHeader) headers['x-terminal-id'] = opts.terminalHeader
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

async function quoteMany(
  baseUrl: string,
  ip: string,
  times: number,
  opts: { auth?: string; body?: Record<string, unknown> } = {},
): Promise<number[]> {
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
    assert.ok(quoteStub.calls > 0, '报价业务桩应被调用过（请求确实穿过了限流）')
  } finally {
    await app.close()
  }

  // ── 5b. 模块销毁时复位：之后有效令牌也按 IP ───────────────────────────
  const afterClose = orderQuoteGetTracker({ ip: '203.0.113.80', headers: { authorization: `Bearer ${memberToken('m-chen', 'm-chen-s1')}` } })
  assert.equal(afterClose, '203.0.113.80', '模块销毁后验签应复位，tracker 退回纯 IP')
  console.log('  PASS 模块销毁时验签复位，tracker 退回纯 IP')
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
  assert.deepEqual(paramTypes, [JwtService], 'binder 只能注入 JwtService：tracker 在计数前执行，不能碰 Redis 或数据库')

  const throttleSrc = await readFile(path.join(API_ROOT, 'src/payment/order-quote-throttle.ts'), 'utf8')
  const throttleCode = codeOnly(throttleSrc)
  assert.equal(orderQuoteGetTracker.constructor.name, 'Function', 'tracker 必须是同步函数')
  assert.equal(typeof orderQuoteGetTracker({ ip: '198.51.100.1', headers: {} }), 'string', '未绑定验签时 tracker 同步返回 IP，不能返回 Promise')
  assert.ok(!/\bawait\b/.test(throttleCode), '验签与 tracker 必须同步，不能 await Redis、数据库或会话续期')
  assert.ok(!/\bfrom\s+['"][^'"]*(redis|prisma)[^'"]*['"]/.test(throttleCode), 'order-quote-throttle.ts 不得 import Redis 或 Prisma')
  for (const banned of ['RedisService', 'PrismaService', 'resolveOptionalEndUser', 'touchMemberSession', 'x-terminal-id']) {
    assert.ok(!throttleCode.includes(`'${banned}'`) && !new RegExp(`\\b${banned}\\b`).test(throttleCode), `order-quote-throttle.ts 不得使用 ${banned}`)
  }

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
  console.log('  PASS 静态：binder 只注入 JwtService；不碰存储；控制器无鉴权守卫、只用 @OrderQuoteThrottle()；模块已注册 binder')
}

async function main(): Promise<void> {
  console.log('verify:order-quote-throttle-identity')
  await verifyStatic()
  await verifyRuntime()
  await verifyIpWideCeiling()
  assert.ok(seenStatuses.length > 0, '必须打到真实 HTTP')
  assert.ok(!seenStatuses.includes(401), `报价不应回 401（身份只决定额度归属），实际状态: ${[...new Set(seenStatuses)].join(',')}`)
  assert.ok(
    seenStatuses.every((status) => status === 200 || status === 429),
    `报价只应出现 200 或 429，实际: ${[...new Set(seenStatuses)].join(',')}`,
  )
  console.log(`  PASS 全部 ${seenStatuses.length} 次 HTTP 只有 200 与 429，没有 401`)
  console.log('verify:order-quote-throttle-identity PASS')
}

main().catch((err: unknown) => {
  console.error('verify:order-quote-throttle-identity FAIL')
  console.error(err)
  process.exit(1)
})
