import crypto from 'crypto'
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decryptSecret, encryptSecret } from '../common/crypto/secret-cipher'
// 取件码长度/字符集/签发/哈希的唯一定义。曾在本文件和 payment/order-status.service.ts
// 各写一份 PICKUP_CODE_LEN=10，两处不同步即「按一种长度发码、按另一种长度收码」。
import { hashPickupCode, randomPickupCode } from '../common/pickup-code'
import { signFileUrl } from '../files/signing'
import { OrderQuoteService } from '../payment/order-quote.service'
import { OrderStatusService } from '../payment/order-status.service'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalCapabilitiesService } from '../terminals/terminal-capabilities.service'
import type { PrintJobParamsDto } from '../print-jobs/dto/create-print-job.dto'
import type { CancelMemberPrintOrderDto } from './dto/cancel-member-print-order.dto'
import type { CreateMemberPrintOrderDto } from './dto/create-member-print-order.dto'

/**
 * 取件码有效期上限：7 天（产品裁决 2026-08-18 方案 A，原 24 小时）。
 *
 * ⚠️ **这是上限，不是承诺值。** 真正落库的是
 * `min(now + PICKUP_TTL_MS, file.expiresAt)` —— 取件码绝不能活得比源文件久，
 * 否则用户会拿到「码仍有效、文件已被清理」的假承诺。
 *
 * 按当前默认留存（`system_short`，见 `files/file.types.ts` 的 FILE_DEFAULT_TTL_HOURS
 * 与 `file-validation.ts` 的 DEFAULT_SENSITIVE_BY_PURPOSE），本上限对多数订单是空转：
 *
 *   | purpose                      | 敏感级           | 文件 TTL | 取件码实际有效期 |
 *   |------------------------------|------------------|----------|------------------|
 *   | print_doc                    | normal           | 24h      | 24h              |
 *   | cover_letter                 | sensitive        | 6h       | 6h               |
 *   | resume_upload / resume_scan  | highly_sensitive | 1h       | 1h               |
 *
 * 只有用户主动把文件留存延长到 months_3 / months_6 / long_term（需同意条款）时，
 * 7 天才真的生效。
 *
 * **因此界面绝不能按本常量显示倒计时**（CLAUDE.md §9「不伪造能力」）：
 * 所有对外展示都必须用落库的 `Order.pickupCodeExpiresAt`，
 * 它已经是夹取后的真实值。该约束由 `verify-backend-p0-contracts.mjs` 与
 * `verify-miniapp-cloud-print-m2.ts` 两侧断言守住 —— 后者会真的建一个
 * 短留存文件的订单，验证落库过期时间跟的是文件而不是这个常量。
 *
 * 同理：**不要为了「让 7 天生效」去掉下面的 Math.min 夹取**，那只会制造
 * 指向已删除文件的取件码。要延长实际有效期，改的是文件留存策略，不是这里。
 */
const PICKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SIGNED_URL_TTL_MS = 30 * 60 * 1000
const ALLOWED_PURPOSES = new Set(['print_doc', 'resume_upload', 'resume_scan', 'cover_letter'])
const REQUIRED_PII_PURPOSES = new Set(['print_doc', 'resume_upload', 'resume_scan'])

type DuplexMode = 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'
/** 与 shared 的 `DuplexMode` 逐字一致；改这里必须同改 packages/shared/src/types/print.ts。 */
const DUPLEX_MODES: readonly DuplexMode[] = ['simplex', 'duplex_long_edge', 'duplex_short_edge']
type OrderRecord = NonNullable<Awaited<ReturnType<PrismaService['order']['findUnique']>>>
type TerminalSummary = { displayName: string | null; locationLabel: string | null }

function makeOrderNo(): string {
  const now = new Date()
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return `ORD-${date}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`
}

function printParams(dto: CreateMemberPrintOrderDto): PrintJobParamsDto {
  return {
    copies: dto.copies,
    colorMode: dto.colorMode,
    duplex: dto.duplex,
    paperSize: 'A4',
    orientation: 'auto',
    quality: 'standard',
    scale: 'fit',
    pagesPerSheet: 1,
  }
}

@Injectable()
export class MemberPrintOrderCreateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: OrderQuoteService,
    private readonly capabilities: TerminalCapabilitiesService,
    private readonly orderStatus: OrderStatusService,
    private readonly audit: AuditService,
  ) {}

  async create(endUserId: string, dto: CreateMemberPrintOrderDto) {
    const now = new Date()
    const file = await this.prisma.fileObject.findFirst({
      where: { id: dto.fileId, endUserId, deletedAt: null },
      select: {
        id: true,
        filename: true,
        sha256: true,
        purpose: true,
        status: true,
        expiresAt: true,
      },
    })
    if (!file) throw new NotFoundException({ error: { code: 'PRINT_FILE_NOT_FOUND', message: '打印文件不存在或无权访问' } })
    if (file.status !== 'active' || (file.expiresAt && file.expiresAt <= now)) {
      throw new BadRequestException({ error: { code: 'PRINT_FILE_EXPIRED', message: '打印文件已失效，请重新上传' } })
    }
    if (!ALLOWED_PURPOSES.has(file.purpose)) {
      throw new BadRequestException({ error: { code: 'PRINT_FILE_PURPOSE_UNSUPPORTED', message: '该文件类型不能从小程序发起打印' } })
    }
    if (REQUIRED_PII_PURPOSES.has(file.purpose)) await this.assertPiiReady(file.id)

    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: dto.terminalId }, { terminalCode: dto.terminalId }] },
      include: { heartbeats: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    if (!terminal) throw new NotFoundException({ error: { code: 'PRINT_TERMINAL_NOT_FOUND', message: '目标终端不存在' } })
    if (!terminal.enabled || terminal.lifecycleStatus !== 'active') {
      throw new ForbiddenException({ error: { code: 'PRINT_TERMINAL_NOT_ACTIVE', message: '目标终端当前不接收打印订单' } })
    }
    const latest = terminal.heartbeats[0]
    if (!latest || now.getTime() - latest.createdAt.getTime() >= 5 * 60 * 1000) {
      throw new BadRequestException({ error: { code: 'PRINT_TERMINAL_OFFLINE', message: '目标终端当前离线，请稍后重试' } })
    }
    if (latest.localTaskDatabaseAvailable === false) {
      throw new BadRequestException({ error: { code: 'PRINT_TERMINAL_DEGRADED', message: '目标终端暂时不能接收打印订单' } })
    }
    await this.capabilities.assertUserTaskAllowed(terminal.id, 'document_print')

    const params = printParams(dto)
    const signed = signFileUrl(file.id, SIGNED_URL_TTL_MS)
    // 带上 terminalId：彩色/双面报价要按该终端的能力登记判定（fail-closed），
    // 未登记的机器在这里就被拒，不会先按彩色价建单再在出纸时翻车。
    const quote = await this.quotes.quote({ fileUrl: signed.url, params, terminalId: terminal.id })
    const code = randomPickupCode()
    // 到机码绝不能活得比源文件更久；否则用户会拿到“码仍有效、文件已清理”的假承诺。
    const pickupDeadline = now.getTime() + PICKUP_TTL_MS
    const expiresAt = new Date(Math.min(pickupDeadline, file.expiresAt?.getTime() ?? pickupDeadline))
    const order = await this.prisma.order.create({
      data: {
        orderNo: makeOrderNo(),
        type: 'print',
        // channel: 小程序云打印（到店取件）。小程序建单请求体不含该字段——
        // 由服务端硬编，前端零改动（见 M1 任务卡事实 B/D/E）。
        channel: 'miniapp_cloud',
        endUserId,
        terminalId: terminal.id,
        sourceFileId: file.id,
        sourceFileSha256: file.sha256,
        sourceFileName: file.filename,
        printParamsJson: JSON.stringify({ ...params, fileName: file.filename }),
        amountCents: quote.amountCents,
        billablePages: quote.billablePages,
        billingPageSource: quote.billingPageSource,
        itemsJson: JSON.stringify(quote.lines),
        payStatus: 'unpaid',
        taskStatus: 'pending_release',
        pickupCodeHash: hashPickupCode(code),
        pickupCodeEnc: encryptSecret(code),
        pickupCodeCreatedAt: now,
        pickupCodeExpiresAt: expiresAt,
        pickupStatus: 'pending',
      },
    })
    const settled = quote.amountCents === 0
      ? await this.orderStatus.markPaid(order.id, { paymentSource: 'free' })
      : order

    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'member.print_order.create',
      targetType: 'order',
      targetId: order.id,
      payload: { terminalId: terminal.id, fileId: file.id, amountCents: quote.amountCents, billablePages: quote.billablePages },
    })
    return this.toView(settled, code, terminal)
  }

  async listCloud(endUserId: string) {
    await this.expirePendingForUser(endUserId)
    const rows = await this.prisma.order.findMany({
      // 已释放订单由既有 PrintTask 列表展示；这里仅返回尚未产生任务的 Order-only，避免重复。
      where: { endUserId, sourceFileId: { not: null }, printTaskId: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    const terminalIds = [...new Set(rows.map((row) => row.terminalId).filter((id): id is string => Boolean(id)))]
    const terminals = terminalIds.length
      ? await this.prisma.terminal.findMany({
          where: { id: { in: terminalIds } },
          select: { id: true, displayName: true, locationLabel: true },
        })
      : []
    const terminalById = new Map(terminals.map((terminal) => [terminal.id, terminal]))
    return rows.map((row) => this.toView(row, this.visibleCode(row), row.terminalId ? terminalById.get(row.terminalId) : undefined))
  }

  async detail(endUserId: string, orderId: string) {
    const order = await this.requireOwned(endUserId, orderId)
    await this.expireIfNeeded(order)
    const fresh = await this.requireOwned(endUserId, orderId)
    return this.toView(fresh, this.visibleCode(fresh))
  }

  async cancel(endUserId: string, orderId: string, dto: CancelMemberPrintOrderDto) {
    const order = await this.requireOwned(endUserId, orderId)
    const freeOrder = order.amountCents === 0 && order.payStatus === 'paid' && order.paymentSource === 'free'
    if (order.printTaskId || order.pickupStatus !== 'pending' || (order.payStatus !== 'unpaid' && !freeOrder)) {
      throw new BadRequestException({ error: { code: 'PRINT_ORDER_NOT_CANCELLABLE', message: '订单当前状态不能取消' } })
    }
    const updated = await this.prisma.order.updateMany({
      where: {
        id: order.id,
        endUserId,
        pickupStatus: 'pending',
        printTaskId: null,
        ...(freeOrder ? { payStatus: 'paid', paymentSource: 'free', amountCents: 0 } : { payStatus: 'unpaid' }),
      },
      data: {
        pickupStatus: 'cancelled',
        taskStatus: 'cancelled',
        ...(freeOrder ? {} : { payStatus: 'closed' }),
      },
    })
    if (updated.count !== 1) throw new BadRequestException('PRINT_ORDER_NOT_CANCELLABLE')
    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'member.print_order.cancel',
      targetType: 'order',
      targetId: order.id,
      payload: { reason: dto.reason?.trim() || 'member_cancelled' },
    })
    return this.detail(endUserId, order.id)
  }

  private async assertPiiReady(fileId: string): Promise<void> {
    const task = await this.prisma.documentProcessTask.findFirst({
      where: { sourceFileId: fileId, kind: 'pii_scan', status: 'completed' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!task) {
      throw new BadRequestException({ error: { code: 'PRINT_PII_SCAN_REQUIRED', message: '请先完成打印隐私检查' } })
    }
    const pending = await this.prisma.piiFinding.count({ where: { taskId: task.id, action: 'pending' } })
    if (pending > 0) {
      throw new BadRequestException({ error: { code: 'PRINT_PII_DECISIONS_REQUIRED', message: '请先确认隐私检查结果' } })
    }
  }

  private async requireOwned(endUserId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, endUserId, sourceFileId: { not: null } } })
    if (!order) throw new NotFoundException({ error: { code: 'PRINT_ORDER_NOT_FOUND', message: '打印订单不存在' } })
    return order
  }

  private async expireIfNeeded(order: Awaited<ReturnType<MemberPrintOrderCreateService['requireOwned']>>) {
    if (order.pickupStatus !== 'pending' || !order.pickupCodeExpiresAt || order.pickupCodeExpiresAt > new Date()) return
    await this.prisma.order.updateMany({
      where: { id: order.id, pickupStatus: 'pending', printTaskId: null },
      data: { pickupStatus: 'expired', taskStatus: 'expired', payStatus: order.payStatus === 'unpaid' ? 'closed' : order.payStatus },
    })
  }

  private async expirePendingForUser(endUserId: string): Promise<void> {
    const now = new Date()
    await this.prisma.order.updateMany({
      where: {
        endUserId,
        sourceFileId: { not: null },
        pickupStatus: 'pending',
        printTaskId: null,
        pickupCodeExpiresAt: { lte: now },
        payStatus: 'unpaid',
      },
      data: { pickupStatus: 'expired', taskStatus: 'expired', payStatus: 'closed' },
    })
    await this.prisma.order.updateMany({
      where: {
        endUserId,
        sourceFileId: { not: null },
        pickupStatus: 'pending',
        printTaskId: null,
        pickupCodeExpiresAt: { lte: now },
        payStatus: { not: 'unpaid' },
      },
      data: { pickupStatus: 'expired', taskStatus: 'expired' },
    })
  }

  private visibleCode(order: { pickupStatus: string; pickupCodeExpiresAt: Date | null; pickupCodeEnc: string | null }): string | null {
    if (!['pending', 'claimed'].includes(order.pickupStatus)) return null
    if (!order.pickupCodeExpiresAt || order.pickupCodeExpiresAt <= new Date() || !order.pickupCodeEnc) return null
    try { return decryptSecret(order.pickupCodeEnc) } catch { return null }
  }

  private toView(order: OrderRecord, code: string | null, terminal?: TerminalSummary) {
    let lines: unknown[] = []
    try { lines = Array.isArray(JSON.parse(order.itemsJson)) ? JSON.parse(order.itemsJson) : [] } catch { lines = [] }
    let params: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(order.printParamsJson)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params = parsed
    } catch { params = {} }
    return {
      id: order.id,
      orderNo: order.orderNo,
      fileName: order.sourceFileName,
      terminalId: order.terminalId,
      terminalName: terminal?.displayName ?? null,
      locationLabel: terminal?.locationLabel ?? null,
      amountCents: order.amountCents,
      billablePages: order.billablePages,
      copies: typeof params.copies === 'number' ? params.copies : null,
      colorMode: typeof params.colorMode === 'string' ? params.colorMode : null,
      // 与 member-print-orders.service.ts 的 parseSafeParams 同一口径：三值白名单。
      // printParamsJson 由校验过的 DTO（@IsIn 三值）写入，读时仍按不可信 JSON 处理；
      // 缺失 / 非白名单一律 null（= 未记录），绝不回落成 'simplex'。
      duplex: DUPLEX_MODES.includes(params.duplex as DuplexMode) ? (params.duplex as DuplexMode) : null,
      paperSize: typeof params.paperSize === 'string' ? params.paperSize : null,
      priceLines: lines,
      payStatus: order.payStatus,
      taskStatus: order.taskStatus,
      pickupStatus: order.pickupStatus,
      pickupCode: code,
      pickupCodeExpiresAt: order.pickupCodeExpiresAt?.toISOString() ?? null,
      printTaskId: order.printTaskId,
      createdAt: order.createdAt.toISOString(),
    }
  }
}
