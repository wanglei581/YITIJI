/**
 * C5-3 Kiosk 收银 / 支付轮询 / paid 后出纸门控 —— service 级守门（verify:kiosk-cashier-ui）。
 *
 * 直接调用生产 service（不起 HTTP server），断言 C5-3 的关键不变量：
 *  1. 建单响应契约（收银衔接）：付费单返回 orderId / orderNo / amountCents>0 / payStatus=unpaid /
 *     priceLines 计费明细 / billablePages / billingPageSource / paymentSessionToken；
 *     免费单 amountCents=0 且 payStatus=paid。
 *  2. **出纸门控（PRINT_REQUIRE_PAID_BEFORE_CLAIM=true）**：付费单未支付时 claim **不下发**、任务保持 pending。
 *  3. 沙箱模拟支付成功 → 订单 paid + pickupCode → 同一任务变为可 claim（出纸放行）。
 *  4. 无关联 Order 的任务（seed/历史/直连）在门控开启下仍可 claim（order:null 放行）。
 *  5. 免费单（amountCents=0，已 paid+free）在门控开启下即可 claim；免费单出码被拒（PAY_NOT_REQUIRED）。
 *  6. 门控**默认关闭**回归：flag 关时未支付单可 claim（与 C5-3 前一致，证明零静默回归）。
 *  7. pay-status 取件码可见性：paid 才回 pickupCode；未支付一律 null。
 *
 * 支付回调只改支付域，绝不改 PrintTask.status（门控只读 payStatus）——本脚本一并回归。
 * 运行：pnpm --filter @ai-job-print/api verify:kiosk-cashier-ui
 */
import 'dotenv/config'
import { randomBytes, randomUUID } from 'crypto'

// terminals.service 模块加载期 requireEnv 这些项；须在动态 import 之前设好（||= 不覆盖外部注入值）。
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-cashier-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-cashier-terminal-action-secret-0123456789'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-cashier-file-signing-secret-0123456789abcd'
// 出纸门控本波显式开启（决策 1：默认关闭，verify/CI/验收显式设 true）。
process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] = 'true'
// 沙箱模拟支付要求非生产环境。
if (process.env['NODE_ENV'] === 'production') {
  console.error('  FAIL verify:kiosk-cashier-ui 不得在 NODE_ENV=production 下运行（沙箱模拟支付被禁用）')
  process.exit(1)
}

import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { AuditService } from '../src/audit/audit.service'
import { signFileUrl } from '../src/files/signing'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { OrderStatusService } from '../src/payment/order-status.service'
import { createPaymentSessionToken } from '../src/payment/payment-session-token'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { SandboxPaymentProvider } from '../src/payment/providers/sandbox-payment.provider'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { StorageService } from '../src/storage/storage.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'

const SANDBOX_SECRET = 'verify-cashier-sandbox-secret-0001'
const OLD_DATE = new Date('2020-01-01T00:00:00.000Z')

let passed = 0
function pass(message: string): void {
  passed += 1
  console.log(`  PASS ${message}`)
}
function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}
function assert(cond: unknown, message: string): void {
  if (cond) pass(message)
  else fail(message)
}
async function expectCode(label: string, code: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    if (msg.includes(code)) return pass(label)
    return fail(`${label} — 期望错误 ${code}，实际: ${msg}`)
  }
  fail(`${label} — 期望错误 ${code}，但未抛`)
}

async function main(): Promise<void> {
  console.log('\n=== C5-3 Kiosk 收银 / 出纸门控 verification ===')

  const { TerminalsService } = await import('../src/terminals/terminals.service')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const pageCount = new PrintPageCountService(prisma, storage)
  const pricing = new PricingService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const printJobs = new PrintJobsService(prisma, audit, pageCount, pricing, orderStatus, new TerminalCapabilitiesService(prisma))
  const provider = new SandboxPaymentProvider(SANDBOX_SECRET)
  const payment = new OnlinePaymentService(prisma, audit, orderStatus, new PaymentProviderRegistry([provider]))
  const terminals = new TerminalsService(prisma) // 不调 onModuleInit（避免 seed + 定时器）

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_cashier_${suffix}`
  const agentToken = randomBytes(16).toString('hex')
  const taskIds: string[] = []
  const fileIds: string[] = []
  const storageKeys: string[] = []
  let seq = 0

  async function seedPdf(label: string, pages: number): Promise<string> {
    seq += 1
    const fileId = `f_cashier_${suffix}_${label}_${seq}`
    const storageKey = `verify/kiosk-cashier/${fileId}.pdf`
    const pdfBytes = Buffer.from(`%PDF-1.4\n${'1 0 obj\n<< /Type /Page >>\nendobj\n'.repeat(pages)}%%EOF\n`)
    await storage.putObject(storageKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: fileId, storageKey, filename: `${label}.pdf`, mimeType: 'application/pdf',
        sizeBytes: pdfBytes.length, sha256: '', purpose: 'print_source', bucket: LOCAL_BUCKET_SENTINEL,
      },
    })
    fileIds.push(fileId)
    storageKeys.push(storageKey)
    return signFileUrl(fileId, 60_000).url
  }

  async function backdate(taskId: string): Promise<void> {
    await prisma.printTask.update({ where: { id: taskId }, data: { createdAt: OLD_DATE } })
  }
  async function heartbeatOnline(): Promise<void> {
    await terminals.heartbeat(
      terminalId,
      { status: 'online', printerStatus: 'ok', localTaskDatabaseAvailable: true, agentVersion: 'verify-cashier' },
      `Bearer ${agentToken}`,
    )
  }
  const claimOne = () => terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)

  async function cleanup(): Promise<void> {
    const orders = await prisma.order.findMany({ where: { OR: [{ printTaskId: { in: taskIds } }, { terminalId }] }, select: { id: true } })
    const orderIds = orders.map((o) => o.id)
    const attempts = await prisma.paymentAttempt.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } })
    await prisma.auditLog.deleteMany({ where: { targetType: 'payment_attempt', targetId: { in: attempts.map((a) => a.id) } } })
    await prisma.auditLog.deleteMany({ where: { targetType: 'order', targetId: { in: orderIds } } })
    await prisma.auditLog.deleteMany({ where: { targetType: 'print_task', targetId: { in: taskIds } } })
    await prisma.paymentAttempt.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } })
    for (const key of storageKeys) await storage.deleteObject(key, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await prisma.priceConfig.deleteMany({ where: { serviceKey: { in: ['print_bw_page', 'print_color_page'] } } })
  }

  try {
    await cleanup()
    await prisma.terminal.create({
      data: { id: terminalId, terminalCode: `KSK-CASH-${suffix}`, agentToken, deviceFingerprint: 'verify-cashier' },
    })
    await seedDevDefaultPriceConfig(prisma) // print_bw_page=20, print_color_page=50
    await heartbeatOnline()
    pass('测试夹具已创建（终端 online + 价目 seed）')

    // ── (1) 建单响应契约（付费单收银衔接）──────────────────────────────────
    const paid = await printJobs.create(
      { fileUrl: await seedPdf('paid', 2), fileMd5: 'sha256-cash-paid', fileName: '付费打印.pdf', params: { copies: 1, colorMode: 'black_white' } },
      { terminalId },
    )
    taskIds.push(paid.taskId)
    assert(typeof paid.orderId === 'string' && paid.orderId.length > 0, '1a. 建单响应含 orderId')
    assert(typeof paid.orderNo === 'string' && paid.orderNo.startsWith('ORD-'), '1b. 建单响应含 orderNo')
    assert(paid.amountCents === 40, `1c. 付费单 amountCents=20×2=40（实际 ${paid.amountCents}）`)
    assert(paid.payStatus === 'unpaid', `1d. 付费单建单 payStatus=unpaid（实际 ${paid.payStatus}）`)
    assert(Array.isArray(paid.priceLines) && paid.priceLines.length >= 1 && paid.priceLines[0].subtotalCents === 40, '1e. 建单响应含计费明细 priceLines')
    assert(paid.billablePages === 2 && typeof paid.billingPageSource === 'string', '1f. 建单响应含后端识别页数与来源')
    assert(typeof paid.paymentSessionToken === 'string' && paid.paymentSessionToken.startsWith('pst_v1.'), '1g. 建单响应含短期 paymentSessionToken')

    // ── (2) 出纸门控开启：未支付单 claim 不下发、任务保持 pending ────────────
    await backdate(paid.taskId)
    const claimUnpaid = await claimOne()
    const paidTaskAfter = await prisma.printTask.findUnique({ where: { id: paid.taskId } })
    assert(claimUnpaid.length === 0, '2a. 门控开启：未支付付费单 claim 不下发任务')
    assert(paidTaskAfter?.status === 'pending', '2b. 未支付任务保持 pending（未被领取出纸）')

    // ── (3) 沙箱模拟支付成功 → paid + pickupCode → 同一任务可 claim ─────────
    await expectCode('3a. 缺失 paymentSessionToken 时拒绝出码', 'PAYMENT_SESSION_REQUIRED', () => payment.createPayAttempt(paid.orderId, ''))
    const wrongPaymentSession = createPaymentSessionToken({
      orderId: paid.orderId,
      orderNo: paid.orderNo,
      terminalId,
      amountCents: paid.amountCents,
      printTaskId: `ptask_wrong_${suffix}`,
    })
    await expectCode('3b. printTaskId 错绑的 paymentSessionToken 被拒绝', 'PAYMENT_SESSION_MISMATCH', () =>
      payment.createPayAttempt(paid.orderId, wrongPaymentSession),
    )
    const attempt = await payment.createPayAttempt(paid.orderId, paid.paymentSessionToken)
    assert(attempt.qrCodeContent?.startsWith('sandboxpay://') ?? false, '3c. 出码返回 sandbox 屏上动态码')
    const orderPaying = await prisma.order.findUnique({ where: { id: paid.orderId } })
    assert(orderPaying?.payStatus === 'paying', '3d. 出码后订单进入 paying')
    await payment.simulateSandboxCallback({ attemptId: attempt.attemptId, result: 'success' })
    const orderPaid = await prisma.order.findUnique({ where: { id: paid.orderId } })
    assert(orderPaid?.payStatus === 'paid' && orderPaid.paymentSource === 'sandbox', '3e. 模拟支付成功 → 订单 paid（paymentSource=sandbox）')
    assert(typeof orderPaid?.pickupCode === 'string' && (orderPaid?.pickupCode?.length ?? 0) > 0, '3f. paid 后生成取件码 pickupCode')
    // 支付回调不改 PrintTask.status（解耦）。
    const paidTaskStillPending = await prisma.printTask.findUnique({ where: { id: paid.taskId } })
    assert(paidTaskStillPending?.status === 'pending', '3g. 支付回调不改 PrintTask.status（仍 pending，未被支付域触碰）')
    const claimPaid = await claimOne()
    assert(claimPaid.length === 1 && claimPaid[0].taskId === paid.taskId, '3h. 支付后同一任务可 claim（出纸放行）')
    const paidTaskClaimed = await prisma.printTask.findUnique({ where: { id: paid.taskId } })
    assert(paidTaskClaimed?.status === 'claimed', '3i. claim 后 PrintTask 变 claimed')

    // ── (4) 无关联 Order 的任务在门控开启下仍可 claim（seed/历史放行）────────
    const legacyTaskId = `ptask_cashier_legacy_${suffix}`
    await prisma.printTask.create({
      data: { id: legacyTaskId, terminalId, fileUrl: 'file://legacy', fileMd5: '', paramsJson: '{}', status: 'pending', createdAt: OLD_DATE },
    })
    taskIds.push(legacyTaskId)
    const claimLegacy = await claimOne()
    assert(claimLegacy.length === 1 && claimLegacy[0].taskId === legacyTaskId, '4. 无 Order 任务（seed/历史）门控开启下仍可 claim')

    // ── (5) 免费单：amountCents=0 + payStatus=paid，门控下可 claim；出码被拒 ──
    await prisma.priceConfig.upsert({
      where: { serviceKey: 'print_color_page' },
      create: { serviceKey: 'print_color_page', unitCents: 0, unit: 'page', active: true, description: 'verify 免费' },
      update: { unitCents: 0, active: true },
    })
    const free = await printJobs.create(
      { fileUrl: await seedPdf('free', 1), fileMd5: 'sha256-cash-free', fileName: '免费打印.pdf', params: { copies: 1, colorMode: 'color' } },
      { terminalId },
    )
    taskIds.push(free.taskId)
    assert(free.amountCents === 0 && free.payStatus === 'paid', `5a. 免费单 amountCents=0 且 payStatus=paid（实际 ${free.amountCents}/${free.payStatus}）`)
    await expectCode('5b. 免费单出码被拒 PAY_NOT_REQUIRED', 'PAY_NOT_REQUIRED', () => payment.createPayAttempt(free.orderId, free.paymentSessionToken))
    await backdate(free.taskId)
    const claimFree = await claimOne()
    assert(claimFree.length === 1 && claimFree[0].taskId === free.taskId, '5c. 免费单（已 paid+free）门控开启下可 claim')

    // ── (6) 门控默认关闭回归：flag 关时未支付单可 claim（零静默回归）──────────
    process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] = 'false'
    const gateOff = await printJobs.create(
      { fileUrl: await seedPdf('gateoff', 1), fileMd5: 'sha256-cash-off', fileName: '门控关闭.pdf', params: { copies: 1, colorMode: 'black_white' } },
      { terminalId },
    )
    taskIds.push(gateOff.taskId)
    assert(gateOff.payStatus === 'unpaid', '6a. 门控关闭用例：建单仍为未支付单')
    await backdate(gateOff.taskId)
    const claimGateOff = await claimOne()
    assert(claimGateOff.length === 1 && claimGateOff[0].taskId === gateOff.taskId, '6b. 门控关闭时未支付单可 claim（与 C5-3 前一致，证明零静默回归）')
    process.env['PRINT_REQUIRE_PAID_BEFORE_CLAIM'] = 'true' // 复位

    // ── (7) pay-status 取件码可见性 ────────────────────────────────────────
    await expectCode('7a. 缺失 paymentSessionToken 时拒绝查支付状态', 'PAYMENT_SESSION_REQUIRED', () => payment.getPayStatus(paid.orderId, ''))
    const paidStatus = await payment.getPayStatus(paid.orderId, paid.paymentSessionToken)
    assert(paidStatus.payStatus === 'paid' && typeof paidStatus.pickupCode === 'string' && (paidStatus.pickupCode?.length ?? 0) > 0, '7b. paid 订单 pay-status 返回 pickupCode')
    const unpaid = await printJobs.create(
      { fileUrl: await seedPdf('unpaid', 1), fileMd5: 'sha256-cash-unpaid', fileName: '未支付.pdf', params: { copies: 1, colorMode: 'black_white' } },
      { terminalId },
    )
    taskIds.push(unpaid.taskId)
    const unpaidStatus = await payment.getPayStatus(unpaid.orderId, unpaid.paymentSessionToken)
    assert(unpaidStatus.pickupCode === null && unpaidStatus.payStatus === 'unpaid', '7c. 未支付订单 pay-status 不返回 pickupCode')

    console.log(`\n  ✅ verify:kiosk-cashier-ui 全部通过（${passed} checks）`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy?.()
  }
}

main().catch((e) => {
  console.error('  FAIL 未捕获异常:', e)
  process.exit(1)
})
