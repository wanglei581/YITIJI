import type { PrismaService } from '../prisma/prisma.service'
import { VIRTUAL_PAY_REFUND_WINDOW_MS } from './virtual-pay.contract'

export interface VirtualPayAdminCreditView {
  id: string
  status: string
  consumedAt: string | null
  consumedServiceOrderId: string | null
  refundedAt: string | null
  createdAt: string
}

export interface VirtualPayAdminOrderView {
  id: string
  outTradeNo: string
  serviceKind: string
  productId: string
  priceCents: number
  env: number
  status: string
  wxOrderId: string | null
  paidAt: string | null
  refundOrderId: string | null
  wxRefundId: string | null
  refundReason: string | null
  refundedAt: string | null
  queryFailCount: number
  lastDiagnosticReason: string | null
  createdAt: string
  hasMember: boolean
  hasOpenId: boolean
  credit: VirtualPayAdminCreditView | null
  refundable: boolean
  refundBlockReason: string | null
}

export interface VirtualPayAdminOrderListQuery {
  status?: string
  serviceKind?: string
  outTradeNo?: string
  page?: number
  pageSize?: number
}

export interface VirtualPayAdminOrderListResponse {
  items: VirtualPayAdminOrderView[]
  total: number
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type OrderWithCredit = NonNullable<
  Awaited<ReturnType<PrismaService['virtualPayOrder']['findUnique']>>
> & {
  credit: Awaited<ReturnType<PrismaService['memberServiceCredit']['findUnique']>>
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export function evaluateVirtualPayRefundEligibility(
  row: {
    status: string
    openId: string | null
    paidAt: Date | null
    credit: { status: string } | null
  },
  now: Date = new Date(),
): { refundable: boolean; refundBlockReason: string | null } {
  if (row.status === 'refunding') return { refundable: false, refundBlockReason: 'refunding' }
  if (row.status === 'refunded') return { refundable: false, refundBlockReason: 'already_refunded' }
  if (row.status !== 'paid') return { refundable: false, refundBlockReason: 'status_not_paid' }
  if (!row.credit) return { refundable: false, refundBlockReason: 'credit_missing' }
  if (row.credit.status === 'consumed') return { refundable: false, refundBlockReason: 'credit_consumed' }
  if (row.credit.status !== 'available') return { refundable: false, refundBlockReason: 'credit_not_available' }
  if (!row.openId) return { refundable: false, refundBlockReason: 'open_id_missing' }
  if (!row.paidAt || now.getTime() - row.paidAt.getTime() > VIRTUAL_PAY_REFUND_WINDOW_MS) {
    return { refundable: false, refundBlockReason: 'window_expired' }
  }
  return { refundable: true, refundBlockReason: null }
}

/** 绝不向后台返回原始 openId。 */
export function toAdminVirtualPayOrderView(
  row: OrderWithCredit,
  now: Date = new Date(),
): VirtualPayAdminOrderView {
  const eligibility = evaluateVirtualPayRefundEligibility(row, now)
  return {
    id: row.id,
    outTradeNo: row.outTradeNo,
    serviceKind: row.serviceKind,
    productId: row.productId,
    priceCents: row.priceCents,
    env: row.env,
    status: row.status,
    wxOrderId: row.wxOrderId,
    paidAt: iso(row.paidAt),
    refundOrderId: row.refundOrderId,
    wxRefundId: row.wxRefundId,
    refundReason: row.refundReason,
    refundedAt: iso(row.refundedAt),
    queryFailCount: row.queryFailCount,
    lastDiagnosticReason: row.lastDiagnosticReason,
    createdAt: row.createdAt.toISOString(),
    hasMember: Boolean(row.endUserId),
    hasOpenId: Boolean(row.openId),
    credit: row.credit
      ? {
          id: row.credit.id,
          status: row.credit.status,
          consumedAt: iso(row.credit.consumedAt),
          consumedServiceOrderId: row.credit.consumedServiceOrderId,
          refundedAt: iso(row.credit.refundedAt),
          createdAt: row.credit.createdAt.toISOString(),
        }
      : null,
    refundable: eligibility.refundable,
    refundBlockReason: eligibility.refundBlockReason,
  }
}

export async function listVirtualPayOrdersForAdmin(
  prisma: PrismaService,
  query: VirtualPayAdminOrderListQuery,
): Promise<VirtualPayAdminOrderListResponse> {
  const page = Math.max(1, Number.isInteger(query.page) ? Number(query.page) : 1)
  const pageSize = Math.min(50, Math.max(1, Number.isInteger(query.pageSize) ? Number(query.pageSize) : 20))
  const status = query.status?.trim()
  const serviceKind = query.serviceKind?.trim()
  const outTradeNo = query.outTradeNo?.trim()
  const where = {
    ...(status ? { status } : {}),
    ...(serviceKind ? { serviceKind } : {}),
    ...(outTradeNo ? { outTradeNo: { contains: outTradeNo } } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.virtualPayOrder.count({ where }),
    prisma.virtualPayOrder.findMany({
      where,
      include: { credit: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  const now = new Date()
  return {
    items: rows.map((row) => toAdminVirtualPayOrderView(row, now)),
    total,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  }
}

export async function getVirtualPayOrderForAdmin(
  prisma: PrismaService,
  id: string,
): Promise<VirtualPayAdminOrderView | null> {
  const row = await prisma.virtualPayOrder.findUnique({
    where: { id },
    include: { credit: true },
  })
  return row ? toAdminVirtualPayOrderView(row) : null
}
