import { BadRequestException, ConflictException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import type { PrismaService } from '../prisma/prisma.service'
import type { PaymentProviderRegistry } from './payment-provider.factory'
import { executeServiceOrderRefund, type RefundRedis } from './service-order.payment'
import {
  SERVICE_ORDER_NAMES,
  SERVICE_REFUND_REASON_ADMIN,
  SERVICE_REFUND_RETRY_CAP,
  isServiceOrderKey,
} from './service-order.policy'

type OrderRow = NonNullable<Awaited<ReturnType<PrismaService['serviceOrder']['findUnique']>>>
type TerminalBits = { terminalCode: string | null; locationLabel: string | null }

export interface ServiceOrderAdminQuery {
  serviceKey?: string
  status?: string
  search?: string
  page: number
  pageSize: number
}

export interface ServiceOrderAdminDeps {
  prisma: PrismaService
  registry: PaymentProviderRegistry
  audit: AuditService
  redis: RefundRedis | null
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

export async function retryServiceOrderRefund(
  deps: ServiceOrderAdminDeps,
  orderId: string,
  actorId: string | null,
) {
  const row = await deps.prisma.serviceOrder.findUnique({ where: { id: orderId } })
  if (!row || (row.status !== 'refunding' && row.status !== 'refund_failed')) {
    throw new ConflictException({
      error: { code: 'SERVICE_REFUND_NOT_RETRYABLE', message: '这张单现在不在退款中' },
    })
  }
  const result = await executeServiceOrderRefund(
    deps.prisma, deps.registry, deps.audit, deps.redis, row.id,
    row.refundReason ?? '退款重试',
    { manual: true, actorId },
  )
  if (result === 'skipped') {
    const fresh = await deps.prisma.serviceOrder.findUnique({ where: { id: orderId }, select: { refundLeaseUntil: true, refundAttempts: true, status: true } })
    const leased = fresh?.refundLeaseUntil && fresh.refundLeaseUntil.getTime() > Date.now()
    if (leased && fresh.refundAttempts < SERVICE_REFUND_RETRY_CAP + 1) {
      throw new ConflictException({
        error: { code: 'SERVICE_REFUND_IN_PROGRESS', message: '这一笔退款正在处理' },
      })
    }
    throw new ConflictException({
      error: { code: 'SERVICE_REFUND_RETRY_EXHAUSTED', message: '自动退款已试过上限，请人工处理' },
    })
  }
  return getServiceOrderForAdmin(deps.prisma, orderId)
}

/** 卡住的已付、或还没结案的已占用单。二次确认后原路退。做成的单不从这里退。 */
export async function refundServiceOrderByAdmin(
  deps: ServiceOrderAdminDeps,
  orderId: string,
  actorId: string | null,
  confirm: boolean,
) {
  if (confirm !== true) {
    throw new BadRequestException({
      error: { code: 'SERVICE_REFUND_CONFIRM_REQUIRED', message: '请再确认一次原路退款' },
    })
  }
  const row = await deps.prisma.serviceOrder.findUnique({ where: { id: orderId } })
  const stuckConsumed = row?.status === 'consumed' && !row.settledAt
  if (!row || (row.status !== 'paid' && !stuckConsumed)) {
    throw new ConflictException({
      error: { code: 'SERVICE_REFUND_NOT_RETRYABLE', message: '这张单现在不能原路退款' },
    })
  }
  const result = await executeServiceOrderRefund(
    deps.prisma, deps.registry, deps.audit, deps.redis, row.id, SERVICE_REFUND_REASON_ADMIN,
  )
  if (result === 'skipped') {
    throw new ConflictException({
      error: { code: 'SERVICE_REFUND_NOT_RETRYABLE', message: '这张单现在不能原路退款' },
    })
  }
  await deps.audit.write({
    actorId,
    actorRole: actorId ? 'admin' : 'system',
    action: 'service_order.admin_refund',
    targetType: 'service_order',
    targetId: row.id,
    payload: { reason: SERVICE_REFUND_REASON_ADMIN, amountCents: row.amountCents, result },
  })
  return getServiceOrderForAdmin(deps.prisma, orderId)
}

export async function listServiceOrdersForAdmin(prisma: PrismaService, query: ServiceOrderAdminQuery) {
  const where = {
    ...(query.serviceKey && isServiceOrderKey(query.serviceKey) ? { serviceKey: query.serviceKey } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? {
      OR: [
        { id: query.search },
        { providerOrderNo: query.search },
        { terminal: { terminalCode: { contains: query.search } } },
        { terminal: { locationLabel: { contains: query.search } } },
      ],
    } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.serviceOrder.count({ where }),
    prisma.serviceOrder.findMany({
      where,
      include: { terminal: { select: { terminalCode: true, locationLabel: true } } },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ])
  return {
    items: rows.map((row) => toAdminItem(row, row.terminal)),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  }
}

export async function getServiceOrderForAdmin(prisma: PrismaService, orderId: string) {
  const row = await prisma.serviceOrder.findUnique({
    where: { id: orderId },
    include: { terminal: { select: { terminalCode: true, locationLabel: true } } },
  })
  if (!row) return null
  const item = toAdminItem(row, row.terminal)
  return {
    ...item,
    refundedAt: iso(row.refundedAt),
    refundReason: row.refundReason,
    discountCents: 0,
    refundedAmountCents: row.status === 'refunded' ? row.amountCents : 0,
    printTaskId: null,
    print: null,
    statusLogs: [],
  }
}

function toAdminItem(row: OrderRow, terminal: TerminalBits) {
  const serviceKey = isServiceOrderKey(row.serviceKey) ? row.serviceKey : row.serviceKey
  const payStatus = row.status === 'pending' ? 'unpaid' : row.status === 'consumed' ? 'paid' : row.status
  const taskStatus = row.status === 'consumed'
    ? (row.settledAt ? 'completed' : 'in_progress')
    : row.status === 'refunded' || row.status === 'closed'
      ? 'cancelled'
      : row.status === 'refunding' || row.status === 'refund_failed'
        ? 'failed'
        : 'pending'
  const refundAttention = row.status === 'refunding' || row.status === 'refund_failed'
  return {
    id: row.id,
    orderNo: row.providerOrderNo,
    type: serviceKey,
    recordKind: 'service' as const,
    serviceKey,
    serviceName: isServiceOrderKey(serviceKey) ? SERVICE_ORDER_NAMES[serviceKey] : serviceKey,
    serviceStatus: row.status,
    ownerType: row.endUserId ? 'member' as const : 'anonymous' as const,
    userLabel: row.endUserId ? '会员' : '现场用户',
    terminalCode: terminal.terminalCode,
    locationLabel: terminal.locationLabel,
    amountCents: row.amountCents,
    billablePages: null,
    currency: 'CNY',
    channel: 'kiosk',
    pickupStatus: 'none',
    pickupCodeExpiresAt: null,
    payStatus,
    taskStatus,
    printFileName: null,
    copies: null,
    colorMode: null,
    paperSize: null,
    errorCode: null,
    printOutcome: null,
    aftercareStatus: null,
    refundEligible: false,
    retryForbidden: !refundAttention,
    refundRequired: false,
    opsAttention: refundAttention,
    opsAttentionCode: refundAttention ? 'refunding' as const : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    paidAt: iso(row.paidAt),
    refundReason: row.refundReason,
    refundedAt: iso(row.refundedAt),
    refundAttempts: row.refundAttempts,
    failureReason: row.failureReason,
    closeReason: row.closeReason,
  }
}
