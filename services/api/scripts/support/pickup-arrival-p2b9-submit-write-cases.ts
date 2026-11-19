/**
 * 「已提交渠道时间」只由真实写入路径决定（第 1 条复核补充）。
 * - 退款服务向渠道发起退款前，先把这一列写进库并提交：渠道调用时，另一个连接已经读得到。
 * - 调用中途抛出说不准的错：这一列照样留着，三步不放行。
 * - 通道没配上（请求没离开本机）、真实渠道发起前就拦下、线下单：永远不写。
 * - 先遇到「在线支付未开」、之后同号重发到渠道：不再被历史审计放行。
 * - 金额不符搁置（真实 holdMismatchedChannelRefund 写出，渠道退款号为空）：改为出纸不撤回。
 * - 订单已关、渠道又通知退成的待人工：不再按字段走捷径，不查渠道就不放行。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { AuditService } from '../../src/audit/audit.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider, RefundExecuteInput, RefundExecuteResult } from '../../src/payment/payment-provider.types'
import { PRINT_NO_PAPER_AUTO_FAILED_AUDIT } from '../../src/payment/print-return-disposition'
import { holdMismatchedChannelRefund } from '../../src/payment/refund-amount-hold'
import { RefundService } from '../../src/payment/refund.service'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } } | string
  if (typeof body === 'string') return body
  return body?.error?.code ?? error.message
}

type RefundCall = (input: RefundExecuteInput) => Promise<RefundExecuteResult>

function wechat(refund: RefundCall, extra?: Partial<PaymentProvider>): PaymentRegistryLike {
  return new PaymentProviderRegistry([{ channel: 'wechat', refund, ...extra } as unknown as PaymentProvider])
}

type PaymentRegistryLike = PaymentProviderRegistry

export async function runP2b9SubmitWriteCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9sw_${tag}`
  const terminalId = `term_p2b9sw_${tag}`
  await db.organization.create({ data: { id: orgId, name: '已提交渠道真实写入', type: 'school_employment_center' } })
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
  // 另开一个连接读库：只有已经提交的写入才读得到。
  const observer = new PrismaService()
  await observer.onModuleInit()
  const created: string[] = []

  const seed = async (label: string, opts?: { source?: string; attempt?: boolean; payStatus?: string }): Promise<string> => {
    const id = `ord_${tag}_p2b9sw_${label}`
    const taskId = `pt_${id}`
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'failed',
        printOutcome: 'not_printed',
        errorCode: 'PAPER_JAM',
        orderId: id,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id,
        orderNo: `P9SW${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32),
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: opts?.payStatus ?? 'paid',
        paymentSource: opts?.source ?? 'wechat',
        paidAt: new Date(Date.now() - 40 * 60 * 1000),
        pickupStatus: 'pending',
        taskStatus: 'failed',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: taskId,
      },
    })
    if (opts?.attempt !== false && (opts?.source ?? 'wechat') === 'wechat') {
      await db.paymentAttempt.create({
        data: {
          id: `pa_${id}`,
          orderId: id,
          channel: 'wechat',
          amountCents: 200,
          status: 'success',
          channelTxnNo: `wxtxn_${tag}_${label}`.slice(0, 64),
          prepayId: `prepay_${id}`.slice(0, 64),
        },
      })
    }
    return id
  }
  const refundRow = (orderId: string) => db.refund.findFirstOrThrow({ where: { orderId }, orderBy: { createdAt: 'desc' } })
  const release = (orderId: string, query?: () => Promise<'processing' | 'failed'>) =>
    resolvePrintReturnHold(db, orderId, 'release_paper', 'admin-test', query).then(() => 'ok', (error: unknown) => errorCode(error))

  try {
    // 1. 先写列、再调渠道：渠道调用时另一个连接已经读得到这一列。
    const submitted = await seed('sub')
    let seenAtCall: Date | null | undefined
    const submitService = new RefundService(db, new AuditService(db), wechat(async (call) => {
      const row = await observer.refund.findUnique({ where: { refundNo: call.refundNo }, select: { channelSubmittedAt: true } })
      seenAtCall = row?.channelSubmittedAt ?? null
      return { status: 'processing', channelRefundNo: null }
    }))
    const submittedView = await submitService.refund(submitted, { reason: '真实写入：先写列再调渠道' })
    assert.equal(submittedView.refund.status, 'pending')
    assert.ok(seenAtCall instanceof Date, '渠道调用时，已提交渠道时间必须已经提交进库')
    assert.ok((await refundRow(submitted)).channelSubmittedAt, '受理中的渠道退款要留着已提交渠道时间')
    assert.equal(await release(submitted), 'REFUND_CHANNEL_UNCONFIRMED', '发到渠道还没答复，改为出纸不放行')
    assert.equal((await refundRow(submitted)).status, 'pending')

    // 2. 渠道调用说不准（超时）：列照样留着，三步不放行。
    const ambiguous = await seed('amb')
    const ambiguousService = new RefundService(db, new AuditService(db), wechat(async () => {
      throw new Error('WECHAT_FETCH_TIMEOUT: socket hang up')
    }))
    const ambiguousView = await ambiguousService.refund(ambiguous, { reason: '真实写入：调用中途出错' })
    assert.equal(ambiguousView.refund.status, 'pending')
    assert.ok((await refundRow(ambiguous)).channelSubmittedAt, '调用中途出错也算提交过')
    assert.equal(await release(ambiguous, async () => 'processing'), 'REFUND_CHANNEL_UNCONFIRMED')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: `pt_${ambiguous}` } })).status, 'failed')

    // 3. 通道没配上：请求没离开本机，不写列，三步照常。
    const neverLeft = await seed('nl')
    const offService = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([]))
    const offCode = await offService.refund(neverLeft, { reason: '真实写入：通道没开' }).then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(offCode, 'ONLINE_PAYMENT_DISABLED')
    assert.equal((await refundRow(neverLeft)).channelSubmittedAt, null, '请求没离开本机不能写已提交渠道时间')
    let neverLeftQueries = 0
    const neverLeftDone = await resolvePrintReturnHold(db, neverLeft, 'release_paper', 'admin-test', async () => {
      neverLeftQueries += 1
      return 'processing'
    })
    assert.equal(neverLeftQueries, 0, '没提交过渠道的不查渠道')
    assert.equal(neverLeftDone.refundStatus, 'withdrawn')
    assert.equal(neverLeftDone.taskStatus, 'pending')

    // 4. 先遇到「在线支付未开」留下审计，之后同号重发到渠道：历史审计不能再放行。
    const resent = await seed('rs')
    const resentFirst = await offService.refund(resent, { reason: '真实写入：先没开后重发' }).then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(resentFirst, 'ONLINE_PAYMENT_DISABLED')
    await db.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'system',
        action: PRINT_NO_PAPER_AUTO_FAILED_AUDIT,
        targetType: 'order',
        targetId: resent,
        payloadJson: JSON.stringify({ code: 'ONLINE_PAYMENT_DISABLED' }),
      },
    })
    assert.equal((await refundRow(resent)).channelSubmittedAt, null)
    let resentCalls = 0
    const resendService = new RefundService(db, new AuditService(db), wechat(async () => {
      resentCalls += 1
      return { status: 'processing', channelRefundNo: null }
    }, { queryRefund: async () => ({ status: 'unknown', channelRefundNo: null }) }))
    const resentView = await resendService.refund(resent, { refundNo: (await refundRow(resent)).refundNo, reason: '真实写入：先没开后重发' })
    assert.equal(resentCalls, 1, '渠道查无此单时同号重发')
    assert.equal(resentView.refund.status, 'pending')
    assert.ok((await refundRow(resent)).channelSubmittedAt, '重发到渠道之后要写已提交渠道时间')
    assert.equal(await release(resent), 'REFUND_CHANNEL_UNCONFIRMED', '历史「在线支付未开」审计不能放行已经发到渠道的退款')
    assert.equal(await release(resent, async () => 'processing'), 'REFUND_CHANNEL_UNCONFIRMED')
    assert.equal((await refundRow(resent)).status, 'pending')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: `pt_${resent}` } })).status, 'failed')

    // 5. 真实渠道发起前就拦下（找不到原付款）、线下单：都不写列。
    const blocked = await seed('blk', { attempt: false })
    const blockedCode = await submitService.refund(blocked, { reason: '真实写入：原付款缺失' }).then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(blockedCode, 'REFUND_SOURCE_ATTEMPT_MISSING')
    assert.equal((await refundRow(blocked)).status, 'failed')
    assert.equal((await refundRow(blocked)).channelSubmittedAt, null, '发起前拦下的不算提交过渠道')
    const offline = await seed('off', { source: 'offline' })
    const offlineView = await submitService.refund(offline, { reason: '真实写入：线下单' })
    assert.equal(offlineView.refund.status, 'success')
    assert.equal((await refundRow(offline)).channelSubmittedAt, null, '线下退款不调渠道，不写这一列')

    // 6. 金额不符搁置（Grok 实测那一类）：真实写入路径写出待人工、渠道退款号为空。改为出纸不能撤回。
    const mismatch = await seed('mm')
    await submitService.refund(mismatch, { reason: '真实写入：金额不符' })
    const pendingRefund = await refundRow(mismatch)
    const order = await db.order.findUniqueOrThrow({ where: { id: mismatch } })
    const held = await holdMismatchedChannelRefund(db, {
      refundId: pendingRefund.id,
      refundNo: pendingRefund.refundNo,
      order,
      recordedAmountCents: 200,
      notifyAmountCents: 150,
      channelRefundNo: null,
    })
    assert.equal(held, 'held')
    const heldRow = await refundRow(mismatch)
    assert.equal(heldRow.status, 'manual_review')
    assert.equal(heldRow.channelRefundNo, null)
    assert.ok(heldRow.channelSubmittedAt)
    assert.equal(await release(mismatch), 'REFUND_CHANNEL_UNCONFIRMED', '金额不符搁置、渠道退款号为空也不能当本地单撤回')
    assert.equal((await refundRow(mismatch)).status, 'manual_review')
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: `pt_${mismatch}` } })).status, 'failed')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: mismatch } })).payStatus, 'refunding')

    // 7. 订单已关、渠道事后又通知退成：待人工 + 渠道退款号 + 已提交渠道。没有渠道答复不能直接记退成。
    const shut = await seed('shut', { payStatus: 'closed' })
    await db.refund.create({
      data: {
        orderId: shut,
        refundNo: `RFD-P9SW-SHUT-${tag}`.slice(0, 40),
        amountCents: 200,
        status: 'manual_review',
        reason: '退款失败',
        channel: 'wechat',
        channelRefundNo: `WX-SHUT-${tag}`.slice(0, 32),
        channelSubmittedAt: new Date(Date.now() - 30 * 60 * 1000),
      },
    })
    for (const action of ['confirm_refunded', 'release_paper', 'close_order'] as const) {
      const code = await resolvePrintReturnHold(db, shut, action, 'admin-test').then(() => 'ok', (error: unknown) => errorCode(error))
      assert.equal(code, 'REFUND_CHANNEL_UNCONFIRMED', `${action}：关单后的待人工不按字段走捷径，要先问渠道`)
    }
    assert.equal((await refundRow(shut)).status, 'manual_review')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: shut } })).payStatus, 'closed')
  } finally {
    await observer.onModuleDestroy()
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.paymentAttempt.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
