import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { assessInvoiceEligibility, INVOICE_BLOCK_MESSAGES } from './invoice-eligibility'
import { InvoiceRequestsService } from './invoice-requests.service'

export interface AdminInvoiceView {
  id: string
  orderKind: string
  orderId: string
  titleType: string
  title: string
  taxId: string | null
  email: string | null
  amountCents: number
  status: string
  issuedAt: string | null
  invoiceNo: string | null
  returnReason: string | null
}

interface InvoiceRow {
  id: string
  orderKind: string
  orderId: string
  endUserId: string
  titleType: string
  title: string
  taxId: string | null
  email: string | null
  amountCents: number
  status: string
  issuedAt: Date | null
  invoiceNo: string | null
  returnReason: string | null
  operatorId: string | null
  createdAt: Date
}

const NOT_FOUND = '这张订单没有开票申请。'
const MARK_BLOCKED = '只有已提交的申请可以标已开。'
const RETURN_BLOCKED = '只有已提交的申请可以退回。'
const REASON_REQUIRED = '退回原因要填写。'
const GO_RETURN = '请点「退回」，写明原因。'

@Injectable()
export class AdminInvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly requests: InvoiceRequestsService,
  ) {}

  async getByOrder(orderKind: 'print' | 'service', orderId: string): Promise<AdminInvoiceView> {
    const rows = await this.prisma.invoiceRequest.findMany({
      where: { orderKind, orderId },
      orderBy: { createdAt: 'desc' },
    })
    const ordered = [...rows].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    const row = ordered.find((item) => item.status !== 'returned') ?? ordered[0]
    if (!row) throw new NotFoundException({ error: { code: 'INVOICE_NOT_FOUND', message: NOT_FOUND } })
    return toView(row)
  }

  async markIssued(id: string, input: { invoiceNo?: string | null; operatorId: string }): Promise<AdminInvoiceView> {
    const invoiceNo = input.invoiceNo?.trim() || null
    if (invoiceNo && invoiceNo.length > 40) {
      throw new BadRequestException({ error: { code: 'INVOICE_NO_INVALID', message: '发票号码请控制在 40 个字以内。' } })
    }
    await this.assertStillIssuable(id)
    const updated = await this.prisma.invoiceRequest.updateMany({
      where: { id, status: 'submitted' },
      data: { status: 'issued', issuedAt: new Date(), invoiceNo, operatorId: input.operatorId, returnReason: null },
    })
    if (updated.count !== 1) {
      throw new ConflictException({ error: { code: 'INVOICE_NOT_SUBMITTED', message: MARK_BLOCKED } })
    }
    const row = await this.load(id)
    await this.audit.write({
      actorId: null,
      actorRole: 'admin',
      action: 'invoice.mark_issued',
      targetType: 'invoice_request',
      targetId: id,
      payload: { operatorId: input.operatorId, orderKind: row.orderKind, orderId: row.orderId, invoiceNo },
    })
    return toView(row)
  }

  async returnRequest(id: string, input: { reason?: string | null; operatorId: string }): Promise<AdminInvoiceView> {
    const reason = input.reason?.trim() ?? ''
    if (!reason) {
      throw new BadRequestException({ error: { code: 'INVOICE_RETURN_REASON_REQUIRED', message: REASON_REQUIRED } })
    }
    if (reason.length > 200) {
      throw new BadRequestException({ error: { code: 'INVOICE_RETURN_REASON_INVALID', message: '退回原因请控制在 200 个字以内。' } })
    }
    const updated = await this.prisma.invoiceRequest.updateMany({
      where: { id, status: 'submitted' },
      data: { status: 'returned', returnReason: reason, operatorId: input.operatorId, invoiceNo: null, issuedAt: null },
    })
    if (updated.count !== 1) {
      throw new ConflictException({ error: { code: 'INVOICE_NOT_SUBMITTED', message: RETURN_BLOCKED } })
    }
    const row = await this.load(id)
    // 原因是管理员手写，可能写到姓名、邮箱。审计不改写、注销也不碰审计，所以这里只留长度和去处，原文只在申请行上。
    await this.audit.write({
      actorId: null,
      actorRole: 'admin',
      action: 'invoice.return',
      targetType: 'invoice_request',
      targetId: id,
      payload: { operatorId: input.operatorId, orderKind: row.orderKind, orderId: row.orderId, reasonLength: reason.length, reasonNote: '原因见申请' },
    })
    return toView(row)
  }

  /**
   * 标已开前用提交时同一套判断复核订单：申请提交后订单可能已退款或正在退款。
   * 这一份申请本身就是未退回的申请，复核时不把它算成「已提交过」。
   */
  private async assertStillIssuable(id: string): Promise<void> {
    const row = await this.load(id)
    if (row.status !== 'submitted') {
      throw new ConflictException({ error: { code: 'INVOICE_NOT_SUBMITTED', message: MARK_BLOCKED } })
    }
    const kind = row.orderKind === 'print' || row.orderKind === 'service' ? row.orderKind : null
    const facts = kind ? await this.requests.loadFacts(kind, row.orderId) : null
    const decision = facts ? assessInvoiceEligibility({ ...facts, openInvoiceStatus: null }, row.endUserId) : null
    if (!decision?.ok) {
      const reason = decision?.message || INVOICE_BLOCK_MESSAGES.not_owner
      throw new ConflictException({ error: { code: 'INVOICE_ORDER_NOT_ISSUABLE', message: `${reason}${GO_RETURN}` } })
    }
  }

  private async load(id: string): Promise<InvoiceRow> {
    const rows = await this.prisma.invoiceRequest.findMany({ where: { id } })
    const row = rows[0]
    if (!row) throw new NotFoundException({ error: { code: 'INVOICE_NOT_FOUND', message: NOT_FOUND } })
    return row
  }
}

function toView(row: InvoiceRow): AdminInvoiceView {
  return {
    id: row.id,
    orderKind: row.orderKind,
    orderId: row.orderId,
    titleType: row.titleType,
    title: row.title,
    taxId: row.taxId,
    email: row.email,
    amountCents: row.amountCents,
    status: row.status,
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
    invoiceNo: row.invoiceNo,
    returnReason: row.returnReason,
  }
}
