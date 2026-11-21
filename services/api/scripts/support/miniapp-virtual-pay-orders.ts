import assert from 'node:assert/strict'
import { createHmac } from 'crypto'
import type { JwtService } from '@nestjs/jwt'
import { encryptPhone, hashPhone } from '../../src/common/crypto/phone-identity'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { PERSONAL_CHARGE_SETTING_KEY } from '../../src/payment/terminal-charge.contract'
import { MINIAPP_VIRTUAL_PAY_ENABLED_KEY, goodsSettingKey } from '../../src/virtual-pay/virtual-pay.contract'
import { VIRTUAL_PAY_DIAGNOSTIC_ACTION } from '../../src/virtual-pay/virtual-pay-order.service'
import { calcPaySig, calcUserSignature } from '../../src/virtual-pay/virtual-pay-sign'

const OFFICIAL_BODY = '{"openid": "xxx", "user_ip": "127.0.0.1", "env": 0}'
const OFFICIAL_PAY_SIG = 'c37809f27c6d7fd1837ad2500a04512b66b34fd793a39a385fade56dca89a4b5'
const OFFICIAL_SESSION_KEY = '9hAb/NEYUlkaMBEsmFgzig=='
const OFFICIAL_SIGNATURE = '089d9e8dc5d308977360c4b79ec600a93d736802802a807d634192328032f6c7'
const MEMBER = 'vpay-order-member'
const OPEN_ID = 'openid-order-member'
const FAKE_PRODUCT_ID = 'FAKEGOOD1'
const FAKE_PRICE_CENTS = 80808
const APP_KEY = 'app-key-verify'

export function assertOfficialVirtualPaySignatures(): void {
  assert.equal(calcPaySig('/xpay/query_user_balance', OFFICIAL_BODY, '12345'), OFFICIAL_PAY_SIG)
  assert.equal(calcUserSignature(OFFICIAL_BODY, OFFICIAL_SESSION_KEY), OFFICIAL_SIGNATURE)
  const decoded = createHmac('sha256', Buffer.from(OFFICIAL_SESSION_KEY, 'base64'))
    .update(OFFICIAL_BODY, 'utf8')
    .digest('hex')
  assert.notEqual(decoded, OFFICIAL_SIGNATURE)
  assert.notEqual(calcPaySig('/xpay/query_user_balance', `${OFFICIAL_BODY} `, '12345'), OFFICIAL_PAY_SIG)
  console.log('PASS 官方示例 pay_sig / signature；base64 解码后的密钥对不上')
}

interface CallResult {
  status: number
  json: { error?: { code?: string }; [key: string]: unknown }
}

export async function assertVirtualPayOrders(options: {
  prisma: PrismaService
  call: (method: string, path: string, body?: unknown, extra?: Record<string, string>) => Promise<CallResult>
  jwt: JwtService
  redis: { setEx(key: string, ttl: number, value: string): Promise<unknown> }
}): Promise<void> {
  const { prisma, call, jwt, redis } = options
  await prisma.endUser.create({
    data: {
      id: MEMBER,
      phoneHash: hashPhone('13800138000'),
      phoneEnc: encryptPhone('13800138000'),
      wxOpenId: OPEN_ID,
    },
  })
  const jti = 'vpay-order-jti'
  await redis.setEx(`member:session:${jti}`, 1800, MEMBER)
  const memberHeaders = { authorization: `Bearer ${jwt.sign({ sub: MEMBER, jti }, { audience: 'enduser' })}` }
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (!url.includes('api.weixin.qq.com')) return originalFetch(input, init)
    if (!url.includes('/sns/jscode2session')) throw new Error(`unexpected wechat url ${url.split('?')[0]}`)
    const code = new URL(url).searchParams.get('js_code')
    if (code === 'mismatch-code') {
      return json({ openid: 'openid-other', session_key: OFFICIAL_SESSION_KEY })
    }
    if (code === 'no-session-code') return json({ openid: OPEN_ID })
    return json({ openid: OPEN_ID, session_key: OFFICIAL_SESSION_KEY })
  }) as typeof fetch

  const savedEnv = snapshotEnv()
  try {
    applyReadyEnv()
    await enableSelling(prisma)
    const before = await prisma.virtualPayOrder.count()

    const mismatch = await call('POST', '/api/v1/member/virtual-pay/orders', {
      serviceKind: 'resume_optimize',
      code: 'mismatch-code',
    }, memberHeaders)
    assert.equal(mismatch.status, 409)
    assert.equal(mismatch.json.error?.code, 'VPAY_OPENID_MISMATCH')
    assert.equal(await prisma.virtualPayOrder.count(), before)

    await prisma.platformSetting.update({
      where: { key: MINIAPP_VIRTUAL_PAY_ENABLED_KEY },
      data: { value: 'false' },
    })
    const disabled = await call('POST', '/api/v1/member/virtual-pay/orders', {
      serviceKind: 'resume_optimize',
      code: 'ok-code',
    }, memberHeaders)
    assert.equal(disabled.status, 403)
    assert.equal(disabled.json.error?.code, 'VPAY_DISABLED')
    assert.equal(await prisma.virtualPayOrder.count(), before)
    await prisma.platformSetting.update({
      where: { key: MINIAPP_VIRTUAL_PAY_ENABLED_KEY },
      data: { value: 'true' },
    })

    await prisma.platformSetting.delete({ where: { key: goodsSettingKey('resume_optimize') } })
    const unconfigured = await call('POST', '/api/v1/member/virtual-pay/orders', {
      serviceKind: 'resume_optimize',
      code: 'ok-code',
    }, memberHeaders)
    assert.equal(unconfigured.status, 409)
    assert.equal(unconfigured.json.error?.code, 'VPAY_GOODS_UNCONFIGURED')
    assert.equal(await prisma.virtualPayOrder.count(), before)
    await writeGoods(prisma)

    delete process.env['WECHAT_MINIAPP_VPAY_APP_KEY']
    const missing = await call('POST', '/api/v1/member/virtual-pay/orders', {
      serviceKind: 'resume_optimize',
      code: 'ok-code',
    }, memberHeaders)
    assert.equal(missing.status, 503)
    assert.equal(missing.json.error?.code, 'VPAY_CONFIG_MISSING')
    assert.equal(await prisma.virtualPayOrder.count(), before)
    const diagnostic = await prisma.auditLog.findFirstOrThrow({
      where: { action: VIRTUAL_PAY_DIAGNOSTIC_ACTION },
      orderBy: { createdAt: 'desc' },
    })
    assert.equal(JSON.parse(diagnostic.payloadJson).reason, 'env_missing')
    assert.equal(diagnostic.payloadJson.includes(OFFICIAL_SESSION_KEY), false)
    applyReadyEnv()

    process.env['NODE_ENV'] = 'production'
    process.env['WECHAT_MINIAPP_VPAY_ENV'] = '1'
    const sandbox = await call('POST', '/api/v1/member/virtual-pay/orders', {
      serviceKind: 'resume_optimize',
      code: 'ok-code',
    }, memberHeaders)
    assert.equal(sandbox.status, 503)
    assert.equal(sandbox.json.error?.code, 'VPAY_SANDBOX_FORBIDDEN')
    assert.equal(await prisma.virtualPayOrder.count(), before)

    // 生产 env=0 只配现网键（不配沙箱键）必须能正常下单；缺现网键则失败关闭不建单
    process.env['NODE_ENV'] = 'production'
    process.env['WECHAT_MINIAPP_VPAY_ENV'] = '0'
    delete process.env['WECHAT_MINIAPP_VPAY_SANDBOX_APP_KEY']
    const prodOrder = await call('POST', '/api/v1/member/virtual-pay/orders', {
      serviceKind: 'resume_optimize',
      code: 'ok-code',
    }, memberHeaders)
    assert.equal(prodOrder.status, 201, '生产 env=0 只配现网键必须能下单')
    const prodSignData = prodOrder.json['signData'] as string
    assert.equal(prodOrder.json['paySig'], calcPaySig('requestVirtualPayment', prodSignData, APP_KEY))
    assert.equal((JSON.parse(prodSignData) as { env: number }).env, 0)
    const countAfterProd = await prisma.virtualPayOrder.count()
    assert.equal(countAfterProd, before + 1)

    delete process.env['WECHAT_MINIAPP_VPAY_APP_KEY']
    const prodMissing = await call('POST', '/api/v1/member/virtual-pay/orders', {
      serviceKind: 'resume_optimize',
      code: 'ok-code',
    }, memberHeaders)
    assert.equal(prodMissing.status, 503, '生产 env=0 缺现网键必须失败关闭')
    assert.equal(prodMissing.json.error?.code, 'VPAY_CONFIG_MISSING')
    assert.equal(await prisma.virtualPayOrder.count(), countAfterProd)

    applyReadyEnv()
    process.env['NODE_ENV'] = 'test'
    process.env['WECHAT_MINIAPP_VPAY_ENV'] = '0'

    const created = await call('POST', '/api/v1/member/virtual-pay/orders', {
      serviceKind: 'resume_optimize',
      code: 'ok-code',
    }, memberHeaders)
    assert.equal(created.status, 201)
    const signData = created.json['signData']
    assert.equal(typeof signData, 'string')
    assert.equal(created.json['paySig'], calcPaySig('requestVirtualPayment', signData as string, APP_KEY))
    assert.equal(created.json['signature'], calcUserSignature(signData as string, OFFICIAL_SESSION_KEY))
    assert.equal(created.json['mode'], 'short_series_goods')
    const parsed = JSON.parse(signData as string) as {
      buyQuantity: number
      goodsPrice: number
      attach: string
      outTradeNo: string
      env: number
      currencyType: string
    }
    assert.equal(parsed.buyQuantity, 1)
    assert.equal(parsed.goodsPrice, FAKE_PRICE_CENTS)
    assert.equal(parsed.attach, 'resume_optimize')
    assert.equal(parsed.env, 0)
    assert.equal(parsed.currencyType, 'CNY')
    assert.match(parsed.outTradeNo, /^vp[0-9a-f]{24}$/)
    const row = await prisma.virtualPayOrder.findUniqueOrThrow({ where: { outTradeNo: parsed.outTradeNo } })
    assert.equal(row.status, 'pending')
    assert.equal(row.openId, OPEN_ID)
    assert.equal(row.priceCents, FAKE_PRICE_CENTS)
    assert.equal(JSON.stringify(row).includes(OFFICIAL_SESSION_KEY), false)
    const audits = await prisma.auditLog.findMany()
    assert.equal(audits.some((item) => item.payloadJson.includes(OFFICIAL_SESSION_KEY)), false)
    console.log('PASS 下单签名对得上；开关关、没配道具、缺变量、openid 不符都不建单')
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv(savedEnv)
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

function snapshotEnv(): Record<string, string | undefined> {
  const keys = [
    'NODE_ENV',
    'WECHAT_MINIAPP_APPID',
    'WECHAT_MINIAPP_APPSECRET',
    'WECHAT_MINIAPP_VPAY_OFFER_ID',
    'WECHAT_MINIAPP_VPAY_APP_KEY',
    'WECHAT_MINIAPP_VPAY_SANDBOX_APP_KEY',
    'WECHAT_MINIAPP_VPAY_ENV',
    'WECHAT_MINIAPP_MESSAGE_TOKEN',
    'WECHAT_MINIAPP_MESSAGE_ENCODING_AES_KEY',
  ]
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]))
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function applyReadyEnv(): void {
  process.env['WECHAT_MINIAPP_APPID'] = 'wx-verify-appid'
  process.env['WECHAT_MINIAPP_APPSECRET'] = 'verify-app-secret'
  process.env['WECHAT_MINIAPP_VPAY_OFFER_ID'] = 'offer-verify'
  process.env['WECHAT_MINIAPP_VPAY_APP_KEY'] = APP_KEY
  process.env['WECHAT_MINIAPP_VPAY_SANDBOX_APP_KEY'] = 'sandbox-key-verify'
  process.env['WECHAT_MINIAPP_VPAY_ENV'] = '0'
  process.env['WECHAT_MINIAPP_MESSAGE_TOKEN'] = 'message-token-verify'
  process.env['WECHAT_MINIAPP_MESSAGE_ENCODING_AES_KEY'] = Buffer.alloc(32, 7).toString('base64').replace(/=+$/, '')
}

async function enableSelling(prisma: PrismaService): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { key: PERSONAL_CHARGE_SETTING_KEY },
    create: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'true' },
    update: { value: 'true' },
  })
  await prisma.platformSetting.upsert({
    where: { key: MINIAPP_VIRTUAL_PAY_ENABLED_KEY },
    create: { key: MINIAPP_VIRTUAL_PAY_ENABLED_KEY, value: 'true' },
    update: { value: 'true' },
  })
  await writeGoods(prisma)
}

async function writeGoods(prisma: PrismaService): Promise<void> {
  const key = goodsSettingKey('resume_optimize')
  const value = JSON.stringify({ productId: FAKE_PRODUCT_ID, priceCents: FAKE_PRICE_CENTS })
  await prisma.platformSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}
