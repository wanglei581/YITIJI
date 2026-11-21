import { BadRequestException, Injectable } from '@nestjs/common'
import { assessInvoiceEligibility } from '../invoices/invoice-eligibility'
import {
  pickLatestInvoiceRequestByOrder,
  toInvoiceOpenStatus,
  type MemberInvoiceStatus,
} from '../invoices/invoice-request-summary'
import { PrismaService } from '../prisma/prisma.service'
import { SERVICE_ORDER_NAMES, type ServiceOrderKey } from './service-order.policy'

export const MEMBER_SERVICE_ORDER_STATUSES = [
  'paid',
  'consumed',
  'refunding',
  'refunded',
  'refund_failed',
] as const

export type MemberServiceOrderStatus = (typeof MEMBER_SERVICE_ORDER_STATUSES)[number]

export interface MemberServiceOrderItem {
  id: string
  serviceKey: ServiceOrderKey
  serviceName: string
  status: MemberServiceOrderStatus
  amountCents: number
  paidAt: string | null
  settledAt: string | null
  refundedAt: string | null
  refundReason: string | null
  createdAt: string
  canInvoice: boolean
  invoiceStatus: MemberInvoiceStatus
  invoiceRequestId: string | null
}

export interface MemberServiceOrderPage {
  items: MemberServiceOrderItem[]
  nextCursor: string | null
  total: number
}

export interface ServiceOrderCursorPosition {
  createdAt: Date
  id: string
}

export interface MemberServiceOrdersQuery {
  cursor: ServiceOrderCursorPosition | null
  pageSize: number
}

export const MEMBER_SERVICE_ORDERS_DEFAULT_PAGE_SIZE = 20
export const MEMBER_SERVICE_ORDERS_MAX_PAGE_SIZE = 50

export function encodeServiceOrderCursor(position: ServiceOrderCursorPosition): string {
  return Buffer.from(`${position.createdAt.getTime()}.${position.id}`, 'utf8').toString('base64url')
}

export function decodeServiceOrderCursor(raw: string | undefined): ServiceOrderCursorPosition | null {
  if (raw === undefined || raw === '') return null
  const trimmed = raw.trim()
  const text = /^[A-Za-z0-9_-]{1,200}$/.test(trimmed)
    ? Buffer.from(trimmed, 'base64url').toString('utf8')
    : ''
  const match = /^(\d{1,15})\.([A-Za-z0-9_-]{1,80})$/.exec(text)
  if (!match) {
    throw new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: 'cursor: invalid' },
    })
  }
  const ms = Number(match[1])
  const createdAt = new Date(ms)
  if (!Number.isSafeInteger(ms) || Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: 'cursor: invalid' },
    })
  }
  return { createdAt, id: match[2]! }
}

export function parseMemberServiceOrdersQuery(raw: {
  cursor?: string
  pageSize?: string
}): MemberServiceOrdersQuery {
  let pageSize = MEMBER_SERVICE_ORDERS_DEFAULT_PAGE_SIZE
  if (raw.pageSize !== undefined && raw.pageSize !== '') {
    const trimmed = raw.pageSize.trim()
    if (!/^\d+$/.test(trimmed)) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_FAILED', message: 'pageSize: must be an integer >= 1' },
      })
    }
    const parsed = Number(trimmed)
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_FAILED', message: 'pageSize: must be an integer >= 1' },
      })
    }
    pageSize = Math.min(parsed, MEMBER_SERVICE_ORDERS_MAX_PAGE_SIZE)
  }
  const cursor = decodeServiceOrderCursor(raw.cursor)
  return { cursor, pageSize }
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function serviceNameOf(serviceKey: string): string {
  return SERVICE_ORDER_NAMES[serviceKey as ServiceOrderKey] ?? serviceKey
}

/**
 * 会员侧 AI/扫描服务单只读列表（零 PII）。
 *
 * - 只按已认证 endUserId 过滤，只返回实付 > 0、非支付失败、已付/已消费/退款相关状态的服务单。
 * - 批量关联 InvoiceRequest（只读 id / orderId / status / createdAt，绝不读取税号、邮箱、抬头）。
 * - 统一复用 assessInvoiceEligibility 判定 canInvoice，不另写判据。
 */
@Injectable()
export class MemberServiceOrderService {
  constructor(private readonly prisma: PrismaService) {}

  async list(endUserId: string, query: MemberServiceOrdersQuery): Promise<MemberServiceOrderPage> {
    const baseWhere = {
      endUserId,
      amountCents: { gt: 0 },
      paymentFailed: false,
      status: { in: [...MEMBER_SERVICE_ORDER_STATUSES] },
    }
    const total = await this.prisma.serviceOrder.count({ where: baseWhere })
    const where = query.cursor
      ? {
          AND: [
            baseWhere,
            {
              OR: [
                { createdAt: { lt: query.cursor.createdAt } },
                { createdAt: query.cursor.createdAt, id: { lt: query.cursor.id } },
              ],
            },
          ],
        }
      : baseWhere

    // 显式安全列白名单：不从库里读出 qrCodeContent / prepayId / channelTxnNo / providerOrderNo 等通道字段。
    const rows = await this.prisma.serviceOrder.findMany({
      where,
      select: {
        id: true,
        endUserId: true,
        serviceKey: true,
        status: true,
        amountCents: true,
        paymentFailed: true,
        paidAt: true,
        settledAt: true,
        refundedAt: true,
        refundReason: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.pageSize + 1,
    })

    const hasMore = rows.length > query.pageSize
    const pageRows = hasMore ? rows.slice(0, query.pageSize) : rows
    const orderIds = pageRows.map((row) => row.id)

    const requests = orderIds.length > 0
      ? await this.prisma.invoiceRequest.findMany({
          where: { endUserId, orderKind: 'service', orderId: { in: orderIds } },
          select: { id: true, orderId: true, status: true, createdAt: true },
        })
      : []
    const latestByOrder = pickLatestInvoiceRequestByOrder(requests)

    const items: MemberServiceOrderItem[] = pageRows.map((row) => {
      const picked = latestByOrder.get(row.id)
      const openInvoiceStatus = toInvoiceOpenStatus(picked)
      const decision = assessInvoiceEligibility(
        {
          kind: 'service',
          id: row.id,
          endUserId: row.endUserId,
          status: row.status,
          amountCents: row.amountCents,
          paymentFailed: row.paymentFailed,
          openInvoiceStatus,
        },
        endUserId,
      )
      const invoiceStatus: MemberInvoiceStatus = picked?.status ?? 'none'
      return {
        id: row.id,
        serviceKey: row.serviceKey as ServiceOrderKey,
        serviceName: serviceNameOf(row.serviceKey),
        status: row.status as MemberServiceOrderStatus,
        amountCents: row.amountCents,
        paidAt: iso(row.paidAt),
        settledAt: iso(row.settledAt),
        refundedAt: iso(row.refundedAt),
        refundReason: row.refundReason ?? null,
        createdAt: row.createdAt.toISOString(),
        canInvoice: decision.ok,
        invoiceStatus,
        invoiceRequestId: invoiceStatus === 'none' ? null : (picked?.id ?? null),
      }
    })

    const tail = pageRows[pageRows.length - 1]
    const nextCursor = hasMore && tail
      ? encodeServiceOrderCursor({ createdAt: tail.createdAt, id: tail.id })
      : null

    return { items, nextCursor, total }
  }
}
