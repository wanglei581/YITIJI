import crypto from 'crypto'
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decryptSecret, encryptSecret } from '../common/crypto/secret-cipher'
import { hashPickupCode, randomPickupCode } from '../common/pickup-code'
import { signFileUrl } from '../files/signing'
import { OrderQuoteService } from '../payment/order-quote.service'
import { createPaymentSessionToken } from '../payment/payment-session-token'
import { OrderStatusService } from '../payment/order-status.service'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalCapabilitiesService } from '../terminals/terminal-capabilities.service'
import type { PrintJobParamsDto } from '../print-jobs/dto/create-print-job.dto'
import type { CreatePackageOrderDto } from './dto/create-package-order.dto'
import { assertPiiScanned } from '../print-jobs/pii-scan-gate'
import { buildMemberPage, memberPageArgs, type MemberPageQuery } from '../common/utils/member-page'

const PICKUP_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SIGNED_URL_TTL_MS = 30 * 60 * 1000
const ALLOWED_PURPOSES = new Set(['print_doc', 'resume_upload', 'resume_scan', 'cover_letter'])
const REQUIRED_PII_PURPOSES = new Set(['print_doc', 'resume_upload', 'resume_scan'])

function makeOrderNo(): string {
  const now = new Date()
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  return `ORD-${date}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`
}

function normalizeParams(dto: CreatePackageOrderDto): PrintJobParamsDto {
  return {
    copies: dto.params.copies,
    colorMode: dto.params.colorMode === 'bw' ? 'black_white' : dto.params.colorMode,
    duplex: dto.params.duplex === 'single' ? 'simplex' : dto.params.duplex,
    paperSize: 'A4',
    orientation: 'auto',
    quality: 'standard',
    scale: 'fit',
    pagesPerSheet: 1,
  }
}

@Injectable()
export class PackageOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotes: OrderQuoteService,
    private readonly capabilities: TerminalCapabilitiesService,
    private readonly audit: AuditService,
    private readonly orderStatus: OrderStatusService,
  ) {}

  async create(endUserId: string, dto: CreatePackageOrderDto) {
    const now = new Date()
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: dto.terminalId }, { terminalCode: dto.terminalId }] },
      include: { heartbeats: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    if (!terminal) throw new NotFoundException({ error: { code: 'PRINT_TERMINAL_NOT_FOUND', message: '目标终端不存在' } })
    if (!terminal.enabled || terminal.lifecycleStatus !== 'active') {
      throw new ForbiddenException({ error: { code: 'PRINT_TERMINAL_NOT_ACTIVE', message: '目标终端当前不接收打印订单' } })
    }
    const latest = terminal.heartbeats[0]
    if (!latest || now.getTime() - latest.createdAt.getTime() >= 5 * 60 * 1000 || latest.localTaskDatabaseAvailable === false) {
      throw new BadRequestException({ error: { code: 'PRINT_TERMINAL_OFFLINE', message: '目标终端当前离线，请稍后重试' } })
    }
    await this.capabilities.assertUserTaskAllowed(terminal.id, 'document_print')

    const params = normalizeParams(dto)
    const fileIds = dto.files.map((file) => file.fileId)
    if (new Set(fileIds).size !== fileIds.length) {
      throw new BadRequestException({ error: { code: 'PACKAGE_FILE_DUPLICATED', message: '材料包不能重复选择同一文件' } })
    }
    const files = await this.prisma.fileObject.findMany({
      where: { id: { in: fileIds }, endUserId, deletedAt: null },
      select: { id: true, purpose: true, status: true, expiresAt: true },
    })
    if (files.length !== fileIds.length) throw new NotFoundException({ error: { code: 'PRINT_FILE_NOT_FOUND', message: '材料包中存在不存在或无权访问的文件' } })
    const fileById = new Map(files.map((file) => [file.id, file]))
    const items: Array<{ fileId: string; pageRange?: string; billablePages: number; amountCents: number; billingPageSource: string }> = []
    let expiresAt = new Date(now.getTime() + PICKUP_TTL_MS)
    for (const entry of dto.files) {
      const file = fileById.get(entry.fileId)!
      if (file.status !== 'active' || (file.expiresAt && file.expiresAt <= now)) {
        throw new BadRequestException({ error: { code: 'PRINT_FILE_EXPIRED', message: '材料包中存在已失效文件，请重新选择' } })
      }
      if (!ALLOWED_PURPOSES.has(file.purpose)) {
        throw new BadRequestException({ error: { code: 'PRINT_FILE_PURPOSE_UNSUPPORTED', message: '材料包中存在不支持打印的文件' } })
      }
      if (REQUIRED_PII_PURPOSES.has(file.purpose)) await this.assertPiiReady(file.id)
      if (file.expiresAt && file.expiresAt < expiresAt) expiresAt = file.expiresAt
      const quote = await this.quotes.quote({
        fileUrl: signFileUrl(file.id, SIGNED_URL_TTL_MS).url,
        terminalId: terminal.id,
        params: { ...params, ...(entry.pageRange ? { pageRange: entry.pageRange } : {}) },
      })
      items.push({
        fileId: file.id,
        pageRange: entry.pageRange,
        billablePages: quote.billablePages,
        amountCents: quote.amountCents,
        billingPageSource: quote.billingPageSource,
      })
    }

    const amountCents = items.reduce((total, item) => total + item.amountCents, 0)
    const code = randomPickupCode()
    const order = await this.prisma.order.create({
      data: {
        orderNo: makeOrderNo(),
        type: 'print',
        channel: 'miniapp_cloud',
        endUserId,
        terminalId: terminal.id,
        amountCents,
        billablePages: items.reduce((total, item) => total + item.billablePages, 0),
        billingPageSource: items.every((item) => item.billingPageSource === items[0]?.billingPageSource) ? items[0]?.billingPageSource : 'mixed',
        payStatus: 'unpaid',
        taskStatus: 'pending_release',
        pickupCodeHash: hashPickupCode(code),
        pickupCodeEnc: encryptSecret(code),
        pickupCodeCreatedAt: now,
        pickupCodeExpiresAt: expiresAt,
        pickupStatus: 'pending',
        orderItems: {
          create: items.map((item, seq) => ({
            seq,
            fileId: item.fileId,
            colorMode: params.colorMode,
            duplex: params.duplex,
            copies: params.copies,
            pageRange: item.pageRange,
            billablePages: item.billablePages,
            amountCents: item.amountCents,
          })),
        },
      },
      include: { orderItems: { orderBy: { seq: 'asc' } } },
    })
    if (amountCents === 0) await this.orderStatus.markPaid(order.id, { paymentSource: 'free' })
    const settled = amountCents === 0
      ? await this.prisma.order.findUniqueOrThrow({
          where: { id: order.id },
          include: { orderItems: { orderBy: { seq: 'asc' } } },
        })
      : order
    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'member.package_order.create',
      targetType: 'order',
      targetId: order.id,
      payload: { terminalId: terminal.id, itemCount: order.orderItems.length, amountCents },
    })
    return this.toView(settled, code)
  }

  async detail(endUserId: string, orderId: string) {
    const order = await this.requireOwned(endUserId, orderId)
    return this.toView(order, this.visibleCode(order))
  }

  /**
   * 我的材料包订单列表（本人），游标分页。
   *
   * 为什么必须有这个端点：材料包订单在既有的会员订单列表里**一条都看不到** ——
   * `/me/print-orders` 查的是 PrintTask（材料包派发前 printTaskId 为 null），
   * `/me/print-orders/cloud` 的 where 带 `sourceFileId: { not: null }`（材料包是多文件、
   * 该字段本就为 null），`/me/print-orders/:orderId` 的 requireOwned 同一条过滤。
   * 用户下完单一旦离开，手上只剩一个到机码，而到机码不能反查订单。
   * （2026-09-08 走查实测，见 utils/package-feature.js 开闸前置条件第 d 条。）
   *
   * 与 toView 的两点差异，都是有意的：
   *   1. **不签发 paymentSessionToken**。那是「到机器前要付款」这一步才需要的凭证，
   *      由 detail 现取；列表一次返回 N 个付款令牌只会放大暴露面，没有对应收益。
   *   2. **不返回逐文件明细**（items）。列表只回条目数，明细进详情页拿。
   *
   * 到机码照常返回：找回它正是本端点存在的理由，且判据与 detail 完全一致
   * （visibleCode：pending 且未过期才给），不另开一套口径。
   */
  async list(endUserId: string, page: MemberPageQuery) {
    const where = { endUserId, orderItems: { some: {} } }
    const total = await this.prisma.order.count({ where })
    const rows = await this.prisma.order.findMany({
      where,
      include: { orderItems: { select: { id: true } } },
      ...memberPageArgs(page),
    })
    return buildMemberPage(rows, page, total, (order) => ({
      orderId: order.id,
      orderNo: order.orderNo,
      pickupCode: this.visibleCode(order),
      expiresAt: order.pickupCodeExpiresAt?.toISOString() ?? null,
      pickupStatus: order.pickupStatus,
      payStatus: order.payStatus,
      taskStatus: order.taskStatus,
      amountCents: order.amountCents,
      itemCount: order.orderItems.length,
      createdAt: order.createdAt.toISOString(),
    }))
  }

  private async requireOwned(endUserId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, endUserId, orderItems: { some: {} } },
      include: { orderItems: { orderBy: { seq: 'asc' } } },
    })
    if (!order) throw new NotFoundException({ error: { code: 'PACKAGE_ORDER_NOT_FOUND', message: '材料包订单不存在' } })
    return order
  }

  private async assertPiiReady(fileId: string): Promise<void> {
    await assertPiiScanned({
      prisma: this.prisma,
      fileId,
      requireCompleted: true,
      missingMessage: '请先完成材料包文件的打印隐私检查',
      pendingMessage: '请先完成材料包文件的打印隐私检查',
    })
  }

  /**
   * 到机码在**未支付时也必须可见**：材料包是「手机组包拿码 → 到机器 → 现场付款 → 出纸」，
   * 码就是去机器的凭证。`pickup-order.service.ts:100-101` 明确接受 unpaid / paying 并回一个
   * 支付令牌，`:133` 才在出纸前硬卡 `payStatus !== 'paid'`。因此这里**不**套用单文件路径的
   * `pickupCodeVisibleFor`（那条线是先线上付款后出码，口径本就不同）。
   * （Antigravity 第 17 轮复审阻塞项 1 建议加 payStatus 判断 —— 核实后判定为误报：
   *  照它改会让整条现场付款链走不通。）
   */
  private visibleCode(order: { pickupStatus: string; pickupCodeExpiresAt: Date | null; pickupCodeEnc: string | null }): string | null {
    if (order.pickupStatus !== 'pending' || !order.pickupCodeExpiresAt || order.pickupCodeExpiresAt <= new Date()) return null
    if (!order.pickupCodeEnc) return null
    try { return decryptSecret(order.pickupCodeEnc) } catch { return null }
  }

  private toView(
    order: { id: string; orderNo: string; terminalId: string | null; printTaskId: string | null; pickupCodeExpiresAt: Date | null; pickupStatus: string; payStatus: string; taskStatus: string; amountCents: number; orderItems: Array<{ seq: number; fileId: string; colorMode: string; duplex: string; copies: number; pageRange: string | null; billablePages: number; amountCents: number; status: string; printTaskId: string | null }> },
    pickupCode: string | null,
  ) {
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      pickupCode,
      expiresAt: order.pickupCodeExpiresAt?.toISOString() ?? null,
      pickupStatus: order.pickupStatus,
      payStatus: order.payStatus,
      taskStatus: order.taskStatus,
      amountCents: order.amountCents,
      paymentSessionToken: createPaymentSessionToken({
        orderId: order.id,
        orderNo: order.orderNo,
        terminalId: order.terminalId,
        amountCents: order.amountCents,
        printTaskId: order.printTaskId,
      }),
      items: order.orderItems.map((item) => ({
        seq: item.seq,
        fileId: item.fileId,
        colorMode: item.colorMode,
        duplex: item.duplex,
        copies: item.copies,
        pageRange: item.pageRange,
        billablePages: item.billablePages,
        amountCents: item.amountCents,
        status: item.status,
        printTaskId: item.printTaskId,
      })),
    }
  }
}
