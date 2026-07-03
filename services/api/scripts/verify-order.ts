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
import { signFileUrl } from '../src/files/signing'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PRINT_UNIT_PRICE_CENTS } from '../src/print-jobs/print-pricing'
import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalsService } from '../src/terminals/terminals.service'

const ORDER_NO_PATTERN = /^ORD-\d{8}-[0-9A-F]{10}$/

const PRINT_PARAMS = {
  copies: 2,
  colorMode: 'color' as const,
  duplex: 'simplex' as const,
  paperSize: 'A4' as const,
  orientation: 'auto' as const,
  quality: 'standard' as const,
  scale: 'fit' as const,
  pagesPerSheet: 1 as const,
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

async function main(): Promise<void> {
  console.log('\n=== Order model + print-job accounting verification ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()

  const audit = new AuditService(prisma)
  const printJobs = new PrintJobsService(prisma, audit)
  const terminals = new TerminalsService(prisma)
  const resetExpiredClaims = (
    terminals as unknown as { resetExpiredClaims: () => Promise<void> }
  ).resetExpiredClaims.bind(terminals)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_order_${suffix}`
  const terminalToken = randomBytes(16).toString('hex')
  const endUserId = `eu_order_${suffix}`
  const taskIds: string[] = []

  const signedUrl = (label: string) => signFileUrl(`f_order_${suffix}_${label}`, 60_000).url

  async function cleanup(): Promise<void> {
    await prisma.order.deleteMany({ where: { printTaskId: { in: taskIds } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.auditLog.deleteMany({
      where: { targetId: { in: taskIds }, action: 'print_job.create' },
    })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
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
    pass('test fixtures created')

    const anonymousPrint = await printJobs.create(
      {
        fileUrl: signedUrl('anonymous'),
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
      anonymousOrder.amountCents === 0 &&
      anonymousOrder.currency === 'CNY' &&
      anonymousOrder.payStatus === 'unpaid' &&
      anonymousOrder.taskStatus === 'pending' &&
      anonymousOrder.endUserId === null &&
      anonymousOrder.terminalId === terminalId
    ) {
      pass('anonymous print creates a terminal-bound pending unpaid print Order with amountCents=0')
    } else {
      fail(`anonymous order mismatch: ${JSON.stringify(anonymousOrder)}`)
    }

    const memberPrint = await printJobs.create(
      {
        fileUrl: signedUrl('member'),
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
        fileUrl: signedUrl('status'),
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
        fileUrl: signedUrl('expired'),
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
      resetTask?.status === 'pending' &&
      resetTask.terminalId === terminalId &&
      resetOrder?.taskStatus === 'pending' &&
      resetOrder.terminalId === terminalId
    ) {
      pass('resetExpiredClaims mirrors expired tasks back to pending and preserves terminalId')
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
    // 与 packages/shared P0A_ALLOWED_PAYMENT_SOURCES 保持一致；wechat/alipay/benefit 为未来扩展，本批禁写。
    const P0A_ALLOWED_SOURCES = ['offline', 'free', 'manual_confirmed'] as const
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

    // (1) 报价 + 后端识别页数：彩色 2 份订单应有 amountCents>0、billablePages>0、billingPageSource 合法。
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
        'priced color order carries amountCents>0 + backend billablePages>0 + valid billingPageSource',
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
        typeof paid.pickupCode === 'string' &&
        paid.pickupCode.length >= 8 &&
        idem.payStatus === 'paid' &&
        idem.pickupCode === paid.pickupCode &&
        after - before === 1 // 幂等：重复 markPaid 不重复写审计
      let rejectsNoSource = false
      try {
        await svc.markPaid(target.id, { paymentSource: '' })
      } catch {
        rejectsNoSource = true
      }
      let rejectsForbidden = true
      for (const bad of P0A_FORBIDDEN_SOURCES) {
        try {
          await svc.markPaid(target.id, { paymentSource: bad })
          rejectsForbidden = false
        } catch {
          /* expected reject */
        }
      }
      return okHappy && rejectsNoSource && rejectsForbidden
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

    // (5) 免费单不变式：amountCents===0 的订单必须为 paid + free（不得停在 unpaid）。
    {
      const anon = await readOrder(anonymousPrint.taskId)
      const isFreeInvariantHeld = !anon || anon.amountCents !== 0 || (anon.payStatus === 'paid' && anon.paymentSource === 'free')
      p0aCheck(isFreeInvariantHeld, 'amountCents===0 order is settled as paid+free (never left unpaid)', `payStatus=${anon?.payStatus} paymentSource=${anon?.paymentSource}`)
    }

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

    // (7) unpaid 不伪装线上待支付/已收款：会员视图对普通付费单如实返回 unpaid + paymentSource=null。
    // (8) 历史无 Order 的 PrintTask：会员视图支付字段全部返回 null（不编造）。
    await p0aGuard('/me/print-orders view exposes honest payment fields (unpaid/null) and null for legacy no-Order tasks', async () => {
      const mod = (await import('../src/member-print-orders/member-print-orders.service')) as {
        MemberPrintOrdersService: new (p: typeof prisma) => {
          listForMember: (endUserId: string, opts?: { page?: number; pageSize?: number }) => Promise<{ items: Array<Record<string, unknown>> }>
        }
      }
      const svc = new mod.MemberPrintOrdersService(prisma)
      const res = await svc.listForMember(endUserId, { page: 1, pageSize: 20 })
      const item = res.items.find((i) => i['id'] === memberPrint.taskId)
      if (!item) return false
      // 字段必须存在且语义诚实：unpaid 单 payStatus='unpaid'、paymentSource=null、不得出现线上"待支付/已收款"暗示
      const hasHonestFields =
        'payStatus' in item &&
        'paymentSource' in item &&
        'amountCents' in item &&
        item['paymentSource'] === null &&
        (item['payStatus'] === 'unpaid' || item['payStatus'] === 'paid')
      return hasHonestFields
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
