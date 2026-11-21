import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import type { AuditService } from '../../src/audit/audit.service'
import type { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { executeServiceOrderRefund } from '../../src/payment/service-order.payment'
import { finishServiceOrder, markServiceOrderNotMade } from '../../src/payment/service-order.settle'
import { ServiceOrderService } from '../../src/payment/service-order.service'
import { PERSONAL_CHARGE_SETTING_KEY } from '../../src/payment/terminal-charge.contract'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { TerminalSessionService } from '../../src/terminals/terminal-session.service'
import {
  VIRTUAL_PAY_CREDIT_REDEEMED_AUDIT_ACTION,
  VIRTUAL_PAY_CREDIT_RESTORED_AUDIT_ACTION,
  restoreMiniappCreditForServiceOrder,
} from '../../src/virtual-pay/virtual-pay-credit-redeem'
import { MINIAPP_CREDIT_PROVIDER } from '../../src/virtual-pay/virtual-pay.contract'

export interface RedeemHttpCaller {
  post(
    path: string,
    body: Record<string, unknown>,
    headers: Record<string, string>,
  ): Promise<{ status: number; json: Record<string, unknown> }>
  get(
    path: string,
    headers: Record<string, string>,
  ): Promise<{ status: number; json: Record<string, unknown> }>
}

export interface RedeemVerifyContext {
  prisma: PrismaService
  audit: AuditService
  sessions: TerminalSessionService
  serviceOrders: ServiceOrderService
  registry: PaymentProviderRegistry
  http: RedeemHttpCaller
  issueMemberToken: (endUserId: string) => Promise<string>
  issueTerminalHeaders: (terminalId: string) => Promise<Record<string, string>>
}

async function seedPaidCredit(
  prisma: PrismaService,
  endUserId: string,
  serviceKind: 'resume_optimize' | 'mock_interview',
  suffix: string,
): Promise<{ orderId: string; creditId: string }> {
  const order = await prisma.virtualPayOrder.create({
    data: {
      endUserId,
      openId: `wx-openid-${suffix}`,
      serviceKind,
      productId: 'FAKE_P2_ITEM',
      priceCents: 100,
      env: 1,
      status: 'paid',
      outTradeNo: `vp${randomBytes(12).toString('hex')}`,
      wxOrderId: `wxord_${suffix}`,
      paidAt: new Date(),
    },
  })
  const credit = await prisma.memberServiceCredit.create({
    data: {
      endUserId,
      serviceKind,
      sourceOrderId: order.id,
      status: 'available',
    },
  })
  return { orderId: order.id, creditId: credit.id }
}

async function seedTerminalAndSession(
  prisma: PrismaService,
  opts: {
    id: string
    orgType: string | null
    userChargeMode: 'user_pays' | 'org_pays'
    resumeCents: number
    interviewCents: number
  },
): Promise<{ terminalId: string; kioskSessionId: string }> {
  let orgId: string | null = null
  if (opts.orgType) {
    const org = await prisma.organization.create({
      data: { id: `org-${opts.id}`, name: `机构-${opts.id}`, type: opts.orgType },
    })
    orgId = org.id
  }
  await prisma.terminal.create({
    data: {
      id: opts.id,
      terminalCode: `CODE-${opts.id.toUpperCase()}`,
      agentToken: `tok-${opts.id}-${randomBytes(6).toString('hex')}`,
      deviceFingerprint: `fp-${opts.id}`,
      orgId,
      userChargeMode: opts.userChargeMode,
    },
  })
  await prisma.terminalServicePrice.createMany({
    data: [
      { terminalId: opts.id, serviceKey: 'resume_optimize', unitCents: opts.resumeCents },
      { terminalId: opts.id, serviceKey: 'mock_interview', unitCents: opts.interviewCents },
    ],
  })
  const kioskSessionId = `ksess-${opts.id}-${randomBytes(6).toString('hex')}`
  await prisma.kioskSession.create({
    data: { terminalId: opts.id, clientSessionId: kioskSessionId, expiresAt: new Date(Date.now() + 3_600_000) },
  })
  return { terminalId: opts.id, kioskSessionId }
}

export async function assertVirtualPayRedeemFlow(ctx: RedeemVerifyContext): Promise<void> {
  const { prisma, audit, serviceOrders, registry, http } = ctx
  await prisma.platformSetting.upsert({
    where: { key: PERSONAL_CHARGE_SETTING_KEY },
    create: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'true' },
    update: { value: 'true' },
  })

  const member = await prisma.endUser.create({
    data: {
      phoneHash: `p2-redeem-hash-${randomBytes(6).toString('hex')}`,
      phoneEnc: 'enc-p2-redeem',
      wxOpenId: 'wx-openid-redeem-main',
      status: 'active',
      enabled: true,
    },
  })
  const memberToken = await ctx.issueMemberToken(member.id)

  const charging = await seedTerminalAndSession(prisma, {
    id: `term-chg-${randomBytes(4).toString('hex')}`,
    orgType: 'school',
    userChargeMode: 'user_pays',
    resumeCents: 100,
    interviewCents: 150,
  })
  const publicSite = await seedTerminalAndSession(prisma, {
    id: `term-pub-${randomBytes(4).toString('hex')}`,
    orgType: 'public_employment_service',
    userChargeMode: 'user_pays',
    resumeCents: 100,
    interviewCents: 150,
  })
  const zeroMachine = await seedTerminalAndSession(prisma, {
    id: `term-zero-${randomBytes(4).toString('hex')}`,
    orgType: 'school',
    userChargeMode: 'user_pays',
    resumeCents: 0,
    interviewCents: 0,
  })

  const chgTermHeaders = await ctx.issueTerminalHeaders(charging.terminalId)
  const pubTermHeaders = await ctx.issueTerminalHeaders(publicSite.terminalId)
  const zeroTermHeaders = await ctx.issueTerminalHeaders(zeroMachine.terminalId)
  const authHeaders = { ...chgTermHeaders, Authorization: `Bearer ${memberToken}` }

  const seeded = await seedPaidCredit(prisma, member.id, 'resume_optimize', 'r1')

  // 1. 未登录 401，不扣权益
  const unauthed = await http.post(
    '/api/v1/kiosk/service-orders/redeem-credit',
    { serviceKey: 'resume_optimize', kioskSessionId: charging.kioskSessionId },
    chgTermHeaders,
  )
  assert.equal(unauthed.status, 401)
  assert.equal((await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: seeded.creditId } })).status, 'available')

  // 2. scan 拒 400
  const scanRes = await http.post(
    '/api/v1/kiosk/service-orders/redeem-credit',
    { serviceKey: 'scan', kioskSessionId: charging.kioskSessionId },
    authHeaders,
  )
  assert.equal(scanRes.status, 400)

  // 3. 公共点位 / 0 元机 409 不扣权益
  const pubRes = await http.post(
    '/api/v1/kiosk/service-orders/redeem-credit',
    { serviceKey: 'resume_optimize', kioskSessionId: publicSite.kioskSessionId },
    { ...pubTermHeaders, Authorization: `Bearer ${memberToken}` },
  )
  assert.equal(pubRes.status, 409)
  assert.equal((pubRes.json.error as { code?: string })?.code, 'SERVICE_FREE_ON_THIS_TERMINAL')

  const zeroRes = await http.post(
    '/api/v1/kiosk/service-orders/redeem-credit',
    { serviceKey: 'resume_optimize', kioskSessionId: zeroMachine.kioskSessionId },
    { ...zeroTermHeaders, Authorization: `Bearer ${memberToken}` },
  )
  assert.equal(zeroRes.status, 409)
  assert.equal((zeroRes.json.error as { code?: string })?.code, 'SERVICE_FREE_ON_THIS_TERMINAL')
  assert.equal((await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: seeded.creditId } })).status, 'available')

  // 4. 无效会话与已过期会话（expiresAt 在 1 小时前、endedAt=null）均 400 不扣权益
  const badSess = await http.post(
    '/api/v1/kiosk/service-orders/redeem-credit',
    { serviceKey: 'resume_optimize', kioskSessionId: 'missing-session' },
    authHeaders,
  )
  assert.equal(badSess.status, 400)
  assert.equal((badSess.json.error as { code?: string })?.code, 'SERVICE_SESSION_REQUIRED')

  const expiredSessId = `ksess-expired-${randomBytes(4).toString('hex')}`
  await prisma.kioskSession.create({
    data: {
      terminalId: charging.terminalId,
      clientSessionId: expiredSessId,
      expiresAt: new Date(Date.now() - 3_600_000),
      endedAt: null,
    },
  })
  const expiredRes = await http.post(
    '/api/v1/kiosk/service-orders/redeem-credit',
    { serviceKey: 'resume_optimize', kioskSessionId: expiredSessId },
    authHeaders,
  )
  assert.equal(expiredRes.status, 400, '已过期 KioskSession（expiresAt < now）严禁核销权益')
  assert.equal((expiredRes.json.error as { code?: string })?.code, 'SERVICE_SESSION_REQUIRED')
  assert.equal((await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: seeded.creditId } })).status, 'available')

  // 5. 正常核销 → 产 provider='miniapp_credit', amountCents=0 的 ServiceOrder
  const redeemed = await http.post(
    '/api/v1/kiosk/service-orders/redeem-credit',
    { serviceKey: 'resume_optimize', kioskSessionId: charging.kioskSessionId },
    authHeaders,
  )
  assert.equal(redeemed.status, 200)
  const view = redeemed.json.data as Record<string, unknown>
  assert.equal(view.provider, MINIAPP_CREDIT_PROVIDER)
  assert.equal(view.amountCents, 0)
  assert.equal(view.status, 'paid')
  assert.equal(view.serviceKey, 'resume_optimize')
  const orderId1 = String(view.id)

  const creditAfterRedeem = await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: seeded.creditId } })
  assert.equal(creditAfterRedeem.status, 'consumed')
  assert.equal(creditAfterRedeem.consumedServiceOrderId, orderId1)
  assert.ok(creditAfterRedeem.consumedAt)
  assert.equal(await prisma.auditLog.count({ where: { action: VIRTUAL_PAY_CREDIT_REDEEMED_AUDIT_ACTION, targetId: orderId1 } }), 1)

  const creditsList = await http.get('/api/v1/member/service-credits', { Authorization: `Bearer ${memberToken}` })
  assert.equal(creditsList.status, 200)
  assert.equal((creditsList.json.items as unknown[]).length, 0)

  // 6. 走真实 beginTrip / coversTrip / 失败 2 次自动退回 available（绝不调微信 Native 退款）
  const tripHeaders: Record<string, string> = {
    'x-terminal-id': chgTermHeaders['x-terminal-id']!,
    'x-terminal-session-token': chgTermHeaders['x-terminal-session-token']!,
    'x-kiosk-session-id': charging.kioskSessionId,
    'x-service-order-id': orderId1,
  }
  const hold = await serviceOrders.beginTrip(tripHeaders, 'resume_optimize')
  assert.equal(hold.required, true)
  await hold.consume('resume-task-attempt-1')
  assert.equal(hold.skipDailyQuota, true)
  assert.equal(await serviceOrders.coversTrip(tripHeaders, 'resume_optimize'), orderId1)

  // 第 1 次失败：进入 10 分钟免费再试，权益仍 consumed
  await hold.noteNotMade('optimize_failed')
  assert.equal((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: orderId1 } })).status, 'paid')
  assert.equal((await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: seeded.creditId } })).status, 'consumed')

  // 第 2 次失败：重试耗尽 → 自动原子退回权益 available
  const hold2 = await serviceOrders.beginTrip(tripHeaders, 'resume_optimize')
  await hold2.consume('resume-task-attempt-2')
  await hold2.noteNotMade('optimize_failed')

  const orderAfterFail = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: orderId1 } })
  assert.equal(orderAfterFail.status, 'refunded')
  const creditAfterFail = await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: seeded.creditId } })
  assert.equal(creditAfterFail.status, 'available')
  assert.equal(creditAfterFail.consumedAt, null)
  assert.equal(creditAfterFail.consumedServiceOrderId, null)
  assert.equal(await prisma.auditLog.count({ where: { action: VIRTUAL_PAY_CREDIT_RESTORED_AUDIT_ACTION, targetId: orderId1 } }), 1)

  // 重复调 executeServiceOrderRefund 幂等
  const again = await executeServiceOrderRefund(prisma, registry, audit, null, orderId1, '重复触发')
  assert.equal(again, 'refunded')
  assert.equal(await prisma.auditLog.count({ where: { action: VIRTUAL_PAY_CREDIT_RESTORED_AUDIT_ACTION, targetId: orderId1 } }), 1)

  // 7. 同一张退回的权益可以再次核销，并通过 close() 退回
  const redeemed2 = await http.post(
    '/api/v1/kiosk/service-orders/redeem-credit',
    { serviceKey: 'resume_optimize', kioskSessionId: charging.kioskSessionId },
    authHeaders,
  )
  assert.equal(redeemed2.status, 200)
  const orderId2 = String((redeemed2.json.data as { id: string }).id)
  assert.notEqual(orderId2, orderId1)

  const closedView = await serviceOrders.close(charging.terminalId, orderId2, charging.kioskSessionId)
  assert.equal(closedView.status, 'refunded')
  assert.equal((await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: seeded.creditId } })).status, 'available')

  // 8. 第三次核销后离场清场（onSessionEnded）自动退回
  const redeemed3 = await http.post(
    '/api/v1/kiosk/service-orders/redeem-credit',
    { serviceKey: 'resume_optimize', kioskSessionId: charging.kioskSessionId },
    authHeaders,
  )
  assert.equal(redeemed3.status, 200)
  const orderId3 = String((redeemed3.json.data as { id: string }).id)
  await serviceOrders.onSessionEnded(charging.terminalId, charging.kioskSessionId)
  assert.equal((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: orderId3 } })).status, 'refunded')
  assert.equal((await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: seeded.creditId } })).status, 'available')

  // 9. 核销后机器中途改免费：beginTrip 发现机器已免费 → 自动原子退回权益 available
  const ksFreeAfter = `ksess-free-after-${randomBytes(4).toString('hex')}`
  await prisma.kioskSession.create({
    data: { terminalId: charging.terminalId, clientSessionId: ksFreeAfter, expiresAt: new Date(Date.now() + 3_600_000) },
  })
  const redeemed4 = await http.post(
    '/api/v1/kiosk/service-orders/redeem-credit',
    { serviceKey: 'resume_optimize', kioskSessionId: ksFreeAfter },
    authHeaders,
  )
  assert.equal(redeemed4.status, 200)
  const orderId4 = String((redeemed4.json.data as { id: string }).id)
  await prisma.terminal.update({ where: { id: charging.terminalId }, data: { userChargeMode: 'org_free' } })
  const holdFree = await serviceOrders.beginTrip(
    {
      'x-terminal-id': chgTermHeaders['x-terminal-id']!,
      'x-terminal-session-token': chgTermHeaders['x-terminal-session-token']!,
      'x-kiosk-session-id': ksFreeAfter,
      'x-service-order-id': orderId4,
    },
    'resume_optimize',
  )
  assert.equal(holdFree.required, false)
  assert.equal((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: orderId4 } })).status, 'refunded')
  assert.equal((await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: seeded.creditId } })).status, 'available')

  // 10. 已完成服务（settledAt !== null）严禁被 executeServiceOrderRefund 或迟到 markServiceOrderNotMade 退回权益
  await prisma.terminal.update({ where: { id: charging.terminalId }, data: { userChargeMode: 'user_pays' } })
  const ksSettled = `ksess-settled-${randomBytes(4).toString('hex')}`
  await prisma.kioskSession.create({
    data: { terminalId: charging.terminalId, clientSessionId: ksSettled, expiresAt: new Date(Date.now() + 3_600_000) },
  })
  const redeemed5 = await http.post(
    '/api/v1/kiosk/service-orders/redeem-credit',
    { serviceKey: 'resume_optimize', kioskSessionId: ksSettled },
    authHeaders,
  )
  assert.equal(redeemed5.status, 200)
  const orderId5 = String((redeemed5.json.data as { id: string }).id)
  const holdSettled = await serviceOrders.beginTrip(
    {
      'x-terminal-id': chgTermHeaders['x-terminal-id']!,
      'x-terminal-session-token': chgTermHeaders['x-terminal-session-token']!,
      'x-kiosk-session-id': ksSettled,
      'x-service-order-id': orderId5,
    },
    'resume_optimize',
  )
  await holdSettled.consume('resume-task-settled-ok')
  await finishServiceOrder(prisma, orderId5)
  const settledOrderBefore = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: orderId5 } })
  assert.ok(settledOrderBefore.settledAt)
  // 直接调 executeServiceOrderRefund → skipped，权益保持 consumed
  const refundSettled = await executeServiceOrderRefund(prisma, registry, audit, null, orderId5, 'late_direct_refund')
  assert.equal(refundSettled, 'skipped', '已完成单（settledAt !== null）绝不能被退回权益')
  // 经真实 markServiceOrderNotMade 注入迟到失败（即使把 attemptsUsed 推到 2）→ 绝不退回权益
  await prisma.serviceOrder.update({ where: { id: orderId5 }, data: { attemptsUsed: 2 } })
  await markServiceOrderNotMade({ prisma, registry, audit, redis: null }, orderId5, 'optimize_failed')
  const settledOrderAfter = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: orderId5 } })
  assert.equal(settledOrderAfter.status, 'consumed')
  assert.ok(settledOrderAfter.settledAt)
  assert.equal((await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: seeded.creditId } })).status, 'consumed')

  console.log('PASS P2 核销全链（鉴权/免费机409/过期会话400/原子核销/beginTrip/失败2次退回再核销/关单恢复/离场退回/改免费退回/已完成单禁退）')
}

/**
 * PostgreSQL 20 并发跨会话抢同一张权益：严格 1 次成功、19 次 409 VPAY_CREDIT_UNAVAILABLE。
 * 使用 20 个不同活跃 KioskSession 让 20 个事务真正并发竞争 MemberServiceCredit 行级 CAS。
 */
export async function assertConcurrentCreditRedeem20(ctx: RedeemVerifyContext): Promise<void> {
  const { prisma, http } = ctx
  await prisma.platformSetting.upsert({
    where: { key: PERSONAL_CHARGE_SETTING_KEY },
    create: { key: PERSONAL_CHARGE_SETTING_KEY, value: 'true' },
    update: { value: 'true' },
  })
  const member = await prisma.endUser.create({
    data: {
      phoneHash: `p2-pg-race-hash-${randomBytes(6).toString('hex')}`,
      phoneEnc: 'enc-pg-race',
      wxOpenId: `wx-openid-pg-race-${randomBytes(6).toString('hex')}`,
      status: 'active',
      enabled: true,
    },
  })
  const token = await ctx.issueMemberToken(member.id)
  const term = await seedTerminalAndSession(prisma, {
    id: `term-pg-${randomBytes(4).toString('hex')}`,
    orgType: 'school',
    userChargeMode: 'user_pays',
    resumeCents: 100,
    interviewCents: 100,
  })
  const sessionIds = [term.kioskSessionId]
  for (let i = 1; i < 20; i += 1) {
    const sid = `ksess-${term.terminalId}-${i}`
    await prisma.kioskSession.create({
      data: { terminalId: term.terminalId, clientSessionId: sid, expiresAt: new Date(Date.now() + 3_600_000) },
    })
    sessionIds.push(sid)
  }
  const termHeaders = await ctx.issueTerminalHeaders(term.terminalId)
  const headers = { ...termHeaders, Authorization: `Bearer ${token}` }
  const seeded = await seedPaidCredit(prisma, member.id, 'mock_interview', 'pg20')

  const results = await Promise.all(
    sessionIds.map((kioskSessionId) =>
      http.post(
        '/api/v1/kiosk/service-orders/redeem-credit',
        { serviceKey: 'mock_interview', kioskSessionId },
        headers,
      ),
    ),
  )
  const succeeded = results.filter((r) => r.status === 200)
  const rejected = results.filter(
    (r) => r.status === 409 && (r.json.error as { code?: string })?.code === 'VPAY_CREDIT_UNAVAILABLE',
  )
  assert.equal(succeeded.length, 1, `20 并发抢同一权益只能成功 1 次，实际 ${succeeded.length}`)
  assert.equal(rejected.length, 19, `其余 19 次必须返回 409 VPAY_CREDIT_UNAVAILABLE，实际 ${rejected.length}`)

  const winningOrderId = String((succeeded[0]!.json.data as { id: string }).id)
  const credit = await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: seeded.creditId } })
  assert.equal(credit.status, 'consumed')
  assert.equal(credit.consumedServiceOrderId, winningOrderId)
  const createdOrders = await prisma.serviceOrder.count({
    where: { terminalId: term.terminalId, provider: MINIAPP_CREDIT_PROVIDER, endUserId: member.id },
  })
  assert.equal(createdOrders, 1)
  console.log('PASS PostgreSQL 20 并发跨会话抢核销同一张权益：严格 1 成功 19 拒')
}

/**
 * PostgreSQL 同会话双权益并发核销：同一会员 2 张可用权益、同一终端会话并发 5 次核销，
 * 借 KioskSession 行锁 + 同会话待用单拦截，严格只扣 1 张权益，第 2 张保持 available。
 */
export async function assertSameSessionDoubleCreditRedeem(ctx: RedeemVerifyContext): Promise<void> {
  const { prisma, http } = ctx
  const member = await prisma.endUser.create({
    data: {
      phoneHash: `p2-pg-dbl-hash-${randomBytes(6).toString('hex')}`,
      phoneEnc: 'enc-pg-dbl',
      wxOpenId: `wx-openid-pg-dbl-${randomBytes(6).toString('hex')}`,
      status: 'active',
      enabled: true,
    },
  })
  const token = await ctx.issueMemberToken(member.id)
  const term = await seedTerminalAndSession(prisma, {
    id: `term-pg-dbl-${randomBytes(4).toString('hex')}`,
    orgType: 'school',
    userChargeMode: 'user_pays',
    resumeCents: 100,
    interviewCents: 100,
  })
  const termHeaders = await ctx.issueTerminalHeaders(term.terminalId)
  const headers = { ...termHeaders, Authorization: `Bearer ${token}` }
  const c1 = await seedPaidCredit(prisma, member.id, 'resume_optimize', 'dbl1')
  const c2 = await seedPaidCredit(prisma, member.id, 'resume_optimize', 'dbl2')

  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      http.post(
        '/api/v1/kiosk/service-orders/redeem-credit',
        { serviceKey: 'resume_optimize', kioskSessionId: term.kioskSessionId },
        headers,
      ),
    ),
  )
  const okRows = results.filter((r) => r.status === 200)
  const conflictRows = results.filter(
    (r) => r.status === 409 && (r.json.error as { code?: string })?.code === 'SERVICE_ORDER_IN_USE',
  )
  assert.equal(okRows.length, 1, `同会话并发只能核销 1 张权益，实际成功 ${okRows.length}`)
  assert.equal(conflictRows.length, 4, `其余并发必须返回 409 SERVICE_ORDER_IN_USE，实际 ${conflictRows.length}`)

  const credits = await prisma.memberServiceCredit.findMany({ where: { id: { in: [c1.creditId, c2.creditId] } } })
  assert.equal(credits.filter((c) => c.status === 'consumed').length, 1, '只能扣 1 张权益')
  assert.equal(credits.filter((c) => c.status === 'available').length, 1, '第 2 张权益必须仍为 available')
  const orderCount = await prisma.serviceOrder.count({
    where: { terminalId: term.terminalId, kioskSessionId: term.kioskSessionId, provider: MINIAPP_CREDIT_PROVIDER },
  })
  assert.equal(orderCount, 1)
  console.log('PASS PostgreSQL 同会话双权益 5 并发核销：严格只扣 1 张、第 2 张保留 available')
}

/**
 * PostgreSQL 完成服务（finishServiceOrder）与退回权益（restoreMiniappCreditForServiceOrder）并发互斥。
 */
export async function assertFinishVsRestoreRace(deps: {
  prisma: PrismaService
  audit: AuditService
}): Promise<void> {
  const { prisma, audit } = deps
  const term = await seedTerminalAndSession(prisma, {
    id: `term-pg-fin-${randomBytes(4).toString('hex')}`,
    orgType: 'school',
    userChargeMode: 'user_pays',
    resumeCents: 100,
    interviewCents: 100,
  })
  for (let round = 0; round < 10; round += 1) {
    const member = await prisma.endUser.create({
      data: {
        phoneHash: `p2-pg-fin-${round}-${randomBytes(4).toString('hex')}`,
        phoneEnc: 'enc-fin',
        wxOpenId: `wx-fin-${round}-${randomBytes(4).toString('hex')}`,
        status: 'active',
        enabled: true,
      },
    })
    const seeded = await seedPaidCredit(prisma, member.id, 'resume_optimize', `fin${round}`)
    const order = await prisma.serviceOrder.create({
      data: {
        id: `vpcord_fin_${randomBytes(8).toString('hex')}`,
        terminalId: term.terminalId,
        kioskSessionId: term.kioskSessionId,
        endUserId: member.id,
        serviceKey: 'resume_optimize',
        provider: MINIAPP_CREDIT_PROVIDER,
        providerOrderNo: `vpcfin${randomBytes(8).toString('hex')}`,
        amountCents: 0,
        status: 'consumed',
        paidAt: new Date(),
        consumedAt: new Date(),
        consumedRef: `ref-fin-${round}`,
        attemptsUsed: 2,
        expiresAt: new Date(Date.now() + 300_000),
      },
    })
    await prisma.memberServiceCredit.update({
      where: { id: seeded.creditId },
      data: { status: 'consumed', consumedAt: new Date(), consumedServiceOrderId: order.id },
    })

    await Promise.all([
      finishServiceOrder(prisma, order.id),
      restoreMiniappCreditForServiceOrder(prisma, audit, order, 'race_late_fail'),
    ])

    const finalOrder = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: order.id } })
    const finalCredit = await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: seeded.creditId } })
    const finished = finalOrder.status === 'consumed' && finalOrder.settledAt !== null && finalCredit.status === 'consumed'
    const restored = finalOrder.status === 'refunded' && finalOrder.settledAt === null && finalCredit.status === 'available'
    assert.equal(
      finished !== restored,
      true,
      `第 ${round + 1} 轮完成与退回必须严格互斥，实际 order=(${finalOrder.status}, settled=${Boolean(finalOrder.settledAt)}) credit=${finalCredit.status}`,
    )
  }
  console.log('PASS PostgreSQL 10 轮 finishServiceOrder vs 退回权益并发：严格互斥')
}
