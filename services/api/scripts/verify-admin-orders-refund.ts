/**
 * Admin 订单退款入口验证（verify:admin-orders-refund）— service 级，直调生产 service，不起 HTTP。
 *
 * 断言：
 *  1. payStatus===paid 订单可由 AdminOrderActionsController 调用退款（refundService.refund）；
 *  2. 退款后 payStatus 变为 refunding/refunded，Refund 账本落库，审计写入；
 *  3. payStatus===unpaid 订单退款被 ORDER_NOT_REFUNDABLE 拒绝；
 *  4. 已退款（refunded）订单退款被 ORDER_ALREADY_REFUNDED 拒绝（幂等防重）；
 *  5. 同 refundNo 重复请求幂等返回，不重复出款/审计。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:admin-orders-refund
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { BadRequestException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { RefundService } from '../src/payment/refund.service'
import type { PaymentProvider } from '../src/payment/payment-provider.types'

let sandboxRefundCalls = 0
let sandboxRefundImpl: () => Promise<{ status: 'success' | 'failed'; channelRefundNo: string | null }> = async () => ({
  status: 'success',
  channelRefundNo: 'sbx_rfd_ok',
})

// sandbox provider stub（只实现 refund，其余不用）
function makeSandboxProvider(): Partial<PaymentProvider> & Pick<PaymentProvider, 'refund'> {
  return {
    channel: 'sandbox' as const,
    refund: async () => {
      sandboxRefundCalls += 1
      return sandboxRefundImpl()
    },
  }
}

function pass(msg: string): void { console.log(`  PASS ${msg}`) }
function fail(msg: string): never { throw new Error(msg) }

async function expectCode(label: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    if (msg.includes(code)) {
      pass(label)
      return
    }
    fail(`${label} — expected ${code}, got: ${msg}`)
  }
  fail(`${label} — expected ${code}, but resolved`)
}

async function main(): Promise<void> {
  console.log('\n=== Admin 订单退款入口验证 ===')

  // 不得在生产环境运行
  if (process.env['NODE_ENV'] === 'production') {
    console.error('  FAIL verify:admin-orders-refund 不得在 production 运行')
    process.exit(1)
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()

  const audit = new AuditService(prisma)
  const registry = { get: (channel: string) => channel === 'sandbox' ? makeSandboxProvider() : undefined }
  const refundService = new RefundService(prisma, audit, registry as ReturnType<typeof Object.assign>)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_aref_${suffix}`
  const ordPaid = `ord_aref_paid_${suffix}`
  const ordUnpaid = `ord_aref_unpaid_${suffix}`
  const ordRefunded = `ord_aref_done_${suffix}`
  const ordPrinted = `ord_aref_printed_${suffix}`
  const ordPending = `ord_aref_pend_${suffix}`
  const ordDup = `ord_aref_dup_${suffix}`
  const ordAmt = `ord_aref_amt_${suffix}`
  const ordChan = `ord_aref_chan_${suffix}`
  const ordPendPrint = `ord_aref_pprt_${suffix}`
  const ordFail = `ord_aref_fail_${suffix}`
  const taskPrinted = `pt_aref_printed_${suffix}`
  const taskPendPrint = `pt_aref_pprt_${suffix}`
  const orderNoPaid = `ORD-AREF-PAID-${suffix.toUpperCase()}`
  const orderNoUnpaid = `ORD-AREF-UNPA-${suffix.toUpperCase()}`
  const orderNoDone = `ORD-AREF-DONE-${suffix.toUpperCase()}`
  const orderNoPrinted = `ORD-AREF-PRNT-${suffix.toUpperCase()}`
  const orderNoPending = `ORD-AREF-PEND-${suffix.toUpperCase()}`
  const pendingOrderIds = [ordPaid, ordUnpaid, ordRefunded, ordPrinted, ordPending, ordDup, ordAmt, ordChan, ordPendPrint, ordFail]

  async function cleanup(): Promise<void> {
    await prisma.refund.deleteMany({ where: { orderId: { in: pendingOrderIds } } })
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: pendingOrderIds } } })
    await prisma.order.deleteMany({ where: { id: { in: pendingOrderIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: [taskPrinted, taskPendPrint] } } })
    await prisma.terminal.deleteMany({ where: { id: { startsWith: 't_aref_' } } })
  }

  async function seedCollected(id: string, orderNo: string, extra?: { channel?: string; attemptAmount?: number; pickupCode?: string }): Promise<void> {
    await prisma.order.create({
      data: {
        id,
        orderNo,
        type: 'print',
        terminalId,
        amountCents: 300,
        currency: 'CNY',
        payStatus: 'closed',
        taskStatus: 'expired',
        pickupStatus: 'expired',
        pickupCodeExpiresAt: new Date(Date.now() - 60_000),
        pickupCode: extra?.pickupCode ?? null,
        refundReason: 'ONLINE_PAID_PENDING_REFUND',
        discountCents: 0,
      },
    })
    await prisma.paymentAttempt.create({
      data: {
        orderId: id,
        channel: extra?.channel ?? 'sandbox',
        amountCents: extra?.attemptAmount ?? 300,
        status: 'success',
        prepayId: `prepay_${id}`,
        channelTxnNo: `txn_${id}`,
      },
    })
  }

  try {
    await cleanup()

    await prisma.terminal.create({
      data: { id: terminalId, terminalCode: `KSK-AREF-${suffix}`, agentToken: `tok_aref_${suffix}`, deviceFingerprint: 'verify-admin-orders-refund' },
    })

    // paid 订单（paymentSource=sandbox，可走 refund provider）
    await prisma.order.create({
      data: { id: ordPaid, orderNo: orderNoPaid, type: 'print', terminalId, amountCents: 200, currency: 'CNY', payStatus: 'paid', taskStatus: 'completed', paymentSource: 'sandbox', discountCents: 0 },
    })
    // unpaid 订单
    await prisma.order.create({
      data: { id: ordUnpaid, orderNo: orderNoUnpaid, type: 'print', terminalId, amountCents: 0, currency: 'CNY', payStatus: 'unpaid', taskStatus: 'pending', discountCents: 0 },
    })
    // 已退款订单
    await prisma.order.create({
      data: { id: ordRefunded, orderNo: orderNoDone, type: 'print', terminalId, amountCents: 100, currency: 'CNY', payStatus: 'refunded', taskStatus: 'completed', paymentSource: 'sandbox', discountCents: 0 },
    })
    await prisma.printTask.create({
      data: {
        id: taskPrinted,
        terminalId,
        fileUrl: 'https://internal/aref-printed',
        fileMd5: 'aref-printed',
        status: 'failed',
        errorCode: 'PRINT_JOB_UNCONFIRMED',
        printOutcome: 'printed',
      },
    })
    await prisma.order.create({
      data: {
        id: ordPrinted,
        orderNo: orderNoPrinted,
        type: 'print',
        printTaskId: taskPrinted,
        terminalId,
        amountCents: 200,
        currency: 'CNY',
        payStatus: 'paid',
        taskStatus: 'failed',
        paymentSource: 'sandbox',
        discountCents: 0,
      },
    })
    await prisma.order.create({
      data: {
        id: ordPending,
        orderNo: orderNoPending,
        type: 'print',
        terminalId,
        amountCents: 300,
        currency: 'CNY',
        payStatus: 'closed',
        taskStatus: 'expired',
        pickupStatus: 'expired',
        pickupCodeExpiresAt: new Date(Date.now() - 60_000),
        refundReason: 'ONLINE_PAID_PENDING_REFUND',
        discountCents: 0,
      },
    })
    await prisma.paymentAttempt.create({
      data: {
        orderId: ordPending,
        channel: 'sandbox',
        amountCents: 300,
        status: 'success',
        prepayId: `prepay_pend_${suffix}`,
        channelTxnNo: `sbx_txn_pend_${suffix}`,
      },
    })
    pass('测试夹具创建完成')

    const operatorId = `adm_verify_${suffix}`

    // 0. P0 复现：渠道已收款、取件窗口已关的单必须能走 canonical 退款（当前 main 会 ORDER_NOT_REFUNDABLE）
    const pendingResult = await refundService.refund(ordPending, { reason: '迟到回调待退', operatorId })
    const pendingAfter = await prisma.order.findUnique({ where: { id: ordPending } })
    const pendingRefund = await prisma.refund.findFirst({ where: { orderId: ordPending } })
    if (
      pendingAfter?.payStatus === 'refunded' &&
      pendingAfter.paymentSource === null &&
      pendingAfter.pickupCode === null &&
      pendingAfter.printTaskId === null &&
      pendingAfter.refundedAmountCents === 300 &&
      pendingRefund?.status === 'success' &&
      pendingRefund.amountCents === 300 &&
      pendingRefund.channel === 'sandbox' &&
      pendingResult.refund.amountCents === 300
    ) {
      pass('迟到回调待退单：canonical 退款成功，金额精确，不铸取件码、不建打印任务')
    } else {
      fail(
        `迟到回调待退单退款失败：order=${JSON.stringify(pendingAfter)} refund=${JSON.stringify(pendingRefund)} result=${JSON.stringify(pendingResult)}`,
      )
    }
    if (sandboxRefundCalls !== 1) fail(`迟到回调待退应只调渠道一次，实际 ${sandboxRefundCalls}`)
    const pendingRepeat = await refundService.refund(ordPending, { reason: '重复迟到回调退款', operatorId })
    if (pendingRepeat.idempotent === true && sandboxRefundCalls === 1) {
      pass('迟到回调待退重复请求幂等：不重复出款')
    } else {
      fail(`迟到回调待退重复请求非幂等：idempotent=${pendingRepeat.idempotent} calls=${sandboxRefundCalls}`)
    }

    await seedCollected(ordDup, `ORD-AREF-DUP-${suffix.toUpperCase()}`)
    await prisma.paymentAttempt.create({
      data: {
        orderId: ordDup,
        channel: 'sandbox',
        amountCents: 300,
        status: 'success',
        prepayId: `prepay_${ordDup}_b`,
        channelTxnNo: `txn_${ordDup}_b`,
      },
    })
    await expectCode('两条 success 尝试 → REFUND_SOURCE_AMBIGUOUS', 'REFUND_SOURCE_AMBIGUOUS', () =>
      refundService.refund(ordDup, { reason: '双成功尝试', operatorId }),
    )
    if ((await prisma.order.findUnique({ where: { id: ordDup } }))?.payStatus !== 'closed') {
      fail('双成功尝试拦截后不得改 payStatus')
    }

    await seedCollected(ordAmt, `ORD-AREF-AMT-${suffix.toUpperCase()}`, { attemptAmount: 280 })
    await expectCode('金额与尝试快照不一致 → REFUND_AMOUNT_BASIS_UNSUPPORTED', 'REFUND_AMOUNT_BASIS_UNSUPPORTED', () =>
      refundService.refund(ordAmt, { reason: '金额不一致', operatorId }),
    )

    await seedCollected(ordChan, `ORD-AREF-CHAN-${suffix.toUpperCase()}`, { channel: 'offline' })
    await expectCode('不支持通道 → REFUND_CHANNEL_UNSUPPORTED', 'REFUND_CHANNEL_UNSUPPORTED', () =>
      refundService.refund(ordChan, { reason: '不支持通道', operatorId }),
    )

    await prisma.printTask.create({
      data: {
        id: taskPendPrint,
        terminalId,
        fileUrl: 'https://internal/aref-pend-printed',
        fileMd5: 'aref-pend-printed',
        status: 'failed',
        errorCode: 'PRINT_JOB_UNCONFIRMED',
        printOutcome: 'printed',
      },
    })
    await prisma.order.create({
      data: {
        id: ordPendPrint,
        orderNo: `ORD-AREF-PPRT-${suffix.toUpperCase()}`,
        type: 'print',
        printTaskId: taskPendPrint,
        terminalId,
        amountCents: 300,
        currency: 'CNY',
        payStatus: 'closed',
        taskStatus: 'failed',
        pickupStatus: 'expired',
        refundReason: 'ONLINE_PAID_PENDING_REFUND',
        discountCents: 0,
      },
    })
    await prisma.paymentAttempt.create({
      data: {
        orderId: ordPendPrint,
        channel: 'sandbox',
        amountCents: 300,
        status: 'success',
        prepayId: `prepay_${ordPendPrint}`,
        channelTxnNo: `txn_${ordPendPrint}`,
      },
    })
    await expectCode('已核查出纸的待退单 → PRINT_REFUND_VERIFIED_PRINTED_FORBIDDEN', 'PRINT_REFUND_VERIFIED_PRINTED_FORBIDDEN', () =>
      refundService.refund(ordPendPrint, { reason: '已出纸', operatorId }),
    )

    await seedCollected(ordFail, `ORD-AREF-FAIL-${suffix.toUpperCase()}`)
    const callsBeforeFail = sandboxRefundCalls
    sandboxRefundImpl = async () => ({ status: 'failed', channelRefundNo: null })
    await expectCode('渠道明确拒绝 → REFUND_CHANNEL_FAILED', 'REFUND_CHANNEL_FAILED', () =>
      refundService.refund(ordFail, { reason: '渠道拒绝后重试', operatorId }),
    )
    const afterFail = await prisma.order.findUnique({ where: { id: ordFail } })
    if (afterFail?.payStatus === 'closed' && afterFail.pickupCode == null && afterFail.paymentSource == null) {
      pass('渠道拒绝后回滚 closed（不得写成 paid），无取件码')
    } else {
      fail(`渠道拒绝回滚错误：${JSON.stringify(afterFail)}`)
    }
    sandboxRefundImpl = async () => ({ status: 'success', channelRefundNo: 'sbx_rfd_retry' })
    const retried = await refundService.refund(ordFail, { reason: '渠道拒绝后重试', operatorId })
    const afterRetry = await prisma.order.findUnique({ where: { id: ordFail } })
    if (
      retried.refund.status === 'success' &&
      afterRetry?.payStatus === 'refunded' &&
      afterRetry.refundedAmountCents === 300 &&
      sandboxRefundCalls === callsBeforeFail + 2
    ) {
      pass('渠道拒绝后同号重试成功，金额精确')
    } else {
      fail(`同号重试失败：${JSON.stringify({ retried, afterRetry, calls: sandboxRefundCalls })}`)
    }

    // 1. paid 订单退款成功
    const result = await refundService.refund(ordPaid, { reason: '管理员测试退款', operatorId })
    const orderAfter = await prisma.order.findUnique({ where: { id: ordPaid } })
    const refundRecord = await prisma.refund.findFirst({ where: { orderId: ordPaid } })
    if (
      (orderAfter?.payStatus === 'refunded' || orderAfter?.payStatus === 'refunding') &&
      refundRecord !== null &&
      result.refund.amountCents === 200 &&
      result.refund.reason === '管理员测试退款'
    ) {
      pass('paid 订单退款成功，状态流转 paid→refunded，Refund 账本落库')
    } else {
      fail(`paid 退款失败：orderAfter=${JSON.stringify(orderAfter)}, result=${JSON.stringify(result)}`)
    }

    // 2. 同 refundNo 幂等（重复请求）
    const refundNoPaid = `RFD-${orderNoPaid}`
    const result2 = await refundService.refund(ordPaid, { refundNo: refundNoPaid, reason: '重复退款请求', operatorId })
    const refundCount = await prisma.refund.count({ where: { orderId: ordPaid } })
    if (result2.idempotent === true && refundCount === 1) {
      pass('同 refundNo 重复请求幂等：不重复出款，Refund 只 1 条')
    } else {
      fail(`幂等失败：idempotent=${result2.idempotent}, refundCount=${refundCount}`)
    }

    // 3. unpaid 订单被拒绝
    try {
      await refundService.refund(ordUnpaid, { reason: '尝试退未支付订单', operatorId })
      fail('unpaid 订单退款应被拒绝')
    } catch (e) {
      if (e instanceof BadRequestException && e.message === 'ORDER_NOT_REFUNDABLE') {
        pass('unpaid 订单退款被 ORDER_NOT_REFUNDABLE 拒绝')
      } else {
        throw e
      }
    }

    // 4. 已退款订单被拒绝
    try {
      await refundService.refund(ordRefunded, { reason: '重复退款', operatorId })
      fail('already refunded 订单应被 ORDER_ALREADY_REFUNDED 拒绝')
    } catch (e) {
      if (e instanceof BadRequestException && e.message === 'ORDER_ALREADY_REFUNDED') {
        pass('已退款订单退款被 ORDER_ALREADY_REFUNDED 拒绝')
      } else {
        throw e
      }
    }

    // 5. 已核查出纸禁止退款（写门，不只是 UI 藏按钮）
    try {
      await refundService.refund(ordPrinted, { reason: '已出纸不应退款', operatorId })
      fail('已核查出纸订单退款应被拒绝')
    } catch (e) {
      if (e instanceof BadRequestException && e.message === 'PRINT_REFUND_VERIFIED_PRINTED_FORBIDDEN') {
        pass('已核查出纸退款被 PRINT_REFUND_VERIFIED_PRINTED_FORBIDDEN 拒绝')
      } else {
        throw e
      }
    }

    // 6. 审计日志：退款成功时写入 refund.created
    const auditLogs = await prisma.auditLog.findMany({
      where: { action: 'refund.created', targetId: ordPaid },
      orderBy: { createdAt: 'desc' },
    })
    if (auditLogs.length >= 1) {
      pass(`审计日志已写入（refund.created，条数=${auditLogs.length}）`)
    } else {
      fail(`审计日志缺失：action=refund.created, targetId=${ordPaid}`)
    }

  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
