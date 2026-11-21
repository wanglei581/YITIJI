/**
 * 事务外写渠道答复（第 7 条，agy 三.2）。
 * 渠道答复是事实，在处置事务之外先记下是对的；之后处置事务被拒或回滚，重试时重新读库，写入幂等。
 * 但只把退款行记成失败、订单留在「退款中」，订单状态就是旧的，会出错（这里能复现）：
 * - 先退成 30、剩余 70 再退时渠道说失败：订单还停在退款中，关单就绕过了「只退了一部分不能关单」，
 *   把部分退款的单关掉了。应当：剩余这笔记失败，订单回到部分退款，关单照实拒绝。
 * - 渠道说失败之后处置被拒（中间纸已经核验出去了）：订单不能卡在退款中，要回到已付；重试同样拒绝、不重复记答复。
 */
import assert from 'node:assert/strict'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { AuditService } from '../../src/audit/audit.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider } from '../../src/payment/payment-provider.types'
import { resolveChannelBeforeHold } from '../../src/payment/refund-channel-hold-gate'
import { RefundService } from '../../src/payment/refund.service'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
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

export async function runP2b9AnswerOutsideCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9ao_${tag}`
  const terminalId = `term_p2b9ao_${tag}`
  const adminId = `user_p2b9ao_${tag}`
  await db.organization.create({ data: { id: orgId, name: '事务外写渠道答复', type: 'school_employment_center' } })
  await db.terminal.create({
    data: { id: terminalId, terminalCode: terminalId, agentToken: `tok-${terminalId}`, deviceFingerprint: `fp-${terminalId}`, orgId, enabled: true, lifecycleStatus: 'active' },
  })
  await db.user.create({
    data: { id: adminId, username: `p2b9ao_${tag}`, name: '核验出纸', passwordHash: 'hash', role: 'admin', enabled: true, tokenVersion: 0 },
  })
  const created: string[] = []
  const seed = async (label: string, opts: { amountCents: number; errorCode: string; printOutcome: string | null }) => {
    const id = `ord_${tag}_p2b9ao_${label}`
    const taskId = `pt_${id}`
    const orderNo = `P9AO${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: { id: taskId, fileUrl: 'https://example.invalid/print', fileMd5: 'md5', status: 'failed', errorCode: opts.errorCode, printOutcome: opts.printOutcome, orderId: id, terminalId },
    })
    await db.order.create({
      data: {
        id, orderNo, type: 'print', terminalId, amountCents: opts.amountCents, discountCents: 0, payStatus: 'paid', paymentSource: 'wechat',
        paidAt: new Date(Date.now() - 60 * 60 * 1000), pickupStatus: 'pending', taskStatus: 'failed', billablePages: 2,
        printParamsJson: PAGES, itemsJson: '[]', channel: 'kiosk', printTaskId: taskId,
      },
    })
    await db.paymentAttempt.create({
      data: { id: `pa_${id}`, orderId: id, channel: 'wechat', amountCents: opts.amountCents, status: 'success', channelTxnNo: `wxtxn_${tag}_${label}`.slice(0, 64), prepayId: `prepay_${id}`.slice(0, 64) },
    })
    return { id, taskId, orderNo }
  }
  const processing = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([
    { channel: 'wechat', refund: async () => ({ status: 'processing', channelRefundNo: null }) } as unknown as PaymentProvider,
  ]))

  try {
    // 1. 先退成 30，剩余 70 再退、渠道说失败，然后点关单。
    const part = await seed('part', { amountCents: 100, errorCode: 'PAPER_JAM', printOutcome: 'not_printed' })
    await db.refund.create({
      data: { orderId: part.id, refundNo: `RFD-${part.orderNo}`, amountCents: 30, status: 'success', reason: '先退一部分', channel: 'wechat', channelSubmittedAt: new Date(Date.now() - 50 * 60 * 1000) },
    })
    await db.order.update({ where: { id: part.id }, data: { payStatus: 'partial_refunded', refundedAmountCents: 30 } })
    const rest = await processing.refund(part.id, { reason: '退还剩余' })
    assert.equal(rest.refund.amountCents, 70)
    assert.equal(rest.refund.status, 'pending')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: part.id } })).payStatus, 'refunding')
    const closeCode = await resolvePrintReturnHold(db, part.id, 'close_order', 'admin-test', async () => 'failed')
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(closeCode, 'PARTIAL_REFUND_CANNOT_CLOSE', '只退了一部分，剩余那笔失败后也不能关单')
    const partOrder = await db.order.findUniqueOrThrow({ where: { id: part.id } })
    assert.equal(partOrder.payStatus, 'partial_refunded', '剩余那笔失败后订单回到部分退款，不能停在退款中')
    assert.equal(partOrder.refundedAmountCents, 30)
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: rest.refund.refundNo } })).status, 'failed', '渠道答复是事实，处置被拒也留着')
    const answersAfterFirst = await db.auditLog.count({ where: { targetId: part.id, action: 'refund.channel_answer' } })
    assert.equal(answersAfterFirst, 1)
    const retryCode = await resolvePrintReturnHold(db, part.id, 'close_order', 'admin-test', async () => 'failed')
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(retryCode, 'PARTIAL_REFUND_CANNOT_CLOSE', '重试重新读库，照样拒绝')
    assert.equal(await db.auditLog.count({ where: { targetId: part.id, action: 'refund.channel_answer' } }), answersAfterFirst, '已经记过的答复不再记')

    // 2. 渠道说失败（答复先记下），处置还没做，纸先被核验出去了：处置被拒，订单回到已付，不卡在退款中。
    const raced = await seed('raced', { amountCents: 200, errorCode: 'PRINT_JOB_UNCONFIRMED', printOutcome: null })
    const opened = await processing.refund(raced.id, { reason: '没出纸先退' })
    assert.equal(opened.refund.status, 'pending')
    const step = await resolveChannelBeforeHold(db, raced.id, 'release_paper', 'admin-test', async () => 'failed')
    assert.equal(step, 'release_paper')
    const racedOrder = await db.order.findUniqueOrThrow({ where: { id: raced.id } })
    assert.equal(racedOrder.payStatus, 'paid', '渠道说没退出去，订单回到已付')
    const verify = await new AdminPrintJobsVerifyOutcomeService(db, new AuditService(db))
      .verifyOutcome(raced.taskId, { outcome: 'printed', confirm: 'VERIFY_PRINTED' }, adminId)
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(verify, 'ok', '退款已经落定成失败，核验出纸可以做')
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const code = await resolvePrintReturnHold(db, raced.id, 'release_paper', 'admin-test', async () => 'failed')
        .then(() => 'ok', (error: unknown) => errorCode(error))
      assert.equal(code, 'PAPER_ALREADY_RELEASED', `第 ${attempt + 1} 次：纸已经出去，改为出纸照实拒绝`)
    }
    const final = await db.order.findUniqueOrThrow({ where: { id: raced.id } })
    assert.equal(final.payStatus, 'paid')
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: opened.refund.refundNo } })).status, 'failed')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: raced.taskId } })).printOutcome, 'printed')
    assert.equal(await db.auditLog.count({ where: { targetId: raced.id, action: 'refund.channel_answer' } }), 1)
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
