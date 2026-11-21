/**
 * 核验出纸不按原因放行（第 4 条）。
 * 渠道受理过、还没落定的退款，原因是过期付款也一样挡住核验，printOutcome 不变。
 * - 过期付款、已提交渠道、处理中：核验已出纸、未出纸都拒绝（agy 二.1.3）。
 * - 过期付款经真实写入路径发到渠道、又因金额不符搁置成待人工（Grok 实测那一单）：核验拒绝，三步也不放行。
 * - 过期付款那一笔已经退成（落定）：不挡这一单的核验。
 */
import assert from 'node:assert/strict'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { AuditService } from '../../src/audit/audit.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider } from '../../src/payment/payment-provider.types'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { holdMismatchedChannelRefund } from '../../src/payment/refund-amount-hold'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import { refundExpiredAttemptCollection } from '../../src/payment/stale-attempt-collection'
import { AdminPrintJobsVerifyOutcomeService } from '../../src/print-jobs/admin-print-jobs-verify-outcome.service'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function errorCode(error: unknown): string {
  if (error instanceof BadRequestException || error instanceof ConflictException) {
    const body = error.getResponse() as { error?: { code?: string } } | string
    if (typeof body === 'string') return body
    return body?.error?.code ?? error.message
  }
  return error instanceof Error ? error.message : 'error'
}

export async function runP2b9VerifyReasonCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9vr_${tag}`
  const terminalId = `term_p2b9vr_${tag}`
  const adminId = `user_p2b9vr_${tag}`
  await db.organization.create({ data: { id: orgId, name: '核验不按原因放行', type: 'school_employment_center' } })
  await db.terminal.create({
    data: {
      id: terminalId,
      terminalCode: terminalId,
      agentToken: `tok-${terminalId}`,
      deviceFingerprint: `fp-${terminalId}`,
      orgId,
      enabled: true,
      lifecycleStatus: 'active',
    },
  })
  await db.user.create({
    data: { id: adminId, username: `p2b9vr_${tag}`, name: '核验出纸', passwordHash: 'hash', role: 'admin', enabled: true, tokenVersion: 0 },
  })
  const verifySvc = new AdminPrintJobsVerifyOutcomeService(db, new AuditService(db))
  const verify = (taskId: string, outcome: 'printed' | 'not_printed') => verifySvc.verifyOutcome(
    taskId,
    { outcome, confirm: outcome === 'printed' ? 'VERIFY_PRINTED' : 'VERIFY_NOT_PRINTED' },
    adminId,
  ).then(() => 'ok', (error: unknown) => errorCode(error))
  const created: string[] = []
  const seed = async (label: string): Promise<{ id: string; orderNo: string; taskId: string }> => {
    const id = `ord_${tag}_p2b9vr_${label}`
    const taskId = `pt_${id}`
    const orderNo = `P9VR${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        errorCode: 'PRINT_JOB_UNCONFIRMED',
        printOutcome: null,
        orderId: id,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id,
        orderNo,
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'wechat',
        paidAt: new Date(Date.now() - 30 * 60 * 1000),
        pickupStatus: 'pending',
        taskStatus: 'failed',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: taskId,
      },
    })
    return { id, orderNo, taskId }
  }
  const staleRefund = (orderId: string, label: string, status: string, submitted: boolean) => db.refund.create({
    data: {
      orderId,
      refundNo: `RFD-STALE-P9VR-${tag}-${label}`.slice(0, 48),
      amountCents: 300,
      status,
      reason: STALE_ATTEMPT_REFUND_REASON,
      channel: 'wechat',
      channelRefundNo: submitted ? `WX-ST-${tag}-${label}`.slice(0, 32) : null,
      ...(submitted ? { channelSubmittedAt: new Date(Date.now() - 10 * 60 * 1000) } : {}),
    },
  })

  try {
    // 1. 过期付款、已提交渠道、处理中：核验已出纸、未出纸都拒绝，结论不写。
    for (const outcome of ['printed', 'not_printed'] as const) {
      const order = await seed(`pend${outcome.slice(0, 3)}`)
      await staleRefund(order.id, `pend${outcome.slice(0, 3)}`, 'pending', true)
      assert.equal(await verify(order.taskId, outcome), 'PRINT_OUTCOME_REFUND_BLOCKED', `${outcome}：过期付款在途也要挡住核验`)
      assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: order.taskId } })).printOutcome, null)
      assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: order.id } })).status, 'pending')
    }

    // 2. Grok 实测那一单：过期付款经真实写入路径发到渠道，金额不符搁置成待人工、渠道退款号为空。
    const grok = await seed('grok')
    const attemptId = `pa_old_${grok.id}`
    await db.paymentAttempt.create({
      data: { id: attemptId, orderId: grok.id, channel: 'wechat', amountCents: 300, status: 'expired', prepayId: `prepay_${attemptId}`.slice(0, 64) },
    })
    const provider = {
      channel: 'wechat',
      refund: async () => ({ status: 'processing' as const, channelRefundNo: null }),
    } as unknown as PaymentProvider
    await refundExpiredAttemptCollection(db, new PaymentProviderRegistry([provider]), {
      orderId: grok.id,
      orderNo: grok.orderNo,
      payStatus: 'paid',
      attemptId,
      attemptStatus: 'expired',
      attemptAmountCents: 300,
      orderAmountCents: 200,
      channel: 'wechat',
      channelTxnNo: `wxtxn_old_${tag}`,
      result: 'success',
    })
    const sent = await db.refund.findFirstOrThrow({ where: { orderId: grok.id } })
    assert.ok(sent.channelSubmittedAt)
    const order = await db.order.findUniqueOrThrow({ where: { id: grok.id } })
    assert.equal(await holdMismatchedChannelRefund(db, {
      refundId: sent.id,
      refundNo: sent.refundNo,
      order,
      recordedAmountCents: 300,
      notifyAmountCents: 120,
      channelRefundNo: null,
    }), 'held')
    const parked = await db.refund.findFirstOrThrow({ where: { orderId: grok.id } })
    assert.equal(parked.status, 'manual_review')
    assert.equal(parked.reason, STALE_ATTEMPT_REFUND_REASON)
    assert.equal(parked.channelRefundNo, null)
    assert.equal(await verify(grok.taskId, 'printed'), 'PRINT_OUTCOME_REFUND_BLOCKED', '过期原因不能让渠道受理过的待人工核验成已出纸')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: grok.taskId } })).printOutcome, null)
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: grok.id } })).status, 'manual_review')
    const releaseCode = await resolvePrintReturnHold(db, grok.id, 'release_paper', 'admin-test')
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(releaseCode, 'REFUND_CHANNEL_UNCONFIRMED', '同一单改为出纸也不能当本地单撤回')
    assert.equal((await db.refund.findFirstOrThrow({ where: { orderId: grok.id } })).status, 'manual_review')

    // 3. 过期付款那一笔已经退成：落定了，不挡这一单的核验。
    const settled = await seed('settled')
    await staleRefund(settled.id, 'settled', 'success', true)
    assert.equal(await verify(settled.taskId, 'printed'), 'ok', '过期付款已经退成，不挡这一单')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: settled.taskId } })).printOutcome, 'printed')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.paymentAttempt.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { OR: [{ targetId: { in: created } }, { targetId: { in: input.taskIds } }] } })
    await db.printTaskStatusLog.deleteMany({ where: { taskId: { in: input.taskIds } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.user.deleteMany({ where: { id: adminId } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
