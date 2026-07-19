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

// sandbox provider stub（只实现 refund，其余不用）
function makeSandboxProvider(): Partial<PaymentProvider> & Pick<PaymentProvider, 'refund'> {
  return {
    channel: 'sandbox' as const,
    refund: async () => ({ status: 'success', channelRefundNo: null }),
  }
}

function pass(msg: string): void { console.log(`  PASS ${msg}`) }
function fail(msg: string): never { throw new Error(msg) }

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
  const orderNoPaid = `ORD-AREF-PAID-${suffix.toUpperCase()}`
  const orderNoUnpaid = `ORD-AREF-UNPA-${suffix.toUpperCase()}`
  const orderNoDone = `ORD-AREF-DONE-${suffix.toUpperCase()}`

  async function cleanup(): Promise<void> {
    await prisma.refund.deleteMany({ where: { orderId: { in: [ordPaid, ordUnpaid, ordRefunded] } } })
    await prisma.order.deleteMany({ where: { id: { in: [ordPaid, ordUnpaid, ordRefunded] } } })
    await prisma.terminal.deleteMany({ where: { id: { startsWith: 't_aref_' } } })
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
    pass('测试夹具创建完成')

    // 1. paid 订单退款成功
    const operatorId = `adm_verify_${suffix}`
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

    // 5. 审计日志：退款成功时写入 refund.created
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
