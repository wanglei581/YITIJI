/**
 * 本地新建的待人工永远不写「已提交渠道时间」，三步照常、核验已出纸在同一事务撤回（第 1 条复核补充）。
 * - 窗口关闭停放（真实 parkClosedWindowUnprinted 写出）：确认退成、改为出纸、关单都不查渠道，照常做。
 * - 窗口关闭停放后核验已出纸：放行，同一事务把待人工撤回成「核验已出纸」。
 * - 过期付款没有渠道流水（真实 refundExpiredAttemptCollection 写出待人工）：不写列，核验已出纸同样撤回。
 * - 过期付款有渠道流水：调渠道前列已经提交；发到渠道还没答复，三步不放行。
 */
import assert from 'node:assert/strict'
import { BadRequestException, ConflictException } from '@nestjs/common'
import { AuditService } from '../../src/audit/audit.service'
import { parkClosedWindowUnprinted } from '../../src/payment/closed-window-unprinted'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider, RefundExecuteInput } from '../../src/payment/payment-provider.types'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { resolvePrintReturnHold, type PrintReturnResolution } from '../../src/payment/resolve-print-return-hold'
import { refundExpiredAttemptCollection } from '../../src/payment/stale-attempt-collection'
import { AdminPrintJobsVerifyOutcomeService } from '../../src/print-jobs/admin-print-jobs-verify-outcome.service'
import { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const WITHDRAW_REASON = '核验已出纸'

function errorCode(error: unknown): string {
  if (error instanceof BadRequestException || error instanceof ConflictException) {
    const body = error.getResponse() as { error?: { code?: string } } | string
    if (typeof body === 'string') return body
    return body?.error?.code ?? error.message
  }
  return error instanceof Error ? error.message : 'error'
}

export async function runP2b9LocalWriteCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9lw_${tag}`
  const terminalId = `term_p2b9lw_${tag}`
  const adminId = `user_p2b9lw_${tag}`
  await db.organization.create({ data: { id: orgId, name: '本地待人工不写渠道时间', type: 'school_employment_center' } })
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
    data: { id: adminId, username: `p2b9lw_${tag}`, name: '核验出纸', passwordHash: 'hash', role: 'admin', enabled: true, tokenVersion: 0 },
  })
  const observer = new PrismaService()
  await observer.onModuleInit()
  const verifySvc = new AdminPrintJobsVerifyOutcomeService(db, new AuditService(db))
  const verifyPrinted = (taskId: string) => verifySvc.verifyOutcome(taskId, { outcome: 'printed', confirm: 'VERIFY_PRINTED' }, adminId)
    .then(() => 'ok', (error: unknown) => errorCode(error))
  const created: string[] = []

  const seed = async (label: string, opts?: { unconfirmed?: boolean }): Promise<{ id: string; orderNo: string; taskId: string }> => {
    const id = `ord_${tag}_p2b9lw_${label}`
    const taskId = `pt_${id}`
    const orderNo = `P9LW${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        printOutcome: opts?.unconfirmed ? null : 'not_printed',
        errorCode: opts?.unconfirmed ? 'PRINT_JOB_UNCONFIRMED' : 'PAPER_JAM',
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
        paidAt: new Date(Date.now() - 50 * 60 * 1000),
        pickupStatus: 'expired',
        pickupCodeExpiresAt: new Date(Date.now() - 5 * 60 * 1000),
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
  const refundOf = (orderId: string) => db.refund.findFirstOrThrow({ where: { orderId }, orderBy: { createdAt: 'desc' } })
  const quiet = async (): Promise<void> => undefined

  try {
    // 1. 窗口关闭停放：三步都不查渠道，照常做。
    const outcomes: Record<PrintReturnResolution, { pay: string; refund: string }> = {
      confirm_refunded: { pay: 'refunded', refund: 'success' },
      release_paper: { pay: 'paid', refund: 'withdrawn' },
      close_order: { pay: 'closed', refund: 'closed' },
    }
    for (const action of Object.keys(outcomes) as PrintReturnResolution[]) {
      const order = await seed(`win${action.slice(0, 3)}`)
      assert.equal(await parkClosedWindowUnprinted(db, order.id, quiet), 'manual')
      const parked = await refundOf(order.id)
      assert.equal(parked.status, 'manual_review')
      assert.ok(parked.refundNo.startsWith('RFD-WINDOW-'))
      assert.equal(parked.channelSubmittedAt, null, '窗口关闭停放是本地新建，不写已提交渠道时间')
      let queries = 0
      const done = await resolvePrintReturnHold(db, order.id, action, 'admin-test', async () => {
        queries += 1
        return 'processing'
      })
      assert.equal(queries, 0, `${action}：本地停放的待人工不查渠道`)
      assert.equal(done.payStatus, outcomes[action].pay)
      assert.equal(done.refundStatus, outcomes[action].refund)
    }

    // 2. 窗口关闭停放后核验已出纸：放行，同一事务撤回待人工。
    const winVerify = await seed('winvf', { unconfirmed: true })
    assert.equal(await parkClosedWindowUnprinted(db, winVerify.id, quiet), 'manual')
    assert.equal(await verifyPrinted(winVerify.taskId), 'ok')
    const winWithdrawn = await refundOf(winVerify.id)
    assert.equal(winWithdrawn.status, 'withdrawn')
    assert.equal(winWithdrawn.reason, WITHDRAW_REASON)
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: winVerify.taskId } })).printOutcome, 'printed')
    assert.match((await db.auditLog.findFirst({ where: { targetId: winVerify.id, action: 'refund.hold_resolved' } }))?.payloadJson ?? '', /核验已出纸/)

    // 3. 过期付款没有渠道流水：本地待人工，不写列；核验已出纸同样撤回。
    const staleLocal = await seed('stloc', { unconfirmed: true })
    await refundExpiredAttemptCollection(db, new PaymentProviderRegistry([]), {
      orderId: staleLocal.id,
      orderNo: staleLocal.orderNo,
      payStatus: 'paid',
      attemptId: `pa_old_${staleLocal.id}`,
      attemptStatus: 'expired',
      attemptAmountCents: 300,
      orderAmountCents: 200,
      channel: 'wechat',
      channelTxnNo: null,
      result: 'success',
    })
    const staleParked = await refundOf(staleLocal.id)
    assert.equal(staleParked.status, 'manual_review')
    assert.equal(staleParked.reason, STALE_ATTEMPT_REFUND_REASON)
    assert.equal(staleParked.channelSubmittedAt, null, '没有渠道流水的过期付款是本地待人工')
    assert.equal(await verifyPrinted(staleLocal.taskId), 'ok')
    assert.equal((await refundOf(staleLocal.id)).status, 'withdrawn')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: staleLocal.taskId } })).printOutcome, 'printed')

    // 4. 过期付款有渠道流水：先写列再调渠道；发到渠道还没答复，三步不放行。
    const staleSent = await seed('stsent')
    const attemptId = `pa_old_${staleSent.id}`
    await db.paymentAttempt.create({
      data: { id: attemptId, orderId: staleSent.id, channel: 'wechat', amountCents: 300, status: 'expired', prepayId: `prepay_${attemptId}`.slice(0, 64) },
    })
    let seenAtCall: Date | null | undefined
    const provider = {
      channel: 'wechat',
      refund: async (call: RefundExecuteInput) => {
        const row = await observer.refund.findUnique({ where: { refundNo: call.refundNo }, select: { channelSubmittedAt: true } })
        seenAtCall = row?.channelSubmittedAt ?? null
        return { status: 'processing' as const, channelRefundNo: null }
      },
    } as unknown as PaymentProvider
    await refundExpiredAttemptCollection(db, new PaymentProviderRegistry([provider]), {
      orderId: staleSent.id,
      orderNo: staleSent.orderNo,
      payStatus: 'paid',
      attemptId,
      attemptStatus: 'expired',
      attemptAmountCents: 300,
      orderAmountCents: 200,
      channel: 'wechat',
      channelTxnNo: `wxtxn_old_${tag}`,
      result: 'success',
    })
    assert.ok(seenAtCall instanceof Date, '过期付款发到渠道前，已提交渠道时间必须已经提交')
    const staleRow = await refundOf(staleSent.id)
    assert.equal(staleRow.status, 'pending')
    assert.ok(staleRow.channelSubmittedAt)
    const staleCode = await resolvePrintReturnHold(db, staleSent.id, 'release_paper', 'admin-test', async () => 'processing')
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(staleCode, 'REFUND_CHANNEL_UNCONFIRMED', '过期付款原因不能让已经发到渠道的退款当本地单撤回')
    assert.equal((await refundOf(staleSent.id)).status, 'pending')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: staleSent.taskId } })).status, 'failed')
  } finally {
    await observer.onModuleDestroy()
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
