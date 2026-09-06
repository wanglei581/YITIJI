/**
 * API-20 人工发起退款（verify:api20-manual-refund）。
 *
 * 拍板：已付款未出纸只落待退款信号，不自动出款。本门禁钉死：
 *   1. 不点不发：废弃 / 核查未出纸 / 仅打标信号，都不得创建 Refund、不得调 RefundService.refund。
 *   2. 管理端发起退款必须走 canonical RefundService（幂等 refundNo + 审计）。
 *   3. 退款成功后待退款信号清除；渠道明确失败保持 paid + 信号，不得假装成功。
 *   4. 管理端订单页只有点击确认才会调用 refundOrder。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:api20-manual-refund
 */
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'crypto'
import { BadRequestException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { RefundService } from '../src/payment/refund.service'
import { AdminOrdersReadonlyService } from '../src/admin-orders-readonly/admin-orders-readonly.service'
import {
  isPaidUnfulfilledRefundRequired,
  markPaidUnfulfilledRefundRequired,
  PAID_UNFULFILLED_PENDING_REFUND_REASON,
} from '../src/payment/pending-refund-signal'
import type { PaymentProvider } from '../src/payment/payment-provider.types'

function pass(msg: string): void { console.log(`  PASS ${msg}`) }
function fail(msg: string): never { throw new Error(msg) }

const apiRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(apiRoot, '../..')
const readRepo = (relativePath: string): string => readFileSync(path.join(repoRoot, relativePath), 'utf8')

function makeSandboxProvider(): Pick<PaymentProvider, 'channel' | 'refund'> {
  return {
    channel: 'sandbox',
    refund: async () => ({ status: 'success', channelRefundNo: null }),
  }
}

function makeRejectingProvider(): Pick<PaymentProvider, 'channel' | 'refund'> {
  return {
    channel: 'sandbox',
    refund: async () => {
      throw new Error('SANDBOX_CHANNEL_ERROR: INVALID_REQUEST')
    },
  }
}

function assertNoAutoRefundCall(source: string, label: string): void {
  if (/\bRefundService\b/.test(source) || /\.refund\s*\(/.test(source)) {
    fail(`${label} 不得引用 RefundService 或调用 .refund(（不点不发）`)
  }
  pass(`${label} 不自动出款`)
}

async function main(): Promise<void> {
  console.log('\n=== API-20 人工发起退款 ===')
  if (process.env['NODE_ENV'] === 'production') {
    console.error('  FAIL verify:api20-manual-refund 不得在 production 运行')
    process.exit(1)
  }

  const abandonSrc = readRepo('services/api/src/print-jobs/admin-print-jobs-abandon.service.ts')
  const verifySrc = readRepo('services/api/src/print-jobs/admin-print-jobs-verify-outcome.service.ts')
  const signalSrc = readRepo('services/api/src/payment/pending-refund-signal.ts')
  const convergeSrc = readRepo('services/api/src/payment/refund-convergence.task.ts')
  const controllerSrc = readRepo('services/api/src/payment/admin-order-actions.controller.ts')
  const ordersPage = readRepo('apps/admin/src/routes/orders/index.tsx')

  assertNoAutoRefundCall(abandonSrc, '废弃孤单')
  assertNoAutoRefundCall(verifySrc, '核查未出纸')
  if (/from ['"][^'"]*refund\.service['"]/.test(signalSrc) || /refundService\.refund/.test(signalSrc)) {
    fail('待退款信号模块不得调用退款出款')
  }
  pass('待退款信号模块不创建 Refund')
  if (!convergeSrc.includes('convergeStalePendingRefunds')) {
    fail('退款收敛任务必须只收敛已有 pending Refund，不得对信号单自行出款')
  }
  if (/this\.refunds\.refund\s*\(/.test(convergeSrc)) {
    fail('退款收敛任务不得对未建 Refund 的信号单调用 refund()')
  }
  pass('自动收敛只处理已有 pending Refund')

  if (!controllerSrc.includes('this.refundService.refund(id, { reason: body.refundReason, operatorId: user.userId })')) {
    fail('Admin 退款端点必须原样委托 canonical RefundService')
  }
  pass('POST /admin/orders/:id/refund 走 RefundService')

  if ((ordersPage.match(/adminOrdersReadonlyService\.refundOrder\(/g) ?? []).length !== 1) {
    fail('订单页 refundOrder 必须只出现一次（handleRefund 内）')
  }
  if (!/const handleRefund = useCallback\(async \(\) => \{[\s\S]*adminOrdersReadonlyService\.refundOrder\(/.test(ordersPage)) {
    fail('refundOrder 必须只在 handleRefund 内调用')
  }
  if (/useEffect\s*\([\s\S]{0,1200}(?:handleRefund|refundOrder)/.test(ordersPage)) {
    fail('订单页不得在 useEffect 里自动发起退款')
  }
  if (!ordersPage.includes("onClick={() => void handleRefund()}")) {
    fail('退款必须由确认按钮 onClick 触发')
  }
  if (!ordersPage.includes('发起退款') || !ordersPage.includes('确认发起退款')) {
    fail('待退款信号单必须提供「发起退款」二次确认')
  }
  if (!ordersPage.includes('不会自动出款') || !ordersPage.includes('点确认后才会出款')) {
    fail('管理端必须写明不自动出款、点确认才出款')
  }
  pass('管理端只有点击确认才会发起退款')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_api20_${suffix}`
  const ordIdle = `ord_api20_idle_${suffix}`
  const ordOk = `ord_api20_ok_${suffix}`
  const ordFail = `ord_api20_fail_${suffix}`
  const operatorId = `adm_api20_${suffix}`

  async function cleanup(): Promise<void> {
    await prisma.refund.deleteMany({ where: { orderId: { in: [ordIdle, ordOk, ordFail] } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [ordIdle, ordOk, ordFail] } } })
    await prisma.order.deleteMany({ where: { id: { in: [ordIdle, ordOk, ordFail] } } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
  }

  try {
    await cleanup()
    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `KSK-API20-${suffix}`,
        agentToken: `tok_api20_${suffix}`,
        deviceFingerprint: 'verify-api20-manual-refund',
      },
    })

    const seedPaid = async (id: string, orderNo: string, amountCents: number) => {
      await prisma.order.create({
        data: {
          id,
          orderNo,
          type: 'print',
          terminalId,
          amountCents,
          currency: 'CNY',
          payStatus: 'paid',
          taskStatus: 'abandoned',
          paymentSource: 'sandbox',
          discountCents: 0,
          refundedAmountCents: 0,
        },
      })
      const order = await prisma.order.findUniqueOrThrow({ where: { id } })
      const marked = await markPaidUnfulfilledRefundRequired(prisma, order)
      if (!marked) fail(`${id} 未能写入待退款信号`)
    }

    await seedPaid(ordIdle, `ORD-API20-IDLE-${suffix.toUpperCase()}`, 300)
    await seedPaid(ordOk, `ORD-API20-OK-${suffix.toUpperCase()}`, 240)
    await seedPaid(ordFail, `ORD-API20-FAIL-${suffix.toUpperCase()}`, 180)
    pass('测试夹具：三笔已付款未出纸信号单')

    const idleRefunds = await prisma.refund.count({ where: { orderId: ordIdle } })
    const idle = await prisma.order.findUniqueOrThrow({ where: { id: ordIdle } })
    if (idleRefunds !== 0) fail('不点不发：仅打标不得创建 Refund')
    if (idle.payStatus !== 'paid') fail('不点不发：不得改 payStatus')
    if (!isPaidUnfulfilledRefundRequired(idle)) fail('不点不发：信号必须仍在')
    pass('不点不发：信号在、Refund 为 0、payStatus 仍是 paid')

    const refunds = new RefundService(prisma, audit, {
      get: (channel: string) => (channel === 'sandbox' ? makeSandboxProvider() : undefined),
    } as never)
    const result = await refunds.refund(ordOk, { reason: '已付款未出纸，管理员确认发起退款', operatorId })
    const afterOk = await prisma.order.findUniqueOrThrow({ where: { id: ordOk } })
    const refundRow = await prisma.refund.findFirst({ where: { orderId: ordOk } })
    const readonly = new AdminOrdersReadonlyService(prisma)
    const detail = await readonly.getById(ordOk)
    const list = await readonly.list({ refundRequired: true, page: 1, pageSize: 50 })
    const createdAudit = await prisma.auditLog.findFirst({
      where: { action: 'refund.created', targetType: 'order', targetId: ordOk },
    })
    if (result.refund.status !== 'success' || result.order.payStatus !== 'refunded') {
      fail(`成功退款结果异常：${JSON.stringify(result)}`)
    }
    if (afterOk.payStatus !== 'refunded' || afterOk.refundedAmountCents !== 240) {
      fail(`成功后退款额/状态异常：${JSON.stringify(afterOk)}`)
    }
    if (isPaidUnfulfilledRefundRequired(afterOk) || detail.refundRequired !== false) {
      fail('退款成功后待退款信号必须清除')
    }
    if (list.items.some((item) => item.id === ordOk)) fail('成功后退款筛选不得再命中该单')
    if (!refundRow || refundRow.refundNo !== `RFD-${afterOk.orderNo}`) fail('必须落 canonical Refund 账本且 refundNo 按订单派生')
    if (!createdAudit || !String(createdAudit.payloadJson).includes(operatorId)) {
      fail('退款成功必须写 refund.created 审计且带 operatorId')
    }
    pass('点确认后走 RefundService：成功清信号、落账本、写审计')

    const again = await refunds.refund(ordOk, { reason: '重复点击', operatorId })
    const refundCount = await prisma.refund.count({ where: { orderId: ordOk } })
    if (again.idempotent !== true || refundCount !== 1) fail('同 refundNo 必须幂等，不得二次出款')
    pass('同 refundNo 重复请求幂等')

    const failing = new RefundService(prisma, audit, {
      get: (channel: string) => (channel === 'sandbox' ? makeRejectingProvider() : undefined),
    } as never)
    try {
      await failing.refund(ordFail, { reason: '渠道拒绝应如实失败', operatorId })
      fail('渠道明确拒绝时不得返回成功')
    } catch (err) {
      if (!(err instanceof BadRequestException) || err.message !== 'REFUND_CHANNEL_FAILED') {
        throw err
      }
    }
    const afterFail = await prisma.order.findUniqueOrThrow({ where: { id: ordFail } })
    const failRefund = await prisma.refund.findFirst({ where: { orderId: ordFail } })
    const failDetail = await readonly.getById(ordFail)
    if (afterFail.payStatus !== 'paid') fail('渠道失败必须把订单留在 paid，不得假装已退款')
    if (!isPaidUnfulfilledRefundRequired(afterFail) || failDetail.refundRequired !== true) {
      fail('渠道失败必须保留待退款信号')
    }
    if (afterFail.refundedAmountCents !== 0) fail('渠道失败不得写入已退款金额')
    if (!failRefund || failRefund.status !== 'failed') fail('渠道失败必须落 Refund=failed')
    pass('渠道明确失败：保持 paid + 信号，如实失败，不假装成功')
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
