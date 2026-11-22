/**
 * 跨乘客集成验证（P2e-3c × P2d2c）：
 * 用「手机上买过」小程序虚拟支付权益（provider='miniapp_credit'）开的模拟面试：
 *   1. 开场（settledAt 非空）后报告失败 1 次 → 进 reportState='retry'，权益仍为 consumed；
 *      再次失败 → 原子退回权益 available（consumedAt/consumedServiceOrderId 清空），审计只写 1 次；
 *   2. 报告做成（reportState='done'）后，无论直接退还是报告失败都绝不退回权益；
 *   3. 10 轮真实并发竞态：报告落库判胜（reportState='done'）vs 退回权益（requireConsumedReportState='retry'）严格互斥；
 *   4. 免费再试窗口过期或会话离场 → 自动退回权益 available。
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import type { AuditService } from '../../src/audit/audit.service'
import type { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { executeServiceOrderRefund } from '../../src/payment/service-order.payment'
import {
  SERVICE_REFUND_REASON_REPORT_FAILED,
  SERVICE_RETRY_WINDOW_MS,
} from '../../src/payment/service-order.policy'
import {
  assertInterviewReportAdmitted,
  finishServiceOrder,
  markInterviewReportMade,
  markInterviewReportNotMade,
} from '../../src/payment/service-order.settle'
import type { ServiceOrderService } from '../../src/payment/service-order.service'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { VIRTUAL_PAY_CREDIT_RESTORED_AUDIT_ACTION } from '../../src/virtual-pay/virtual-pay-credit-redeem'
import { MINIAPP_CREDIT_PROVIDER } from '../../src/virtual-pay/virtual-pay.contract'

export interface CreditInterviewBridgeDeps {
  prisma: PrismaService
  audit: AuditService
  registry: PaymentProviderRegistry
  serviceOrders: ServiceOrderService
  rounds?: number
}

async function seedConsumedInterviewCreditOrder(
  prisma: PrismaService,
  tag: string,
): Promise<{
  terminalId: string
  kioskSessionId: string
  sessionId: string
  orderId: string
  creditId: string
}> {
  const uid = `${tag}_${randomBytes(4).toString('hex')}`
  const member = await prisma.endUser.create({
    data: {
      phoneHash: `vpay-iv-hash-${uid}`,
      phoneEnc: 'enc-vpay-iv',
      wxOpenId: `wx-iv-${uid}`,
      status: 'active',
      enabled: true,
    },
  })
  const org = await prisma.organization.create({
    data: { id: `org-iv-${uid}`, name: `机构-${uid}`, type: 'school' },
  })
  const terminal = await prisma.terminal.create({
    data: {
      id: `term-iv-${uid}`,
      terminalCode: `IV-${uid.toUpperCase()}`,
      agentToken: `tok-iv-${uid}`,
      deviceFingerprint: `fp-iv-${uid}`,
      orgId: org.id,
      userChargeMode: 'user_pays',
    },
  })
  const kioskSessionId = `ksess-iv-${uid}`
  await prisma.kioskSession.create({
    data: {
      terminalId: terminal.id,
      clientSessionId: kioskSessionId,
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  })
  const interview = await prisma.mockInterviewSession.create({
    data: {
      endUserId: member.id,
      interviewerType: 'hr',
      industry: '互联网',
      position: '前端开发',
      experience: 'y1_3',
      difficulty: 'standard',
      status: 'in_progress',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  })
  const vpayOrder = await prisma.virtualPayOrder.create({
    data: {
      endUserId: member.id,
      openId: member.wxOpenId,
      serviceKind: 'mock_interview',
      productId: 'FAKE_IV_ITEM',
      priceCents: 100,
      env: 1,
      status: 'paid',
      outTradeNo: `vpiv${randomBytes(12).toString('hex')}`,
      wxOrderId: `wxiv_${uid}`,
      paidAt: new Date(),
    },
  })
  const order = await prisma.serviceOrder.create({
    data: {
      id: `svciv_${uid}`,
      terminalId: terminal.id,
      kioskSessionId,
      endUserId: member.id,
      serviceKey: 'mock_interview',
      provider: MINIAPP_CREDIT_PROVIDER,
      providerOrderNo: `vpciv${randomBytes(8).toString('hex')}`,
      amountCents: 0,
      status: 'consumed',
      paidAt: new Date(),
      consumedAt: new Date(),
      consumedRef: interview.id,
      attemptsUsed: 1,
      expiresAt: new Date(Date.now() + 300_000),
    },
  })
  const credit = await prisma.memberServiceCredit.create({
    data: {
      endUserId: member.id,
      serviceKind: 'mock_interview',
      sourceOrderId: vpayOrder.id,
      status: 'consumed',
      consumedAt: new Date(),
      consumedServiceOrderId: order.id,
    },
  })
  await finishServiceOrder(prisma, order.id)
  return {
    terminalId: terminal.id,
    kioskSessionId,
    sessionId: interview.id,
    orderId: order.id,
    creditId: credit.id,
  }
}

export async function assertMiniappCreditInterviewReportBridge(
  deps: CreditInterviewBridgeDeps,
): Promise<void> {
  const { prisma, audit, registry, serviceOrders } = deps
  const settleDeps = { prisma, registry, audit, redis: null }

  // 1. 失败 1 次进 retry（权益仍 consumed），失败 2 次自动退回 available 且重复幂等
  const fail2 = await seedConsumedInterviewCreditOrder(prisma, 'f2')
  await markInterviewReportNotMade(settleDeps, fail2.sessionId)
  const afterFirst = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: fail2.orderId } })
  const creditAfterFirst = await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: fail2.creditId } })
  assert.equal(afterFirst.status, 'consumed')
  assert.equal(afterFirst.reportState, 'retry')
  assert.ok(afterFirst.settledAt !== null, '开场后 settledAt 必须非空')
  assert.equal(creditAfterFirst.status, 'consumed')

  await markInterviewReportNotMade(settleDeps, fail2.sessionId)
  const afterSecond = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: fail2.orderId } })
  const creditAfterSecond = await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: fail2.creditId } })
  assert.equal(afterSecond.status, 'refunded')
  assert.equal(afterSecond.retryUntil, null)
  assert.equal(creditAfterSecond.status, 'available')
  assert.equal(creditAfterSecond.consumedAt, null)
  assert.equal(creditAfterSecond.consumedServiceOrderId, null)

  // 重复失败幂等，审计只写 1 次
  await markInterviewReportNotMade(settleDeps, fail2.sessionId)
  const auditCount = await prisma.auditLog.count({
    where: { targetId: fail2.orderId, action: VIRTUAL_PAY_CREDIT_RESTORED_AUDIT_ACTION },
  })
  assert.equal(auditCount, 1, '二次报告失败退回权益审计必须仅写 1 次')
  console.log('PASS P2e-3c×P2d2c: miniapp_credit 模拟面试报告失败 2 次自动退回 available 且幂等')

  // 2. 报告做成（reportState='done'）后严禁退回权益
  const doneCase = await seedConsumedInterviewCreditOrder(prisma, 'done')
  await markInterviewReportMade(prisma, doneCase.sessionId)
  await markInterviewReportNotMade(settleDeps, doneCase.sessionId)
  const r1 = await executeServiceOrderRefund(prisma, registry, audit, null, doneCase.orderId, SERVICE_REFUND_REASON_REPORT_FAILED, { requireConsumedReportState: 'retry' })
  const r2 = await executeServiceOrderRefund(prisma, registry, audit, null, doneCase.orderId, SERVICE_REFUND_REASON_REPORT_FAILED, { requireConsumedReportState: null })
  const r3 = await executeServiceOrderRefund(prisma, registry, audit, null, doneCase.orderId, SERVICE_REFUND_REASON_REPORT_FAILED)
  assert.equal(r1, 'skipped')
  assert.equal(r2, 'skipped')
  assert.equal(r3, 'skipped')
  const doneOrder = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: doneCase.orderId } })
  const doneCredit = await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: doneCase.creditId } })
  assert.equal(doneOrder.status, 'consumed')
  assert.equal(doneOrder.reportState, 'done')
  assert.equal(doneCredit.status, 'consumed')
  console.log('PASS P2e-3c×P2d2c: reportState=done 后任何退回路径均跳过，权益保持 consumed')

  // 3. 并发互斥：commitPaidReportAtomic 同款条件写 done vs 退回权益（requireConsumedReportState='retry'）
  const rounds = deps.rounds ?? 10
  for (let i = 0; i < rounds; i += 1) {
    const race = await seedConsumedInterviewCreditOrder(prisma, `rc${i}`)
    await prisma.serviceOrder.update({
      where: { id: race.orderId },
      data: { reportState: 'retry', retryUntil: new Date(Date.now() + SERVICE_RETRY_WINDOW_MS) },
    })
    const now = new Date()
    await Promise.all([
      prisma.serviceOrder.updateMany({
        where: {
          id: race.orderId,
          status: 'consumed',
          OR: [{ reportState: null }, { reportState: 'retry', retryUntil: { gt: now } }],
        },
        data: { reportState: 'done', failureReason: null, retryUntil: null, settledAt: now },
      }),
      executeServiceOrderRefund(
        prisma, registry, audit, null, race.orderId, SERVICE_REFUND_REASON_REPORT_FAILED,
        { requireConsumedReportState: 'retry' },
      ),
    ])
    const fOrder = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: race.orderId } })
    const fCredit = await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: race.creditId } })
    const doneWon = fOrder.status === 'consumed' && fOrder.reportState === 'done' && fCredit.status === 'consumed'
    const restoreWon = fOrder.status === 'refunded' && fCredit.status === 'available'
    assert.equal(
      doneWon !== restoreWon,
      true,
      `第 ${i + 1} 轮 done 与退回权益必须严格互斥，实际 order=(${fOrder.status},${fOrder.reportState}) credit=${fCredit.status}`,
    )
  }
  console.log(`PASS P2e-3c×P2d2c: ${rounds} 轮 reportState=done vs 退回权益并发严格互斥`)

  // 4. 免费再试窗口过期准入 & 会话结束离场，均自动退回权益 available
  const expiredCase = await seedConsumedInterviewCreditOrder(prisma, 'exp')
  await prisma.serviceOrder.update({
    where: { id: expiredCase.orderId },
    data: { reportState: 'retry', retryUntil: new Date(Date.now() - 1_000) },
  })
  await assert.rejects(() => assertInterviewReportAdmitted(settleDeps, expiredCase.sessionId))
  const expCredit = await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: expiredCase.creditId } })
  assert.equal(expCredit.status, 'available')

  const leftCase = await seedConsumedInterviewCreditOrder(prisma, 'left')
  await markInterviewReportNotMade(settleDeps, leftCase.sessionId)
  await serviceOrders.onSessionEnded(leftCase.terminalId, leftCase.kioskSessionId)
  const leftCredit = await prisma.memberServiceCredit.findUniqueOrThrow({ where: { id: leftCase.creditId } })
  assert.equal(leftCredit.status, 'available')
  console.log('PASS P2e-3c×P2d2c: 再试窗口过期准入与会话离场均自动退回权益 available')
}
