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

  private async requireOwned(endUserId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, endUserId, orderItems: { some: {} } },
      include: { orderItems: { orderBy: { seq: 'asc' } } },
    })
    if (!order) throw new NotFoundException({ error: { code: 'PACKAGE_ORDER_NOT_FOUND', message: '材料包订单不存在' } })
    return order
  }

  private async assertPiiReady(fileId: string): Promise<void> {
    const task = await this.prisma.documentProcessTask.findFirst({
      where: { sourceFileId: fileId, kind: 'pii_scan', status: 'completed' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!task || await this.prisma.piiFinding.count({ where: { taskId: task.id, action: 'pending' } }) > 0) {
      throw new BadRequestException({ error: { code: 'PRINT_PII_SCAN_REQUIRED', message: '请先完成材料包文件的打印隐私检查' } })
    }
  }

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
