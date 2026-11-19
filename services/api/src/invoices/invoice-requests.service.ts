import { ConflictException, Injectable } from '@nestjs/common'
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

  private async orgType(terminalId: string | null): Promise<string | null> {
    if (!terminalId) return null
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: terminalId },
      select: { org: { select: { type: true } } },
    })
    return terminal?.org?.type ?? null
  }
}
