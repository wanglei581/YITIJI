import assert from 'node:assert/strict'
import type { JwtService } from '@nestjs/jwt'
import { encryptPhone, hashPhone } from '../../src/common/crypto/phone-identity'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { PERSONAL_CHARGE_SETTING_KEY } from '../../src/payment/terminal-charge.contract'
import { MINIAPP_VIRTUAL_PAY_ENABLED_KEY } from '../../src/virtual-pay/virtual-pay.contract'

const OWNER = 'vpay-credit-owner'
const OTHER = 'vpay-credit-other'
const EMPTY = 'vpay-credit-empty'

interface CreditItem {
  serviceKind?: string
  createdAt?: string
}

interface CallResult {
  status: number
  json: { error?: { code?: string }; items?: CreditItem[]; [key: string]: unknown }
}

/**
 * 会员只看自己仍可用的权益。开关关掉也不藏已有的。
 * 用掉、退款、别人的、注销后断开账号的，都不出现。
 */
export async function assertVirtualPayCredits(options: {
  prisma: PrismaService
  call: (method: string, path: string, body?: unknown, extra?: Record<string, string>) => Promise<CallResult>
  jwt: JwtService
  redis: { setEx(key: string, ttl: number, value: string): Promise<unknown> }
}): Promise<void> {
  const { prisma, call, jwt, redis } = options
  await prisma.endUser.create({
    data: { id: OWNER, phoneHash: hashPhone('13800138005'), phoneEnc: encryptPhone('13800138005'), wxOpenId: 'openid-credit-owner' },
  })
  await prisma.endUser.create({
    data: { id: OTHER, phoneHash: hashPhone('13800138006'), phoneEnc: encryptPhone('13800138006'), wxOpenId: 'openid-credit-other' },
  })
  await prisma.endUser.create({
    data: { id: EMPTY, phoneHash: hashPhone('13800138007'), phoneEnc: encryptPhone('13800138007'), wxOpenId: 'openid-credit-empty' },
  })
  const older = new Date(Date.now() - 120_000)
  const newer = new Date(Date.now() - 10_000)
  const consumedAt = new Date(Date.now() - 60_000)
  const otherAt = new Date(Date.now() - 30_000)
  const ownOptimize = await grant(prisma, OWNER, 'resume_optimize', 'vpcreditown1', 'available', older)
  const ownInterview = await grant(prisma, OWNER, 'mock_interview', 'vpcreditown2', 'available', newer)
  await grant(prisma, OWNER, 'resume_optimize', 'vpcreditcon1', 'consumed', consumedAt)
  await grant(prisma, OWNER, 'mock_interview', 'vpcreditref1', 'refunded', new Date(Date.now() - 40_000))
  const other = await grant(prisma, OTHER, 'resume_optimize', 'vpcreditoth1', 'available', otherAt)

  await prisma.platformSetting.upsert({
    where: { key: MINIAPP_VIRTUAL_PAY_ENABLED_KEY },
    create: { key: MINIAPP_VIRTUAL_PAY_ENABLED_KEY, value: 'false' },
    update: { value: 'false' },
  })
  await prisma.platformSetting.upsert({
    where: { key: PERSONAL_CHARGE_SETTING_KEY },
    create: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'false' },
    update: { value: 'false' },
  })

  const anon = await call('GET', '/api/v1/member/service-credits')
  assert.equal(anon.status, 401)
  const admin = await call('GET', '/api/v1/member/service-credits', undefined, {
    authorization: `Bearer ${jwt.sign({ sub: 'vpay-admin', ver: 0 })}`,
  })
  assert.equal(admin.status, 401)

  const ownerHeaders = await memberHeaders(redis, jwt, OWNER, 'vpay-credit-owner-jti')
  const listed = await call('GET', '/api/v1/member/service-credits', undefined, ownerHeaders)
  assert.equal(listed.status, 200)
  assert.equal(listed.json.purchaseEnabled, false, '开关关闭时应透传 purchaseEnabled=false')
  const items = listed.json.items ?? []
  assert.equal(items.length, 2)
  assert.equal(items[0]?.serviceKind, 'mock_interview')
  assert.equal(items[0]?.createdAt, ownInterview.toISOString())
  assert.equal(items[1]?.serviceKind, 'resume_optimize')
  assert.equal(items[1]?.createdAt, ownOptimize.toISOString())
  const text = JSON.stringify(listed.json)
  assert.equal(text.includes(other.toISOString()), false)
  assert.equal(text.includes(consumedAt.toISOString()), false)
  assert.equal(text.includes('80808'), false)
  assert.equal(text.includes('FAKEGOOD'), false)
  assert.equal(text.includes('openid'), false)
  assert.equal(text.includes('consumed'), false)
  assert.equal(text.includes('refunded'), false)

  const emptyHeaders = await memberHeaders(redis, jwt, EMPTY, 'vpay-credit-empty-jti')
  const empty = await call('GET', '/api/v1/member/service-credits', undefined, emptyHeaders)
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.json.items, [])
  assert.equal(empty.json.purchaseEnabled, false)

  // FG-3：两个总开关均开启且已有已配置商品时 purchaseEnabled=true；仅开个人收费总开关时仍为 false
  await prisma.platformSetting.upsert({
    where: { key: PERSONAL_CHARGE_SETTING_KEY },
    create: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'true' },
    update: { value: 'true' },
  })
  const halfOn = await call('GET', '/api/v1/member/service-credits', undefined, emptyHeaders)
  assert.equal(halfOn.status, 200)
  assert.equal(halfOn.json.purchaseEnabled, false)
  await prisma.platformSetting.upsert({
    where: { key: MINIAPP_VIRTUAL_PAY_ENABLED_KEY },
    create: { key: MINIAPP_VIRTUAL_PAY_ENABLED_KEY, value: 'true' },
    update: { value: 'true' },
  })
  const fullOn = await call('GET', '/api/v1/member/service-credits', undefined, emptyHeaders)
  assert.equal(fullOn.status, 200)
  assert.equal(fullOn.json.purchaseEnabled, true, '两项总开关均开启且已配置商品时应透传 purchaseEnabled=true')
  console.log('PASS 开关关着也只回本人可用权益，并如实透传 purchaseEnabled')
}

async function grant(
  prisma: PrismaService,
  endUserId: string,
  serviceKind: string,
  outTradeNo: string,
  status: string,
  createdAt: Date,
): Promise<Date> {
  const order = await prisma.virtualPayOrder.create({
    data: {
      endUserId,
      openId: `openid-${endUserId}`,
      serviceKind,
      productId: 'FAKEGOOD1',
      priceCents: 80808,
      env: 0,
      status: 'paid',
      outTradeNo,
    },
  })
  const credit = await prisma.memberServiceCredit.create({
    data: { endUserId, serviceKind, sourceOrderId: order.id, status, createdAt },
  })
  return credit.createdAt
}

async function memberHeaders(
  redis: { setEx(key: string, ttl: number, value: string): Promise<unknown> },
  jwt: JwtService,
  endUserId: string,
  jti: string,
): Promise<Record<string, string>> {
  await redis.setEx(`member:session:${jti}`, 1800, endUserId)
  return { authorization: `Bearer ${jwt.sign({ sub: endUserId, jti }, { audience: 'enduser' })}` }
}
