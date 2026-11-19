import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  assessInvoiceEligibility,
  INVOICE_BLOCK_MESSAGES,
  type InvoiceFacts,
  type InvoiceOpenStatus,
} from './invoice-eligibility'
import { normalizeInvoiceTitle } from './invoice-title'

export interface SubmitInvoiceInput {
  orderKind: 'print' | 'service'
  orderId: string
  titleType?: string
  title?: string
  taxId?: string | null
  email?: string
}

export interface StoredInvoiceRequest {
  id: string
  amountCents: number
}

export interface MemberInvoiceOrderView {
  orderKind: 'print' | 'service'
  orderId: string
  amountCents: number
  canRequest: boolean
  blockCode: string | null
  blockMessage: string
  invoiceStatus: 'none' | 'submitted' | 'issued' | 'returned'
  requestId: string | null
}

export interface MemberInvoiceRequestView {
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
  createdAt: string
}

const PRINT_LIST_STATUSES = ['paid', 'refunding', 'partial_refunded', 'refunded']
const SERVICE_LIST_STATUSES = ['paid', 'consumed', 'refunding', 'refund_failed', 'refunded']

const INVOICE_REQUEST_NOT_FOUND = '没有找到这份开票申请。'

function uniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
}

@Injectable()
export class InvoiceRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async loadFacts(orderKind: 'print' | 'service', orderId: string): Promise<InvoiceFacts | null> {
    const open = await this.prisma.invoiceRequest.findFirst({
      where: { orderKind, orderId, status: { not: 'returned' } },
      select: { status: true },
    })
    const openInvoiceStatus: InvoiceOpenStatus = open?.status === 'issued' ? 'issued' : open ? 'submitted' : null
    if (orderKind === 'print') {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          endUserId: true,
          terminalId: true,
          payStatus: true,
          amountCents: true,
          discountCents: true,
          refundedAmountCents: true,
          refunds: { select: { status: true } },
        },
      })
      if (!order) return null
      return {
        kind: 'print',
        id: order.id,
        endUserId: order.endUserId,
        payStatus: order.payStatus,
        amountCents: order.amountCents,
        discountCents: order.discountCents,
        refundedAmountCents: order.refundedAmountCents,
        refundStatuses: order.refunds.map((row) => row.status),
        orgType: await this.orgType(order.terminalId),
        openInvoiceStatus,
      }
    }
    const order = await this.prisma.serviceOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        endUserId: true,
        terminalId: true,
        status: true,
        amountCents: true,
        paymentFailed: true,
      },
    })
    if (!order) return null
    return {
      kind: 'service',
      id: order.id,
      endUserId: order.endUserId,
      status: order.status,
      amountCents: order.amountCents,
      paymentFailed: order.paymentFailed,
      orgType: await this.orgType(order.terminalId),
      openInvoiceStatus,
    }
  }

  async submit(endUserId: string, input: SubmitInvoiceInput): Promise<StoredInvoiceRequest> {
    const title = normalizeInvoiceTitle(input)
    const facts = await this.loadFacts(input.orderKind, input.orderId)
    if (!facts) {
      throw new ConflictException({
        error: { code: 'INVOICE_NOT_ALLOWED', message: INVOICE_BLOCK_MESSAGES.not_owner },
      })
    }
    const decision = assessInvoiceEligibility(facts, endUserId)
    if (!decision.ok) {
      throw new ConflictException({
        error: { code: 'INVOICE_NOT_ALLOWED', message: decision.message || INVOICE_BLOCK_MESSAGES.not_paid },
      })
    }
    try {
      const row = await this.prisma.invoiceRequest.create({
        data: {
          orderKind: input.orderKind,
          orderId: input.orderId,
          endUserId,
          titleType: title.titleType,
          title: title.title,
          taxId: title.taxId,
          email: title.email,
          amountCents: decision.amountCents,
          status: 'submitted',
        },
        select: { id: true, amountCents: true },
      })
      return row
    } catch (error) {
      if (!uniqueConflict(error)) throw error
      throw new ConflictException({
        error: { code: 'INVOICE_ALREADY_REQUESTED', message: INVOICE_BLOCK_MESSAGES.already_requested },
      })
    }
  }

  async listForMember(endUserId: string): Promise<MemberInvoiceOrderView[]> {
    const [prints, services, requests] = await Promise.all([
      this.prisma.order.findMany({
        where: { endUserId, payStatus: { in: PRINT_LIST_STATUSES } },
        select: { id: true, createdAt: true },
      }),
      this.prisma.serviceOrder.findMany({
        where: { endUserId, status: { in: SERVICE_LIST_STATUSES } },
        select: { id: true, createdAt: true },
      }),
      this.prisma.invoiceRequest.findMany({
        where: { endUserId },
        select: { id: true, orderKind: true, orderId: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ])
    const orderedRequests = [...requests].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    const requestByOrder = new Map<string, { id: string; status: string }>()
    for (const row of orderedRequests) {
      const key = `${row.orderKind}:${row.orderId}`
      const current = requestByOrder.get(key)
      if (!current || (current.status === 'returned' && row.status !== 'returned')) {
        requestByOrder.set(key, { id: row.id, status: row.status })
      }
    }
    const candidates = new Map<string, { orderKind: 'print' | 'service'; orderId: string; createdAt: Date }>()
    for (const row of prints) {
      candidates.set(`print:${row.id}`, { orderKind: 'print', orderId: row.id, createdAt: row.createdAt })
    }
    for (const row of services) {
      candidates.set(`service:${row.id}`, { orderKind: 'service', orderId: row.id, createdAt: row.createdAt })
    }
    for (const row of requests) {
      if (row.orderKind !== 'print' && row.orderKind !== 'service') continue
      const key = `${row.orderKind}:${row.orderId}`
      if (!candidates.has(key)) {
        candidates.set(key, { orderKind: row.orderKind, orderId: row.orderId, createdAt: row.createdAt })
      }
    }
    const views: Array<{ sortAt: number; view: MemberInvoiceOrderView }> = []
    for (const [key, candidate] of candidates) {
      const facts = await this.loadFacts(candidate.orderKind, candidate.orderId)
      if (!facts || facts.endUserId !== endUserId) continue
      const decision = assessInvoiceEligibility(facts, endUserId)
      const request = requestByOrder.get(key)
      if (!decision.ok && !request) continue
      const invoiceStatus = request?.status === 'submitted' || request?.status === 'issued' || request?.status === 'returned'
        ? request.status
        : 'none'
      views.push({
        sortAt: candidate.createdAt.getTime(),
        view: {
          orderKind: candidate.orderKind,
          orderId: candidate.orderId,
          amountCents: decision.amountCents,
          canRequest: decision.ok,
          blockCode: decision.code,
          blockMessage: decision.ok ? '' : decision.message,
          invoiceStatus,
          requestId: invoiceStatus === 'none' ? null : request?.id ?? null,
        },
      })
    }
    views.sort((left, right) => right.sortAt - left.sortAt)
    return views.map((row) => row.view)
  }

  async getForMember(endUserId: string, id: string): Promise<MemberInvoiceRequestView> {
    const row = await this.prisma.invoiceRequest.findFirst({
      where: { id, endUserId },
      select: {
        id: true,
        orderKind: true,
        orderId: true,
        titleType: true,
        title: true,
        taxId: true,
        email: true,
        amountCents: true,
        status: true,
        issuedAt: true,
        invoiceNo: true,
        returnReason: true,
        createdAt: true,
      },
    })
    if (!row) {
      throw new NotFoundException({
        error: { code: 'INVOICE_REQUEST_NOT_FOUND', message: INVOICE_REQUEST_NOT_FOUND },
      })
    }
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
      createdAt: row.createdAt.toISOString(),
    }
  }

  private async orgType(terminalId: string | null): Promise<string | null> {
    if (!terminalId) return null
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { org: { select: { type: true } } },
    })
    return terminal?.org?.type ?? null
  }
}
