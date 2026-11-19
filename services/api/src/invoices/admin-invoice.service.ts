import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'

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

@Injectable()
export class AdminInvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
    await this.audit.write({
      actorId: null,
      actorRole: 'admin',
      action: 'invoice.return',
      targetType: 'invoice_request',
      targetId: id,
      payload: { operatorId: input.operatorId, orderKind: row.orderKind, orderId: row.orderId, reason },
    })
    return toView(row)
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
