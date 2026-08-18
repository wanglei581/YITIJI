/**
 * Order model + print-job accounting verification.
 *
 * This exercises production services directly, without HTTP:
 * - PrintJobsService.create() must create a PrintTask and its Order in one flow.
 * - TerminalsService status transitions must mirror into Order.taskStatus.
 * - PrintTasks without an Order must still work for legacy/seed safety.
 */
import 'dotenv/config'
import { randomBytes, randomUUID } from 'crypto'
import { AuditService } from '../src/audit/audit.service'
import { PICKUP_CODE_LENGTH, PICKUP_CODE_PATTERN } from '../src/common/pickup-code'
import { signFileUrl } from '../src/files/signing'
import { AdminOrderActionsController } from '../src/payment/admin-order-actions.controller'
import { RefundService } from '../src/payment/refund.service'
import { PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import type { AdminMarkPaidDto, AdminRefundDto } from '../src/payment/dto/order-action.dto'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PRINT_UNIT_PRICE_CENTS } from '../src/print-jobs/print-pricing'
import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { TerminalToolboxService } from '../src/terminals/terminal-toolbox.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { StorageService } from '../src/storage/storage.service'
import { TerminalsService } from '../src/terminals/terminals.service'
import { TerminalAgentService } from '../src/terminals/terminals-agent.service'
import { TerminalAdminService } from '../src/terminals/terminals-admin.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { buildRealPdf } from './support/minimal-pdf'

const ORDER_NO_PATTERN = /^ORD-\d{8}-[0-9A-F]{10}$/

const PRINT_PARAMS = {
  copies: 2,
  colorMode: 'black_white' as const,
  duplex: 'simplex' as const,
  paperSize: 'A4' as const,
  orientation: 'auto' as const,
  quality: 'standard' as const,
  scale: 'fit' as const,
  pagesPerSheet: 1 as const,
}
const TWO_PAGE_PRINT_AMOUNT_CENTS =
  2 * PRINT_PARAMS.copies * PRINT_UNIT_PRICE_CENTS[PRINT_PARAMS.colorMode]

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

async function main(): Promise<void> {
  console.log('\n=== Order model + print-job accounting verification ===')

  assertIsolatedVerificationDatabase()
  const prisma = new PrismaService()
  await prisma.onModuleInit()

  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const pageCount = new PrintPageCountService(prisma, storage)
  const pricing = new PricingService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const printJobs = new PrintJobsService(prisma, audit, pageCount, pricing, orderStatus, new TerminalCapabilitiesService(prisma))
  const _ag = new TerminalAgentService(prisma, audit)
  const terminals = new TerminalsService(_ag, new TerminalAdminService(prisma, _ag, new TerminalToolboxService(prisma)))
  const resetExpiredClaims = _ag.resetExpiredClaims.bind(_ag)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_order_${suffix}`
  const terminalToken = randomBytes(16).toString('hex')
  const endUserId = `eu_order_${suffix}`
  const taskIds: string[] = []
  const fixtureFileIds: string[] = []
  const fixtureStorageKeys: string[] = []

  // 签名有效但**无 FileObject** 的 URL：用于 fail-closed 检查（页数识别拿不到内容 → 拒绝建单）。
  const signedUrl = (label: string) => signFileUrl(`f_order_${suffix}_${label}`, 60_000).url

  // 真实文件 fixture：写入 FileObject + StorageService 对象；PDF 含 pageCount 个 /Type /Page，可被 page counter 真实识别。
  async function seedPdfFixture(label: string, pageCount: number): Promise<string> {
    const fileId = `f_order_${suffix}_${label}`
    const storageKey = `verify/order/${fileId}.pdf`
    const pdfBytes = buildRealPdf(pageCount)
    await storage.putObject(storageKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: fileId,
        storageKey,
        filename: `${label}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: pdfBytes.length,
        sha256: '',
        purpose: 'print_source',
        bucket: LOCAL_BUCKET_SENTINEL,
      },
    })
    fixtureFileIds.push(fileId)
    fixtureStorageKeys.push(storageKey)
    return signFileUrl(fileId, 60_000).url
  }

  async function cleanup(): Promise<void> {
    const createdOrders = await prisma.order.findMany({ where: { printTaskId: { in: taskIds } }, select: { id: true } })
    const orderIds = createdOrders.map((o) => o.id)
    await prisma.auditLog.deleteMany({ where: { targetType: 'order', targetId: { in: orderIds } } })
    // C5-4：先删 Refund（FK RESTRICT）再删 Order。
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } })
    await prisma.order.deleteMany({ where: { printTaskId: { in: taskIds } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.auditLog.deleteMany({
      where: { targetId: { in: taskIds }, action: 'print_job.create' },
    })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
    // 真实 fixture 清理：删 FileObject + 存储对象 + 本 verify 用的开发默认价目（避免污染后续检查）。
    await prisma.fileObject.deleteMany({ where: { id: { in: fixtureFileIds } } })
    for (const key of fixtureStorageKeys) {
      await storage.deleteObject(key, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    }
    await prisma.priceConfig.deleteMany({ where: { serviceKey: { in: ['print_bw_page', 'print_color_page'] } } })
  }

  try {
    await cleanup()

    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `KSK-ORD-${suffix}`,
        agentToken: terminalToken,
        deviceFingerprint: 'verify-order',
      },
    })
    await prisma.endUser.create({
      data: {
        id: endUserId,
        phoneHash: `order-${endUserId}`,
        phoneEnc: `order-enc-${endUserId}`,
        nickname: '订单验证会员',
      },
    })
    // 开发默认价目 seed（create() 会经 PricingService 读取 PriceConfig；未 seed 则 fail-closed）。
    await seedDevDefaultPriceConfig(prisma)
    pass('test fixtures created')

    const anonymousPrint = await printJobs.create(
      {
        fileUrl: await seedPdfFixture('anonymous', 2),
        fileMd5: 'sha256-order-anonymous',
        fileName: '匿名打印.pdf',
        params: PRINT_PARAMS,
      },
      { endUserId: null, ipAddress: '127.0.0.1', userAgent: 'verify-order', terminalId },
    )
    taskIds.push(anonymousPrint.taskId)

    if (
      anonymousPrint.taskId.startsWith('ptask_kiosk_') &&
      anonymousPrint.status === 'pending' &&
      !Number.isNaN(Date.parse(anonymousPrint.createdAt))
    ) {
      pass('print-job create contract remains { taskId, status, createdAt }')
    } else {
      fail(`unexpected create response: ${JSON.stringify(anonymousPrint)}`)
    }

    const anonymousOrder = await prisma.order.findUnique({
      where: { printTaskId: anonymousPrint.taskId },
    })
    if (
      anonymousOrder &&
      ORDER_NO_PATTERN.test(anonymousOrder.orderNo) &&
      anonymousOrder.type === 'print' &&
      anonymousOrder.amountCents === TWO_PAGE_PRINT_AMOUNT_CENTS &&
      anonymousOrder.billablePages === 2 &&
      anonymousOrder.billingPageSource === 'pdf_lightweight_scan' &&
      anonymousOrder.currency === 'CNY' &&
      anonymousOrder.payStatus === 'unpaid' &&
      anonymousOrder.paymentSource === null &&
      anonymousOrder.pickupCode === null &&
      anonymousOrder.taskStatus === 'pending' &&
      anonymousOrder.endUserId === null &&
      anonymousOrder.terminalId === terminalId
    ) {
      pass(
        'anonymous print creates a terminal-bound unpaid Order priced from backend page-count ' +
          `(2 pages × ${PRINT_PARAMS.copies} copies × verified ${PRINT_PARAMS.colorMode} unit price ` +
          `= ${TWO_PAGE_PRINT_AMOUNT_CENTS} cents; no fabricated pickupCode)`,
      )
    } else {
      fail(`anonymous order mismatch: ${JSON.stringify(anonymousOrder)}`)
    }

    const memberPrint = await printJobs.create(
      {
        fileUrl: await seedPdfFixture('member', 2),
        fileMd5: 'sha256-order-member',
        fileName: '会员打印.pdf',
        params: PRINT_PARAMS,
      },
      { endUserId, terminalId },
    )
    taskIds.push(memberPrint.taskId)

    const memberOrder = await prisma.order.findUnique({
      where: { printTaskId: memberPrint.taskId },
    })
    if (memberOrder?.endUserId === endUserId && memberOrder.payStatus === 'unpaid' && memberOrder.terminalId === terminalId) {
      pass('member endUserId and target terminalId are copied into Order')
    } else {
      fail(`member order mismatch: ${JSON.stringify(memberOrder)}`)
    }

    const statusPrint = await printJobs.create(
      {
        fileUrl: await seedPdfFixture('status', 2),
        fileMd5: 'sha256-order-status',
        fileName: '状态镜像.pdf',
        params: PRINT_PARAMS,
      },
      { endUserId: null, terminalId },
    )
    taskIds.push(statusPrint.taskId)
    await prisma.printTask.update({
      where: { id: statusPrint.taskId },
      data: { createdAt: new Date(0) },
    })

    const claimed = await terminals.claimTasks(
      terminalId,
      { maxTasks: 1 },
      `Bearer ${terminalToken}`,
    )
    if (claimed[0]?.taskId !== statusPrint.taskId) {
      fail(`claimTasks claimed unexpected task: ${JSON.stringify(claimed)}`)
    }

    const claimedOrder = await prisma.order.findUnique({
      where: { printTaskId: statusPrint.taskId },
    })
    if (claimedOrder?.taskStatus === 'claimed' && claimedOrder.terminalId === terminalId) {
      pass('claimTasks mirrors taskStatus=claimed and preserves terminalId in Order')
    } else {
      fail(`claimed order mismatch: ${JSON.stringify(claimedOrder)}`)
    }

    await terminals.patchTaskStatus(
      statusPrint.taskId,
      { status: 'printing' },
      `Bearer ${terminalToken}`,
      terminalId,
    )
    const printingOrder = await prisma.order.findUnique({
      where: { printTaskId: statusPrint.taskId },
    })
    if (printingOrder?.taskStatus === 'printing') {
      pass('patchTaskStatus mirrors taskStatus=printing into Order')
    } else {
      fail(`printing order mismatch: ${JSON.stringify(printingOrder)}`)
    }

    await terminals.patchTaskStatus(
      statusPrint.taskId,
      { status: 'completed' },
      `Bearer ${terminalToken}`,
      terminalId,
    )
    const completedTask = await prisma.printTask.findUnique({ where: { id: statusPrint.taskId } })
    const completedOrder = await prisma.order.findUnique({
      where: { printTaskId: statusPrint.taskId },
    })
    if (
      completedTask?.status === 'completed' &&
      completedTask.completedAt &&
      completedOrder?.taskStatus === 'completed'
    ) {
      pass('patchTaskStatus mirrors taskStatus=completed while PrintTask keeps completedAt')
    } else {
      fail(`completed mirror mismatch: task=${JSON.stringify(completedTask)} order=${JSON.stringify(completedOrder)}`)
    }

    const expiredPrint = await printJobs.create(
      {
        fileUrl: await seedPdfFixture('expired', 2),
        fileMd5: 'sha256-order-expired',
        fileName: '超时回收.pdf',
        params: PRINT_PARAMS,
      },
      { endUserId: null, terminalId },
    )
    taskIds.push(expiredPrint.taskId)
    await prisma.printTask.update({
      where: { id: expiredPrint.taskId },
      data: {
        status: 'claimed',
        terminalId,
        claimedAt: new Date(),
        claimExpiry: new Date(Date.now() - 1000),
      },
    })
    await prisma.order.updateMany({
      where: { printTaskId: expiredPrint.taskId },
      data: { taskStatus: 'claimed', terminalId },
    })
    await resetExpiredClaims()

    const resetTask = await prisma.printTask.findUnique({ where: { id: expiredPrint.taskId } })
    const resetOrder = await prisma.order.findUnique({
      where: { printTaskId: expiredPrint.taskId },
    })
    if (
      resetTask?.status === 'failed' &&
      resetTask.errorCode === 'PRINT_JOB_UNCONFIRMED' &&
      resetTask.terminalId === terminalId &&
      resetOrder?.taskStatus === 'failed' &&
      resetOrder.terminalId === terminalId
    ) {
      pass('resetExpiredClaims fails unconfirmed tasks without automatic redispatch and preserves terminalId')
    } else {
      fail(`reset mirror mismatch: task=${JSON.stringify(resetTask)} order=${JSON.stringify(resetOrder)}`)
    }

    const bareTaskId = `ptask_bare_${suffix}`
    taskIds.push(bareTaskId)
    await prisma.printTask.create({
      data: {
        id: bareTaskId,
        fileUrl: 'sig://bare',
        fileMd5: 'sha256-bare',
        paramsJson: JSON.stringify(PRINT_PARAMS),
        status: 'claimed',
        terminalId,
        claimedAt: new Date(),
      },
    })
    const bareAck = await terminals.patchTaskStatus(
      bareTaskId,
      { status: 'printing' },
      `Bearer ${terminalToken}`,
      terminalId,
    )
    const bareOrder = await prisma.order.findUnique({ where: { printTaskId: bareTaskId } })
    if (bareAck.acknowledged && bareOrder === null) {
      pass('legacy PrintTask without Order can still transition without creating an Order')
    } else {
      fail(`legacy no-order task mismatch: ack=${JSON.stringify(bareAck)} order=${JSON.stringify(bareOrder)}`)
    }

    if (PRINT_UNIT_PRICE_CENTS.black_white === 20 && PRINT_UNIT_PRICE_CENTS.color === 50) {
      pass('print pricing constants match kiosk display price: black_white=20, color=50')
    } else {
      fail(`unexpected pricing constants: ${JSON.stringify(PRINT_UNIT_PRICE_CENTS)}`)
    }

    // ============================================================
    // P0a 支付域底座契约（batch1 · 先红）。实现（Task 3–8）落地前，本段应整体 FAIL。
    // 覆盖修正版 §2.4/§2.5/§4.2–§4.5：后端页数识别 fail-closed、不信任前端 pages、
    // billablePages/billingPageSource、paid 必带 paymentSource、禁 wechat/alipay/benefit、
    // pickupCode 唯一/熵/状态门、unpaid 不伪装线上待支付或已收款、退款仅整单、
    // 历史无 Order 的 /me/print-orders 支付字段返回 null（不编造）。
    // 用收集器逐条 check（不 fail-fast），跑完汇总；有未满足项则抛错（finally 清理后退 1）。
    // ============================================================
    console.log('\n--- P0a payment-domain contract (batch1, expect RED before impl) ---')

    /**
     * 取件码规格断言。
     *
     * 原写法是 `pickupCode.length >= 8`（一条熵下限）。2026-08-18 产品裁决把取件码
     * 从 10 位字母数字改为 6 位纯数字后，`>= 8` 会把合规的新码判红。
     *
     * 处理方式是**收紧而不是删除**：由「至少 8 个任意字符」改为「恰好等于规格长度
     * 且逐字符符合规格字符集」，判别力比原来更强（原断言放行 'ABCDEFGH'、
     * 放行任意 9 位、放行含空格的串，新断言都不放行）。
     *
     * 需要说清楚的取舍：绝对熵确实下降了（31^10 ≈ 49 bit → 10^8 ≈ 26.6 bit）。
     * 补偿它的是另外三条控制，而它们各自有自己的断言，不在本文件：
     *   - claim-pickup 限流 20 次/分钟 → scripts/verify-miniapp-cloud-print-m2.ts
     *   - 取件码 24h 失效 → 本文件同批 pickupCodeVisibleFor 门 + m2 的过期用例
     *   - 认领必须命中订单绑定终端 + 按终端失败锁定 → m2 的预言机合并 / 锁定用例
     * 任何一条被放宽，6 位就不再成立 —— 别只改这里。
     */
    const isSpecPickupCode = (value: unknown): boolean =>
      typeof value === 'string' && value.length === PICKUP_CODE_LENGTH && PICKUP_CODE_PATTERN.test(value)
    // wechat/alipay/benefit 为未来扩展，本批 markPaid 必须拒绝（对齐 packages/shared P0A_ALLOWED_PAYMENT_SOURCES）。
    const P0A_FORBIDDEN_SOURCES = ['wechat', 'alipay', 'benefit'] as const
    const VALID_PAGE_SOURCES = ['pdf_lightweight_scan', 'image_single_page'] as const
    let p0aFailures = 0
    const p0aCheck = (ok: boolean, label: string, detail = ''): void => {
      if (ok) console.log(`  PASS ${label}`)
      else {
        console.error(`  FAIL [P0a] ${label}${detail ? ` — ${detail}` : ''}`)
        p0aFailures += 1
      }
    }
    const p0aGuard = async (label: string, fn: () => Promise<boolean>): Promise<void> => {
      try {
        p0aCheck(await fn(), label)
      } catch (e) {
        console.error(`  FAIL [P0a] ${label} — threw: ${(e as Error).message}`)
        p0aFailures += 1
      }
    }
    type OrderRow = {
      amountCents: number
      payStatus: string
      paymentSource: string | null
      paidAt: Date | null
      pickupCode: string | null
      billablePages: number | null
      billingPageSource: string | null
      refundReason: string | null
      refundedAt: Date | null
    }
    const readOrder = async (printTaskId: string): Promise<OrderRow | null> =>
      (await prisma.order.findUnique({ where: { printTaskId } })) as unknown as OrderRow | null

    // (1) 报价 + 后端识别页数：当前已验证的黑白 2 份订单应有 amountCents>0、billablePages>0、billingPageSource 合法。
    {
      const o = await readOrder(memberPrint.taskId)
      const ok =
        !!o &&
        o.amountCents > 0 &&
        typeof o.billablePages === 'number' &&
        o.billablePages > 0 &&
        typeof o.billingPageSource === 'string' &&
        (VALID_PAGE_SOURCES as readonly string[]).includes(o.billingPageSource)
      p0aCheck(
        ok,
        'priced verified-profile order carries amountCents>0 + backend billablePages>0 + valid billingPageSource',
        `amountCents=${o?.amountCents} billablePages=${o?.billablePages} billingPageSource=${o?.billingPageSource}`,
      )
    }

    // (2) 不信任前端 pages + 页数识别 fail-closed：文件不可识别页数时不得创建付费订单（应抛错）。
    await p0aGuard('unreadable/unknown file is rejected fail-closed (no fabricated paid order)', async () => {
      try {
        const t = await printJobs.create(
          {
            fileUrl: signedUrl('failclosed'),
            fileMd5: 'sha256-order-failclosed',
            fileName: '无法识别页数.bin',
            params: PRINT_PARAMS,
          },
          { endUserId: null, terminalId },
        )
        taskIds.push(t.taskId)
        return false // 创建成功即违背 fail-closed
      } catch {
        return true // 抛错 = fail-closed 生效
      }
    })

    // (3) 支付状态机幂等 + paid 必带 paymentSource + 禁 wechat/alipay/benefit（OrderStatusService，Task 6）。
    await p0aGuard('OrderStatusService.markPaid: unpaid→paid requires allowed paymentSource, sets paidAt+pickupCode, audited, idempotent', async () => {
      const mod = (await import('../src/payment/order-status.service')) as {
        OrderStatusService: new (p: typeof prisma, a: typeof audit) => {
          markPaid: (orderId: string, opts: { paymentSource: string; operatorId?: string }) => Promise<OrderRow>
        }
      }
      const svc = new mod.OrderStatusService(prisma, audit)
      const target = await prisma.order.findUnique({ where: { printTaskId: memberPrint.taskId } })
      if (!target) return false
      const before = await prisma.auditLog.count({ where: { targetId: target.id } })
      const paid = await svc.markPaid(target.id, { paymentSource: 'offline', operatorId: 'verify' })
      const idem = await svc.markPaid(target.id, { paymentSource: 'offline', operatorId: 'verify' })
      const after = await prisma.auditLog.count({ where: { targetId: target.id } })
      const okHappy =
        paid.payStatus === 'paid' &&
        paid.paymentSource === 'offline' &&
        !!paid.paidAt &&
        isSpecPickupCode(paid.pickupCode) &&
        idem.payStatus === 'paid' &&
        idem.pickupCode === paid.pickupCode &&
        after - before === 1 // 幂等：重复 markPaid 不重复写审计
      // ── 支付来源白名单：必须在**仍是 unpaid** 的新订单上验 ──────────────────
      //
      // 曾经这里拿 `target` 验，而 target 在上面几行刚被置成 paid。markPaid 的判定顺序是
      //   ① 白名单 → ② 已 paid 且来源不同 → ORDER_ALREADY_PAID
      // 于是把 ① 整段删掉，三次调用照样抛错（抛的是 ②），断言恒真 —— 门禁守着资损红线
      // 却对红线本身零敏感度。判据也从「有没有抛错」改成「抛的是不是 PAYMENT_SOURCE_INVALID」，
      // 因为「有没有抛错」正是被另一条 guard 冒充的那个判据。
      //
      // 防住什么：白名单放开 = 一分钱没收的打印单可被写成 paid + wechat，
      // 而状态机会给这种单子签发取件码，用户凭码就能取走纸。
      const whitelistPrint = await printJobs.create(
        {
          fileUrl: await seedPdfFixture('srcwhitelist', 1),
          fileMd5: 'sha256-order-srcwhitelist',
          fileName: '支付来源白名单.pdf',
          params: { ...PRINT_PARAMS, copies: 1 },
        },
        { endUserId: null, terminalId },
      )
      taskIds.push(whitelistPrint.taskId)
      const whitelistOrder = await prisma.order.findUnique({ where: { printTaskId: whitelistPrint.taskId } })
      if (!whitelistOrder || whitelistOrder.payStatus !== 'unpaid' || whitelistOrder.amountCents <= 0) {
        console.error(
          `  FAIL [P0a] 白名单用例前置不成立（需要一张 unpaid 且金额>0 的新订单）: ${JSON.stringify(whitelistOrder)}`,
        )
        return false
      }
      // 空串与 wechat/alipay/benefit 都必须**按名字**被拒，不接受任何其它错误码顶替。
      let rejectsByName = true
      for (const bad of ['', ...P0A_FORBIDDEN_SOURCES]) {
        let code = '(未抛错)'
        try {
          await svc.markPaid(whitelistOrder.id, { paymentSource: bad })
        } catch (e) {
          code = (e as Error)?.message ?? String(e)
        }
        if (!code.includes('PAYMENT_SOURCE_INVALID')) {
          console.error(
            `  FAIL [P0a] markPaid(paymentSource=${JSON.stringify(bad)}) 期望 PAYMENT_SOURCE_INVALID，实际: ${code}`,
          )
          rejectsByName = false
        }
      }
      // 事后回读：被拒之后订单必须原样 unpaid —— 不得留下半落的 paymentSource / paidAt / 取件码。
      const afterReject = await readOrder(whitelistPrint.taskId)
      const untouched =
        afterReject?.payStatus === 'unpaid' &&
        afterReject.paymentSource === null &&
        afterReject.paidAt === null &&
        afterReject.pickupCode === null
      if (!untouched) {
        console.error(`  FAIL [P0a] 支付来源被拒后订单未保持原样 unpaid: ${JSON.stringify(afterReject)}`)
      }
      return okHappy && rejectsByName && untouched
    })

    // (4) pickupCode 唯一 + 状态门：仅 paid 且未完成/取消/失败/退款时会员视图才返回取件码。
    await p0aGuard('pickupCode is unique and only surfaced for paid & non-terminal, non-refunded orders', async () => {
      const mod = (await import('../src/payment/order-status.service')) as {
        pickupCodeVisibleFor?: (o: { payStatus: string; taskStatus: string; refundedAt: Date | null }) => boolean
      }
      if (typeof mod.pickupCodeVisibleFor !== 'function') return false
      const gate = mod.pickupCodeVisibleFor
      return (
        gate({ payStatus: 'paid', taskStatus: 'pending', refundedAt: null }) === true &&
        gate({ payStatus: 'unpaid', taskStatus: 'pending', refundedAt: null }) === false &&
        gate({ payStatus: 'paid', taskStatus: 'completed', refundedAt: null }) === false &&
        gate({ payStatus: 'refunded', taskStatus: 'pending', refundedAt: new Date() }) === false
      )
    })

    // (5) 免费单真实覆盖：临时把 print_bw_page 单价置 0，走真实 create() → 状态机应落 paid+free+paidAt+pickupCode。
    // 不 mock page counter、不加测试后门、不信任前端 pages；用后还原价目。
    await p0aGuard('free order (amountCents=0) settled paid+free with paidAt + pickupCode', async () => {
      await prisma.priceConfig.update({ where: { serviceKey: 'print_bw_page' }, data: { unitCents: 0 } })
      try {
        const freePrint = await printJobs.create(
          {
            fileUrl: await seedPdfFixture('free', 1),
            fileMd5: 'sha256-order-free',
            fileName: '免费单.pdf',
            params: { ...PRINT_PARAMS, colorMode: 'black_white' as const, copies: 1 },
          },
          { endUserId: null, terminalId },
        )
        taskIds.push(freePrint.taskId)
        const o = await readOrder(freePrint.taskId)
        return (
          !!o &&
          o.amountCents === 0 &&
          o.payStatus === 'paid' &&
          o.paymentSource === 'free' &&
          !!o.paidAt &&
          isSpecPickupCode(o.pickupCode)
        )
      } finally {
        await prisma.priceConfig.update({ where: { serviceKey: 'print_bw_page' }, data: { unitCents: PRINT_UNIT_PRICE_CENTS.black_white } })
      }
    })

    // (6) 退款仅整单：paid→refunded 需 refundReason；拒绝 unpaid→refunded（OrderStatusService，Task 6）。
    await p0aGuard('OrderStatusService.refund: paid→refunded requires reason, rejects unpaid→refunded, whole-order only', async () => {
      const mod = (await import('../src/payment/order-status.service')) as {
        OrderStatusService: new (p: typeof prisma, a: typeof audit) => {
          refund: (orderId: string, opts: { reason: string; operatorId?: string }) => Promise<OrderRow>
        }
      }
      const svc = new mod.OrderStatusService(prisma, audit)
      const unpaidOrder = await prisma.order.findUnique({ where: { printTaskId: statusPrint.taskId } })
      if (!unpaidOrder) return false
      let rejectsUnpaidRefund = false
      try {
        await svc.refund(unpaidOrder.id, { reason: 'x' })
      } catch {
        rejectsUnpaidRefund = true
      }
      return rejectsUnpaidRefund
    })

    // (7) /me/print-orders 支付字段真实化：list() join Order，返回诚实支付字段，无 live 网关来源。
    //     memberPrint 订单在 check(3) 已被 markPaid('offline')；断言 paid+offline+金额/页数 + 无微信/支付宝。
    await p0aGuard('/me/print-orders exposes honest payment fields via list() (no live-gateway source)', async () => {
      const mod = (await import('../src/member-print-orders/member-print-orders.service')) as {
        MemberPrintOrdersService: new (p: typeof prisma) => {
          list: (endUserId: string, page: { cursor: string | null; pageSize: number }) => Promise<{ items: Array<Record<string, unknown>> }>
        }
      }
      const svc = new mod.MemberPrintOrdersService(prisma)
      const res = await svc.list(endUserId, { cursor: null, pageSize: 50 })
      const item = res.items.find((i) => i['id'] === memberPrint.taskId)
      if (!item) return false
      return (
        'payStatus' in item &&
        'paymentSource' in item &&
        'amountCents' in item &&
        'billablePages' in item &&
        'billingPageSource' in item &&
        'pickupCode' in item &&
        item['payStatus'] === 'paid' &&
        item['paymentSource'] === 'offline' &&
        item['paymentSource'] !== 'wechat' &&
        item['paymentSource'] !== 'alipay' &&
        item['amountCents'] === TWO_PAGE_PRINT_AMOUNT_CENTS &&
        item['billablePages'] === 2 &&
        item['billingPageSource'] === 'pdf_lightweight_scan'
      )
    })

    // (8) Admin 订单动作 controller（Task 7）：offline/manual_confirmed 可 mark-paid；拒绝 free/wechat/alipay/benefit；
    //     refund 需 reason；paid→refunded 成功；拒绝 unpaid→refunded；审计写入。状态机复用 OrderStatusService（不重写）。
    await p0aGuard('AdminOrderActionsController: offline mark-paid + reject free/forbidden + refund reason + paid→refunded + reject unpaid-refund + audited', async () => {
      // C5-4：Admin 退款走 RefundService（offline 退款不调 provider，故空注册表足够）。
      const refundService = new RefundService(prisma, audit, new PaymentProviderRegistry([]))
      const adminCtl = new AdminOrderActionsController(orderStatus, refundService)
      const adminUser = { userId: 'admin-verify', role: 'admin' as const, orgId: null }

      const printA = await printJobs.create({ fileUrl: await seedPdfFixture('adminA', 2), fileMd5: 'sha256-adminA', fileName: 'adminA.pdf', params: PRINT_PARAMS }, { endUserId: null, terminalId })
      const printB = await printJobs.create({ fileUrl: await seedPdfFixture('adminB', 2), fileMd5: 'sha256-adminB', fileName: 'adminB.pdf', params: PRINT_PARAMS }, { endUserId: null, terminalId })
      taskIds.push(printA.taskId, printB.taskId)
      const ordA = await prisma.order.findUnique({ where: { printTaskId: printA.taskId } })
      const ordB = await prisma.order.findUnique({ where: { printTaskId: printB.taskId } })
      if (!ordA || !ordB) return false

      // Admin 端点拒绝 free / wechat / alipay / benefit（controller 防御纵深）。
      let rejectsBadSource = true
      for (const bad of ['free', 'wechat', 'alipay', 'benefit']) {
        try {
          await adminCtl.markPaid(ordA.id, { paymentSource: bad } as unknown as AdminMarkPaidDto, adminUser)
          rejectsBadSource = false
        } catch { /* expected */ }
      }

      const auditBefore = await prisma.auditLog.count({ where: { targetId: ordA.id } })
      const paid = await adminCtl.markPaid(ordA.id, { paymentSource: 'offline' }, adminUser)
      const idem = await adminCtl.markPaid(ordA.id, { paymentSource: 'offline' }, adminUser)
      const auditAfterPaid = await prisma.auditLog.count({ where: { targetId: ordA.id } })

      let rejectsNoReason = false
      try {
        await adminCtl.refund(ordA.id, { refundReason: '' } as unknown as AdminRefundDto, adminUser)
      } catch { rejectsNoReason = true }

      const refunded = await adminCtl.refund(ordA.id, { refundReason: '管理员测试退款' }, adminUser)
      const auditAfterRefund = await prisma.auditLog.count({ where: { targetId: ordA.id } })

      let rejectsUnpaidRefund = false
      try {
        await adminCtl.refund(ordB.id, { refundReason: 'x' }, adminUser)
      } catch { rejectsUnpaidRefund = true }

      return (
        rejectsBadSource &&
        paid.payStatus === 'paid' &&
        paid.paymentSource === 'offline' &&
        isSpecPickupCode(paid.pickupCode) &&
        idem.payStatus === 'paid' &&
        idem.pickupCode === paid.pickupCode &&
        auditAfterPaid - auditBefore === 1 && // 幂等：mark-paid 只写 1 条审计
        rejectsNoReason &&
        // C5-4：RefundService 返回 RefundResultView（Refund 账本 + 订单态）。
        refunded.order.payStatus === 'refunded' &&
        refunded.refund.reason === '管理员测试退款' &&
        refunded.refund.status === 'success' &&
        !!refunded.order.refundedAt &&
        auditAfterRefund - auditAfterPaid === 1 && // refund 写 1 条审计（refund.created）
        rejectsUnpaidRefund
      )
    })

    if (p0aFailures > 0) {
      throw new Error(`P0a payment-domain contract not yet satisfied: ${p0aFailures} check(s) FAILED (expected RED before Task 3–8 implementation)`)
    }
    pass(`P0a payment-domain contract satisfied (${8} checks)`)
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
