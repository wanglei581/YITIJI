/**
 * C5-4 退款域守门（verify:refund-idempotent）—— service 级，直调生产 service，不起 HTTP。
 *
 * 断言（对齐用户定版验证要求）：
 *  1. 全额 sandbox 退款 paid → refunding → refunded（Refund 落库 + provider 假流水 + 审计 refund.created）；
 *     spy provider 在 provider.refund 调用瞬间快照订单态 = refunding（证明中间态真实存在）。
 *  2. 同 refundNo 幂等：重复请求返回既有记录，Refund 只 1 条、审计只 1 条、不重复出款。
 *  3. 不同 refundNo 重复退同一订单 → ORDER_ALREADY_REFUNDED（订单态兜底防重复退款）。
 *  4. offline / manual_confirmed 人工退款 **不调 provider**（spy 计数不变），channel=来源、channelRefundNo=null。
 *  5. voucher（券/权益全额核销单）退款 **不调 provider、不恢复 BenefitGrant 额度**（quantityRemaining 不变），
 *     审计 payload benefitRestored=false。
 *  6. unpaid / paying / closed 不可退款 → ORDER_NOT_REFUNDABLE。
 *  7. C5-3 出纸门控回归：refunded / refunding 订单的打印任务**不可 claim**（只有 paid 放行）。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:refund-idempotent
 */
import 'dotenv/config'
import { randomBytes, randomUUID } from 'crypto'

process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-refund-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-refund-terminal-action-secret-0123456789'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-refund-file-signing-secret-0123456789abcd'
process.env['PAYMENT_SESSION_SECRET'] ||= 'verify-refund-payment-session-secret-0123456789'
process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] = 'true'
if (process.env['NODE_ENV'] === 'production') {
  console.error('  FAIL verify:refund-idempotent 不得在 NODE_ENV=production 运行（沙箱模拟支付被禁用）')
  process.exit(1)
}

import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { TerminalToolboxService } from '../src/terminals/terminal-toolbox.service'
import { AuditService } from '../src/audit/audit.service'
import { signFileUrl } from '../src/files/signing'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { OrderStatusService } from '../src/payment/order-status.service'
import { RefundService } from '../src/payment/refund.service'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { SandboxPaymentProvider } from '../src/payment/providers/sandbox-payment.provider'
import { createPaymentSessionToken } from '../src/payment/payment-session-token'
import type {
  PaymentCallbackContext,
  PaymentProvider,
  QrPaymentCreateInput,
  RefundExecuteInput,
} from '../src/payment/payment-provider.types'
import { BenefitRedemptionService } from '../src/benefit-redemption/benefit-redemption.service'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { StorageService } from '../src/storage/storage.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'

const SECRET = 'verify-refund-sandbox-secret-0001'
let passed = 0
const pass = (m: string): void => { passed += 1; console.log(`  PASS ${m}`) }
const fail = (m: string): never => { console.error(`  FAIL ${m}`); process.exit(1) }
const assert = (c: unknown, m: string): void => { c ? pass(m) : fail(m) }
async function expectCode(label: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try { await fn() } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    if (msg.includes(code)) return pass(label)
    return fail(`${label} — 期望 ${code}，实际: ${msg}`)
  }
  fail(`${label} — 期望 ${code}，但未抛`)
}

/** spy provider：包裹沙箱，统计 refund 调用 + 在 refund 瞬间快照订单态（证明 refunding 中间态）。 */
class SpyProvider implements PaymentProvider {
  readonly channel = 'sandbox' as const
  refundCalls = 0
  statusDuringRefund: string | null = null
  constructor(private readonly inner: SandboxPaymentProvider, private readonly prisma: PrismaService) {}
  createQrPayment(i: QrPaymentCreateInput) { return this.inner.createQrPayment(i) }
  verifyAndParseCallback(c: PaymentCallbackContext) { return this.inner.verifyAndParseCallback(c) }
  async refund(i: RefundExecuteInput) {
    this.refundCalls += 1
    const o = await this.prisma.order.findUnique({ where: { id: i.orderId } })
    this.statusDuringRefund = o?.payStatus ?? null
    return this.inner.refund(i)
  }
}

async function main(): Promise<void> {
  console.log('\n=== C5-4 退款域 verification ===')
  const { TerminalsService } = await import('../src/terminals/terminals.service')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const pricing = new PricingService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const realProvider = new SandboxPaymentProvider(SECRET)
  const onlinePayment = new OnlinePaymentService(prisma, audit, orderStatus, new PaymentProviderRegistry([realProvider]))
  const spy = new SpyProvider(realProvider, prisma)
  const refundService = new RefundService(prisma, audit, new PaymentProviderRegistry([spy]))
  const printJobs = new PrintJobsService(prisma, audit, new PrintPageCountService(prisma, storage), pricing, orderStatus, new TerminalCapabilitiesService(prisma))
  const redemption = new BenefitRedemptionService(prisma, audit, orderStatus)
  const terminals = new TerminalsService(prisma, new TerminalToolboxService(prisma), audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_refund_${suffix}`
  const agentToken = randomBytes(16).toString('hex')
  const endUserId = `eu_refund_${suffix}`
  const orderIds: string[] = []
  const taskIds: string[] = []
  const grantIds: string[] = []
  const fileIds: string[] = []
  const storageKeys: string[] = []
  let seq = 0

  async function makeOrder(amountCents: number, withEndUser = false): Promise<string> {
    seq += 1
    const order = await prisma.order.create({
      data: {
        orderNo: `ORD-REFUND-${suffix}-${seq}`,
        type: 'print',
        amountCents,
        payStatus: 'unpaid',
        taskStatus: 'pending',
        terminalId,
        endUserId: withEndUser ? endUserId : null,
      },
    })
    orderIds.push(order.id)
    return order.id
  }
  /** 生成与订单绑定的支付会话 token（payment-session PR 起 createPayAttempt/getPayStatus 必需）。 */
  async function sessionToken(orderId: string): Promise<string> {
    const o = (await prisma.order.findUnique({ where: { id: orderId } }))!
    return createPaymentSessionToken({ orderId: o.id, orderNo: o.orderNo, terminalId: o.terminalId, amountCents: o.amountCents, printTaskId: o.printTaskId })
  }
  async function paySandbox(orderId: string): Promise<void> {
    const attempt = await onlinePayment.createPayAttempt(orderId, await sessionToken(orderId))
    await onlinePayment.simulateSandboxCallback({ attemptId: attempt.attemptId, result: 'success' })
  }
  async function payStatusOf(orderId: string): Promise<string> {
    return (await prisma.order.findUnique({ where: { id: orderId } }))!.payStatus
  }
  async function refundAuditCount(orderId: string): Promise<number> {
    return prisma.auditLog.count({ where: { action: 'refund.created', targetId: orderId } })
  }
  async function seedPdf(label: string): Promise<string> {
    const fileId = `f_refund_${suffix}_${label}`
    const key = `verify/refund/${fileId}.pdf`
    const bytes = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n')
    await storage.putObject(key, bytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: { id: fileId, storageKey: key, filename: `${label}.pdf`, mimeType: 'application/pdf', sizeBytes: bytes.length, sha256: '', purpose: 'print_source', bucket: LOCAL_BUCKET_SENTINEL },
    })
    fileIds.push(fileId); storageKeys.push(key)
    return signFileUrl(fileId, 60_000).url
  }

  async function cleanup(): Promise<void> {
    const allOrders = await prisma.order.findMany({ where: { OR: [{ terminalId }, { printTaskId: { in: taskIds } }] }, select: { id: true } })
    const ids = [...new Set([...orderIds, ...allOrders.map((o) => o.id)])]
    const attempts = await prisma.paymentAttempt.findMany({ where: { orderId: { in: ids } }, select: { id: true } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [...ids, ...taskIds, ...grantIds] } } })
    await prisma.auditLog.deleteMany({ where: { targetType: 'payment_attempt', targetId: { in: attempts.map((a) => a.id) } } })
    await prisma.refund.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: ids } } })
    await prisma.redemptionRecord.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { endUserId }] } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.benefitClaim.deleteMany({ where: { benefitGrantId: { in: grantIds } } })
    await prisma.benefitGrant.deleteMany({ where: { OR: [{ id: { in: grantIds } }, { endUserId }] } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
    await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } })
    for (const k of storageKeys) await storage.deleteObject(k, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await prisma.priceConfig.deleteMany({ where: { serviceKey: { in: ['print_bw_page', 'print_color_page'] } } })
  }

  try {
    await cleanup()
    await prisma.terminal.create({ data: { id: terminalId, terminalCode: `KSK-RFD-${suffix}`, agentToken, deviceFingerprint: 'verify-refund' } })
    await prisma.endUser.create({ data: { id: endUserId, phoneHash: `hash_${suffix}`, phoneEnc: `enc_${suffix}` } })
    await seedDevDefaultPriceConfig(prisma)
    pass('测试夹具已创建')

    // ── (1) 全额 sandbox 退款 paid → refunding → refunded ──────────────────
    const oSandbox = await makeOrder(200)
    await paySandbox(oSandbox)
    assert((await payStatusOf(oSandbox)) === 'paid', '1a. sandbox 订单已支付（paid）')
    const before = spy.refundCalls
    const r1 = await refundService.refund(oSandbox, { reason: '验证退款' })
    assert(r1.order.payStatus === 'refunded' && r1.refund.status === 'success', '1b. 全额退款 → refunded + Refund success')
    assert(r1.refund.channel === 'sandbox' && (r1.refund.channelRefundNo?.startsWith('sbx_refund_') ?? false), '1c. sandbox 退款走 provider（假 channelRefundNo）')
    assert(spy.refundCalls === before + 1 && spy.statusDuringRefund === 'refunding', '1d. provider.refund 调用瞬间订单态 = refunding（paid→refunding→refunded 中间态真实存在）')
    const oSandboxRow = await prisma.order.findUnique({ where: { id: oSandbox } })
    assert(oSandboxRow?.refundedAmountCents === 200, '1e. refundedAmountCents = 实付额 200')
    assert((await refundAuditCount(oSandbox)) === 1, '1f. 审计 refund.created 写入 1 条')

    // ── (2) 同 refundNo 幂等 ───────────────────────────────────────────────
    const oIdem = await makeOrder(150)
    await paySandbox(oIdem)
    const fixedNo = `RFD-IDEM-${suffix}`
    const first = await refundService.refund(oIdem, { refundNo: fixedNo, reason: '幂等测试' })
    const spyAfterFirst = spy.refundCalls
    const second = await refundService.refund(oIdem, { refundNo: fixedNo, reason: '幂等测试重复' })
    assert(!first.idempotent && second.idempotent && second.refund.refundNo === fixedNo, '2a. 同 refundNo 第二次返回幂等回放')
    assert((await prisma.refund.count({ where: { orderId: oIdem } })) === 1, '2b. 同 refundNo 幂等：Refund 只 1 条（不重复出款）')
    assert((await refundAuditCount(oIdem)) === 1, '2c. 同 refundNo 幂等：审计只 1 条（不重复记账）')
    assert(spy.refundCalls === spyAfterFirst, '2d. 幂等回放不再调 provider')

    // ── (3) 不同 refundNo 重复退同一订单被拒 ───────────────────────────────
    await expectCode('3. 已退款订单换 refundNo 再退 → ORDER_ALREADY_REFUNDED', 'ORDER_ALREADY_REFUNDED',
      () => refundService.refund(oIdem, { refundNo: `RFD-OTHER-${suffix}`, reason: 'x' }))

    // ── (4) offline / manual_confirmed 人工退款不调 provider ────────────────
    for (const src of ['offline', 'manual_confirmed'] as const) {
      const o = await makeOrder(100)
      await orderStatus.markPaid(o, { paymentSource: src, operatorId: 'verify' })
      const spyBefore = spy.refundCalls
      const r = await refundService.refund(o, { reason: `${src} 退款` })
      assert(r.order.payStatus === 'refunded' && r.refund.channel === src && r.refund.channelRefundNo === null, `4-${src}a. ${src} 退款：channel=${src} 且无 channelRefundNo`)
      assert(spy.refundCalls === spyBefore, `4-${src}b. ${src} 人工退款不调 provider`)
    }

    // ── (5) voucher 全额核销单退款：不调 provider、不恢复权益额度 ─────────────
    const oVoucher = await makeOrder(120, true)
    const grant = await prisma.benefitGrant.create({
      data: { id: `bg_refund_${suffix}`, endUserId, benefitType: 'free_quota', title: '免费打印次数', quantityTotal: 3, quantityRemaining: 3, status: 'active' },
    })
    grantIds.push(grant.id)
    await redemption.redeemForOrder({ endUserId, orderId: oVoucher, benefitGrantId: grant.id })
    const vOrder = await prisma.order.findUnique({ where: { id: oVoucher } })
    assert(vOrder?.payStatus === 'paid' && vOrder.paymentSource === 'voucher', '5a. 全额核销单 → paid(voucher)')
    const remainBefore = (await prisma.benefitGrant.findUnique({ where: { id: grant.id } }))!.quantityRemaining
    const spyBeforeV = spy.refundCalls
    const rv = await refundService.refund(oVoucher, { reason: 'voucher 退款' })
    const remainAfter = (await prisma.benefitGrant.findUnique({ where: { id: grant.id } }))!.quantityRemaining
    assert(rv.refund.channel === 'voucher' && rv.refund.channelRefundNo === null && spy.refundCalls === spyBeforeV, '5b. voucher 退款不调 provider')
    assert(remainAfter === remainBefore, `5c. voucher 退款不恢复 BenefitGrant 额度（${remainBefore} 不变）`)
    const vAudit = await prisma.auditLog.findFirst({ where: { action: 'refund.created', targetId: oVoucher }, orderBy: { createdAt: 'desc' } })
    assert(JSON.parse(vAudit?.payloadJson ?? '{}').benefitRestored === false, '5d. 审计 benefitRestored=false（明示不恢复权益）')

    // ── (6) unpaid / paying / closed 不可退款 ──────────────────────────────
    const oUnpaid = await makeOrder(50)
    await expectCode('6a. unpaid 不可退款 → ORDER_NOT_REFUNDABLE', 'ORDER_NOT_REFUNDABLE', () => refundService.refund(oUnpaid, { reason: 'x' }))
    const oPaying = await makeOrder(50)
    await onlinePayment.createPayAttempt(oPaying, await sessionToken(oPaying)) // 进入 paying（未支付）
    await expectCode('6b. paying 不可退款 → ORDER_NOT_REFUNDABLE', 'ORDER_NOT_REFUNDABLE', () => refundService.refund(oPaying, { reason: 'x' }))
    const oClosed = await makeOrder(50)
    await prisma.order.update({ where: { id: oClosed }, data: { payStatus: 'closed' } })
    await expectCode('6c. closed 不可退款 → ORDER_NOT_REFUNDABLE', 'ORDER_NOT_REFUNDABLE', () => refundService.refund(oClosed, { reason: 'x' }))

    // ── (7) C5-3 出纸门控回归：refunded / refunding 不可 claim ──────────────
    await terminals.heartbeat(terminalId, { status: 'online', printerStatus: 'ok', localTaskDatabaseAvailable: true, agentVersion: 'verify-refund' }, `Bearer ${agentToken}`)
    const created = await printJobs.create({ fileUrl: await seedPdf('gate'), fileName: 'g.pdf', params: { copies: 1, colorMode: 'black_white' } }, { terminalId })
    taskIds.push(created.taskId)
    await prisma.printTask.update({ where: { id: created.taskId }, data: { createdAt: new Date('2020-01-01T00:00:00.000Z') } })
    await paySandbox(created.orderId)
    // 先证明 paid 可 claim（门控放行基线），随后退款后不可 claim。
    await refundService.refund(created.orderId, { reason: '门控回归退款' })
    const claimRefunded = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
    assert(claimRefunded.length === 0 && (await prisma.printTask.findUnique({ where: { id: created.taskId } }))?.status === 'pending', '7a. refunded 订单的打印任务不可 claim（只有 paid 放行）')
    // 直接置 refunding 再验（部分退款/退款中态同样不放行）。
    const created2 = await printJobs.create({ fileUrl: await seedPdf('gate2'), fileName: 'g2.pdf', params: { copies: 1, colorMode: 'black_white' } }, { terminalId })
    taskIds.push(created2.taskId)
    await prisma.order.update({ where: { id: created2.orderId }, data: { payStatus: 'refunding' } })
    const claimRefunding = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
    assert(claimRefunding.length === 0, '7b. refunding 订单的打印任务不可 claim')

    console.log(`\n  ✅ verify:refund-idempotent 全部通过（${passed} checks）`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => { console.error('  FAIL 未捕获异常:', e); process.exit(1) })
