import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  assessInvoiceEligibility,
  INVOICE_BLOCK_MESSAGES,
  type InvoiceFacts,
  type InvoiceOpenStatus,
} from './invoice-eligibility'
import { maskEmail, maskInvoiceText, maskTaxId } from './invoice-masking'
import {
  afterPositionWhere,
  clampInvoiceListLimit,
  compareListPosition,
  decodeListCursor,
  encodeListCursor,
  mergeListChunks,
  type ListPosition,
} from './invoice-member-list'
import { normalizeInvoiceTitle } from './invoice-title'

export interface SubmitInvoiceInput {
  orderKind: 'print' | 'service'
  orderId: string
  /** 以下四项是请求体原样，由 normalizeInvoiceTitle 校验并给出专用错误码。 */
  titleType?: unknown
  title?: unknown
  taxId?: unknown
  email?: unknown
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

/** 会员单条视图。税号、邮箱只有打码后的样子（一体机带会员令牌也能调这个接口）。 */
export interface MemberInvoiceRequestView {
  id: string
  orderKind: string
  orderId: string
  titleType: string
  title: string
  taxIdMasked: string | null
  emailMasked: string | null
  amountCents: number
  status: string
  issuedAt: string | null
  invoiceNo: string | null
  returnReason: string | null
  createdAt: string
}

export interface MemberInvoiceOrderPage {
  items: MemberInvoiceOrderView[]
  /** 还有没列出的单时给出，原样带回 cursor 读下一页；为 null 表示读完了。不为 null 时下一页也可能是空的。 */
  nextCursor: string | null
}

interface ListCandidate extends ListPosition {
  facts: InvoiceFacts
}

// 已付过钱的单可能落在的全部状态。有开票申请的单一定付过钱，所以也都在这两组里。
const PRINT_LIST_STATUSES = ['paid', 'refunding', 'partial_refunded', 'refunded']
const SERVICE_LIST_STATUSES = ['paid', 'consumed', 'refunding', 'refund_failed', 'refunded']
const LIST_CHUNK = 60
const LIST_MAX_ROUNDS = 4

function memberOrderView(candidate: ListCandidate, request: { id: string; status: string } | undefined, endUserId: string): MemberInvoiceOrderView | null {
  if (candidate.facts.endUserId !== endUserId) return null
  const openInvoiceStatus: InvoiceOpenStatus = request?.status === 'issued' ? 'issued' : request?.status === 'submitted' ? 'submitted' : null
  const decision = assessInvoiceEligibility({ ...candidate.facts, openInvoiceStatus }, endUserId)
  if (!decision.ok && !request) return null
  const invoiceStatus = request?.status === 'submitted' || request?.status === 'issued' || request?.status === 'returned' ? request.status : 'none'
  return {
    orderKind: candidate.kind,
    orderId: candidate.id,
    amountCents: decision.amountCents,
    canRequest: decision.ok,
    blockCode: decision.code,
    blockMessage: decision.ok ? '' : decision.message,
    invoiceStatus,
    requestId: invoiceStatus === 'none' ? null : request?.id ?? null,
  }
}

const INVOICE_REQUEST_NOT_FOUND = '没有找到这份开票申请。'
const INVOICE_ACCOUNT_UNAVAILABLE = '账号当前不可用，开不了发票。'

function uniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
}

function closedMemberWriteError(error: unknown): boolean {
  const record = error as {
    message?: unknown
    meta?: { driverAdapterError?: { cause?: { originalMessage?: unknown } } }
  } | null
  return (
    String(record?.message ?? '').includes('MEMBER_CLOSED_WRITE_FORBIDDEN')
    || String(record?.meta?.driverAdapterError?.cause?.originalMessage ?? '').includes('MEMBER_CLOSED_WRITE_FORBIDDEN')
  )
}

@Injectable()
export class InvoiceRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 订单自己的事实。不读终端现在绑的机构（改绑后不误判公共点位）。 */
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
        openInvoiceStatus,
      }
    }
    const order = await this.prisma.serviceOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        endUserId: true,
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
      openInvoiceStatus,
    }
  }

  async submit(endUserId: string, input: SubmitInvoiceInput): Promise<StoredInvoiceRequest> {
    const member = await this.prisma.endUser.findUnique({
      where: { id: endUserId },
      select: { status: true, enabled: true },
    })
    if (!member || member.status !== 'active' || !member.enabled) {
      throw new ConflictException({
        error: { code: 'ACCOUNT_UNAVAILABLE', message: INVOICE_ACCOUNT_UNAVAILABLE },
      })
    }
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
      if (closedMemberWriteError(error)) {
        throw new ConflictException({
          error: { code: 'ACCOUNT_UNAVAILABLE', message: INVOICE_ACCOUNT_UNAVAILABLE },
        })
      }
      if (!uniqueConflict(error)) throw error
      throw new ConflictException({
        error: { code: 'INVOICE_ALREADY_REQUESTED', message: INVOICE_BLOCK_MESSAGES.already_requested },
      })
    }
  }

  /**
   * 本人可开票的订单与已有申请的订单，按「创建时间新到旧」分页。
   * 每一轮只批量读两次订单（打印单、服务单各一次）和一次申请，不对每张单逐个查。
   * 实付为 0 的单（含公共点位的免费单）在库里就筛掉；退了款又没申请过的单读出来再筛。
   * 一页凑不满时最多再读几轮；读满几轮还没凑满，就带着翻页标记先返回。
   */
  async listForMember(
    endUserId: string,
    // chunkSize 只给门禁用：把每轮读的行数调小，才能在少量夹具上走到「合并边界」和「多读几轮」两条路。接口不收这个参数。
    options: { limit?: number; cursor?: string; chunkSize?: number } = {},
  ): Promise<MemberInvoiceOrderPage> {
    const limit = clampInvoiceListLimit(options.limit)
    const chunkSize = options.chunkSize && options.chunkSize > 0 ? Math.floor(options.chunkSize) : LIST_CHUNK
    let position = decodeListCursor(options.cursor)
    const items: MemberInvoiceOrderView[] = []
    for (let round = 0; round < LIST_MAX_ROUNDS; round += 1) {
      const chunk = await this.listCandidates(endUserId, position, chunkSize)
      if (chunk.rows.length === 0) return { items, nextCursor: null }
      const requestByOrder = await this.latestRequests(endUserId, chunk.rows)
      for (let index = 0; index < chunk.rows.length; index += 1) {
        const candidate = chunk.rows[index]!
        position = { at: candidate.at, kind: candidate.kind, id: candidate.id }
        const view = memberOrderView(candidate, requestByOrder.get(`${candidate.kind}:${candidate.id}`), endUserId)
        if (view) items.push(view)
        if (items.length === limit) {
          const remaining = index < chunk.rows.length - 1 || chunk.more
          return { items, nextCursor: remaining ? encodeListCursor(position) : null }
        }
      }
      if (!chunk.more) return { items, nextCursor: null }
    }
    return { items, nextCursor: position ? encodeListCursor(position) : null }
  }

  private async listCandidates(endUserId: string, position: ListPosition | null, chunkSize: number) {
    const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }]
    const [prints, services] = await Promise.all([
      this.prisma.order.findMany({
        where: { endUserId, payStatus: { in: PRINT_LIST_STATUSES }, amountCents: { gt: 0 }, ...afterPositionWhere('print', position) },
        select: { id: true, endUserId: true, payStatus: true, amountCents: true, discountCents: true, refundedAmountCents: true, refunds: { select: { status: true } }, createdAt: true },
        orderBy,
        take: chunkSize,
      }),
      this.prisma.serviceOrder.findMany({
        where: { endUserId, status: { in: SERVICE_LIST_STATUSES }, amountCents: { gt: 0 }, ...afterPositionWhere('service', position) },
        select: { id: true, endUserId: true, status: true, amountCents: true, paymentFailed: true, createdAt: true },
        orderBy,
        take: chunkSize,
      }),
    ])
    const printRows: ListCandidate[] = prints.map((order) => ({
      at: order.createdAt, kind: 'print', id: order.id,
      facts: {
        kind: 'print', id: order.id, endUserId: order.endUserId, payStatus: order.payStatus, amountCents: order.amountCents,
        discountCents: order.discountCents, refundedAmountCents: order.refundedAmountCents,
        refundStatuses: order.refunds.map((row) => row.status), openInvoiceStatus: null,
      },
    }))
    const serviceRows: ListCandidate[] = services.map((order) => ({
      at: order.createdAt, kind: 'service', id: order.id,
      facts: {
        kind: 'service', id: order.id, endUserId: order.endUserId, status: order.status, amountCents: order.amountCents,
        paymentFailed: order.paymentFailed, openInvoiceStatus: null,
      },
    }))
    return mergeListChunks(printRows.sort(compareListPosition), serviceRows.sort(compareListPosition), chunkSize)
  }

  /** 这批订单各自最新的一份申请：有未退回的取未退回的，否则取最近退回的。一次批量读。 */
  private async latestRequests(endUserId: string, rows: ListCandidate[]) {
    const requests = await this.prisma.invoiceRequest.findMany({
      where: { endUserId, orderId: { in: rows.map((row) => row.id) } },
      select: { id: true, orderKind: true, orderId: true, status: true, createdAt: true },
    })
    const ordered = [...requests].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    const byOrder = new Map<string, { id: string; status: string }>()
    for (const row of ordered) {
      const key = `${row.orderKind}:${row.orderId}`
      const current = byOrder.get(key)
      if (!current || (current.status === 'returned' && row.status !== 'returned')) byOrder.set(key, { id: row.id, status: row.status })
    }
    return byOrder
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
      taxIdMasked: maskTaxId(row.taxId),
      emailMasked: maskEmail(row.email),
      amountCents: row.amountCents,
      status: row.status,
      issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
      invoiceNo: row.invoiceNo,
      returnReason: maskInvoiceText(row.returnReason),
      createdAt: row.createdAt.toISOString(),
    }
  }
}
