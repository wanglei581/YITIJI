import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { RedisService } from '../common/redis/redis.service'
import { getEffectiveUserPrices } from './effective-user-prices'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalSessionService } from '../terminals/terminal-session.service'
import { PAYMENT_PROVIDER_TOKEN, type PaymentProviderRegistry } from './payment-provider.factory'
import {
  chargingProvider,
  executeServiceOrderRefund,
  newProviderOrderNo,
} from './service-order.payment'
import {
  SERVICE_ORDER_NAMES,
  SERVICE_PAY_TTL_MS,
  SERVICE_REFUND_REASON_LEFT,
  SERVICE_REFUND_REASON_RETRY_EXPIRED,
  SERVICE_REFUND_REASON_USER_CANCELLED,
  SERVICE_REFUND_RETRY_CAP,
  SERVICE_RETRY_WINDOW_MS,
  classifyServiceOutcome,
  failureReasonFor,
  isServiceOrderKey,
  type ServiceOrderKey,
  type ServiceTripEvent,
} from './service-order.policy'

type Headers = Record<string, string | string[] | undefined> | undefined
type OrderRow = NonNullable<Awaited<ReturnType<PrismaService['serviceOrder']['findUnique']>>>

export interface ServiceOrderView {
  id: string
  serviceKey: string
  serviceName: string
  status: string
  amountCents: number
  expiresAt: string
  qrCodeContent: string | null
  paidAt: string | null
  refundReason: string | null
  refundedAt: string | null
  failureReason: string | null
  retryUntil: string | null
  attemptsUsed: number
  closeReason: string | null
  paymentFailed: boolean
  checking: boolean
  consumedAt: string | null
  provider: string
}

export interface TripHold {
  required: boolean
  orderId: string | null
  skipDailyQuota: boolean
  consume(consumedRef: string): Promise<void>
  noteMade(): Promise<void>
  noteNotMade(event: ServiceTripEvent): Promise<void>
  attachRef(consumedRef: string): Promise<void>
}

export interface ServiceOrderAdminQuery {
  serviceKey?: string
  status?: string
  search?: string
  page: number
  pageSize: number
}

function headerOf(headers: Headers, name: string): string | null {
  const raw = headers?.[name]
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  if (Array.isArray(raw) && raw[0]?.trim()) return raw[0].trim()
  return null
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function freeHold(): TripHold {
  return {
    required: false,
    orderId: null,
    skipDailyQuota: false,
    async consume() {},
    async noteMade() {},
    async noteNotMade() {},
    async attachRef() {},
  }
}

function paymentRequired(amountCents: number, serviceKey: ServiceOrderKey): HttpException {
  return new HttpException({
    error: {
      code: 'SERVICE_PAYMENT_REQUIRED',
      message: '这一次要先付款',
      amountCents,
      serviceKey,
      serviceName: SERVICE_ORDER_NAMES[serviceKey],
    },
  }, HttpStatus.PAYMENT_REQUIRED)
}

@Injectable()
export class ServiceOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: TerminalSessionService,
    @Inject(PAYMENT_PROVIDER_TOKEN) private readonly registry: PaymentProviderRegistry,
    @Optional() private readonly redis?: RedisService,
  ) {}

  async create(terminalId: string, input: { serviceKey: ServiceOrderKey; kioskSessionId: string; endUserId?: string }): Promise<ServiceOrderView> {
    const prices = await getEffectiveUserPrices(this.prisma, terminalId)
    const amountCents = prices.prices[input.serviceKey].effectiveCents
    if (amountCents <= 0) {
      throw new ConflictException({
        error: { code: 'SERVICE_FREE_ON_THIS_TERMINAL', message: '这台机器这一项不向个人收费' },
      })
    }
    await this.requireOpenSession(terminalId, input.kioskSessionId)
    const provider = chargingProvider(this.registry)
    const expiresAt = new Date(Date.now() + SERVICE_PAY_TTL_MS)
    const row = await this.prisma.serviceOrder.create({
      data: {
        terminalId,
        serviceKey: input.serviceKey,
        amountCents,
        status: 'pending',
        kioskSessionId: input.kioskSessionId,
        endUserId: input.endUserId?.trim() || null,
        provider: provider.channel,
        providerOrderNo: newProviderOrderNo(),
        expiresAt,
      },
    })
    try {
      const qr = await provider.createQrPayment({
        orderId: row.id,
        orderNo: row.providerOrderNo,
        attemptId: row.providerOrderNo,
        amountCents,
        expiresAt,
      })
      const saved = await this.prisma.serviceOrder.update({
        where: { id: row.id },
        data: { qrCodeContent: qr.qrCodeContent, prepayId: qr.prepayId },
      })
      return this.toView(saved, false)
    } catch {
      await this.prisma.serviceOrder.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'closed', closeReason: 'qr_failed' },
      })
      throw new BadRequestException({
        error: { code: 'SERVICE_QR_UNAVAILABLE', message: '这一次暂时出不了付款码' },
      })
    }
  }

  async getForSession(terminalId: string, orderId: string, kioskSessionId: string, refresh: boolean): Promise<ServiceOrderView> {
    const row = await this.owned(terminalId, orderId, kioskSessionId)
    let checking = false
    if (refresh && row.status === 'pending' && row.expiresAt.getTime() > Date.now()) {
      checking = true
      const provider = this.registry.get(row.provider)
      if (provider?.queryPayment) {
        try {
          const found = await provider.queryPayment({ attemptId: row.providerOrderNo, orderId: row.id })
          if (found.status === 'paid' && found.channelTxnNo && found.amountCents === row.amountCents) {
            const marked = await this.prisma.serviceOrder.updateMany({
              where: { id: row.id, status: 'pending' },
              data: { status: 'paid', paidAt: new Date(), channelTxnNo: found.channelTxnNo, paymentFailed: false },
            })
            if (marked.count === 1) await this.auditPaid(row)
            checking = false
          } else if (found.status === 'failed') {
            await this.prisma.serviceOrder.updateMany({
              where: { id: row.id, status: 'pending' },
              data: { paymentFailed: true },
            })
            checking = false
          }
        } catch {
          checking = true
        }
      }
    }
    const fresh = await this.prisma.serviceOrder.findUnique({ where: { id: row.id } })
    return this.toView(fresh ?? row, checking && (fresh ?? row).status === 'pending')
  }

  async close(terminalId: string, orderId: string, kioskSessionId: string): Promise<ServiceOrderView> {
    const row = await this.owned(terminalId, orderId, kioskSessionId)
    if (row.status === 'pending') {
      await this.prisma.serviceOrder.updateMany({
        where: { id: row.id, status: 'pending' },
        data: { status: 'closed', closeReason: 'user_cancelled' },
      })
    } else if (row.status === 'paid') {
      await executeServiceOrderRefund(this.prisma, this.registry, this.audit, this.redis ?? null, row.id, SERVICE_REFUND_REASON_USER_CANCELLED)
    } else if (row.status === 'consumed') {
      throw new ConflictException({
        error: { code: 'SERVICE_ORDER_IN_USE', message: '这一次已经开始，不能取消' },
      })
    }
    const fresh = await this.prisma.serviceOrder.findUnique({ where: { id: row.id } })
    return this.toView(fresh ?? row, false)
  }

  async beginTrip(headers: Headers, serviceKey: ServiceOrderKey): Promise<TripHold> {
    const terminalId = headerOf(headers, 'x-terminal-id')
    if (!terminalId) return freeHold()
    // 不收费的机器先返回，不验终端会话。否则免费机器会多出一道 401。
    const prices = await getEffectiveUserPrices(this.prisma, terminalId)
    const amountCents = prices.prices[serviceKey].effectiveCents
    if (amountCents <= 0) return freeHold()
    await this.sessions.validate(terminalId, headerOf(headers, 'x-terminal-session-token') ?? undefined)
    const kioskSessionId = headerOf(headers, 'x-kiosk-session-id')
    const serviceOrderId = headerOf(headers, 'x-service-order-id')
    const hold = freeHold()
    hold.required = true
    hold.consume = async (consumedRef: string) => {
      hold.orderId = await this.consumePaid(terminalId, kioskSessionId, serviceKey, serviceOrderId, amountCents, consumedRef)
      hold.skipDailyQuota = true
    }
    hold.noteMade = async () => {
      if (hold.orderId) await this.finishMade(hold.orderId)
    }
    hold.noteNotMade = async (event: ServiceTripEvent) => {
      if (hold.orderId) await this.markNotMade(hold.orderId, event)
    }
    hold.attachRef = async (consumedRef: string) => {
      if (hold.orderId) await this.attachRef(hold.orderId, consumedRef)
    }
    return hold
  }

  /** 收费机器上，这张已开始的单还盖得住这一趟子调用。不收费的机器一律不算，每日次数照旧。 */
  async coversTrip(headers: Headers, serviceKey: ServiceOrderKey): Promise<string | null> {
    const terminalId = headerOf(headers, 'x-terminal-id')
    if (!terminalId) return null
    const prices = await getEffectiveUserPrices(this.prisma, terminalId)
    if (prices.prices[serviceKey].effectiveCents <= 0) return null
    await this.sessions.validate(terminalId, headerOf(headers, 'x-terminal-session-token') ?? undefined)
    const kioskSessionId = headerOf(headers, 'x-kiosk-session-id')
    const serviceOrderId = headerOf(headers, 'x-service-order-id')
    if (!kioskSessionId || !serviceOrderId) return null
    const row = await this.prisma.serviceOrder.findUnique({ where: { id: serviceOrderId } })
    if (!row || row.status !== 'consumed') return null
    if (row.terminalId !== terminalId || row.kioskSessionId !== kioskSessionId || row.serviceKey !== serviceKey) return null
    return row.id
  }

  /** 排版、导出失败：不改状态，不退款。 */
  async noteLayoutOnly(orderId: string): Promise<void> {
    const row = await this.prisma.serviceOrder.findUnique({ where: { id: orderId }, select: { id: true, status: true } })
    if (!row) return
    await this.audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'service_order.layout_only',
      targetType: 'service_order',
      targetId: orderId,
      payload: { status: row.status },
    })
  }

  async onSessionEnded(terminalId: string, kioskSessionId: string): Promise<void> {
    await this.prisma.serviceOrder.updateMany({
      where: { terminalId, kioskSessionId, status: 'pending' },
      data: { status: 'closed', closeReason: 'session_ended' },
    })
    const paid = await this.prisma.serviceOrder.findMany({
      where: { terminalId, kioskSessionId, status: 'paid' },
      select: { id: true },
    })
    for (const row of paid) {
      try {
        await executeServiceOrderRefund(this.prisma, this.registry, this.audit, this.redis ?? null, row.id, SERVICE_REFUND_REASON_LEFT)
      } catch {
        // 一张退款抛错不能挡住同一会话里其余已付未用的单。会话已经结束，不会再进这里。
      }
    }
  }

  async sweep(now = new Date()): Promise<void> {
    await this.closeExpiredPending(now)
    const retries = await this.prisma.serviceOrder.findMany({
      where: { status: 'paid', attemptsUsed: { gte: 1 }, retryUntil: { lt: now } },
      select: { id: true },
      take: 50,
    })
    for (const row of retries) {
      await executeServiceOrderRefund(this.prisma, this.registry, this.audit, this.redis ?? null, row.id, SERVICE_REFUND_REASON_RETRY_EXPIRED)
    }
    const refunding = await this.prisma.serviceOrder.findMany({
      where: {
        status: 'refunding',
        refundAttempts: { lt: SERVICE_REFUND_RETRY_CAP },
        OR: [{ nextRefundAt: null }, { nextRefundAt: { lte: now } }],
      },
      select: { id: true, refundReason: true },
      take: 20,
    })
    for (const row of refunding) {
      await executeServiceOrderRefund(
        this.prisma, this.registry, this.audit, this.redis ?? null, row.id,
        row.refundReason ?? SERVICE_REFUND_REASON_LEFT,
      )
    }
    await this.sweepScans(now)
  }

  async retryRefund(orderId: string, actorId: string | null) {
    const row = await this.prisma.serviceOrder.findUnique({ where: { id: orderId } })
    if (!row || row.status !== 'refunding') {
      throw new ConflictException({
        error: { code: 'SERVICE_REFUND_NOT_RETRYABLE', message: '这张单现在不在退款中' },
      })
    }
    const result = await executeServiceOrderRefund(
      this.prisma, this.registry, this.audit, this.redis ?? null, row.id,
      row.refundReason ?? '退款重试',
      { manual: true, actorId },
    )
    if (result === 'skipped') {
      throw new ConflictException({
        error: { code: 'SERVICE_REFUND_RETRY_EXHAUSTED', message: '自动退款已试过上限，请人工处理' },
      })
    }
    return this.adminGet(orderId)
  }

  async adminList(query: ServiceOrderAdminQuery) {
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
      this.prisma.serviceOrder.count({ where }),
      this.prisma.serviceOrder.findMany({
        where,
        include: { terminal: { select: { terminalCode: true, locationLabel: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ])
    return {
      items: rows.map((row) => this.toAdminItem(row, row.terminal)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    }
  }

  async adminGet(orderId: string) {
    const row = await this.prisma.serviceOrder.findUnique({
      where: { id: orderId },
      include: { terminal: { select: { terminalCode: true, locationLabel: true } } },
    })
    if (!row) return null
    const item = this.toAdminItem(row, row.terminal)
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

  private async consumePaid(
    terminalId: string,
    kioskSessionId: string | null,
    serviceKey: ServiceOrderKey,
    serviceOrderId: string | null,
    amountCents: number,
    consumedRef: string,
  ): Promise<string> {
    if (!kioskSessionId || !serviceOrderId) throw paymentRequired(amountCents, serviceKey)
    const now = new Date()
    const claimed = await this.prisma.serviceOrder.updateMany({
      where: {
        id: serviceOrderId,
        terminalId,
        kioskSessionId,
        serviceKey,
        status: 'paid',
        attemptsUsed: { lt: 2 },
        OR: [{ attemptsUsed: 0 }, { retryUntil: { gt: now } }],
      },
      data: {
        attemptsUsed: { increment: 1 },
        status: 'consumed',
        consumedAt: now,
        consumedRef,
        failureReason: null,
        retryUntil: null,
      },
    })
    if (claimed.count === 1) return serviceOrderId
    const row = await this.prisma.serviceOrder.findUnique({ where: { id: serviceOrderId } })
    if (row?.status === 'paid' && row.attemptsUsed >= 1 && row.retryUntil && row.retryUntil.getTime() <= now.getTime()) {
      await executeServiceOrderRefund(this.prisma, this.registry, this.audit, this.redis ?? null, row.id, SERVICE_REFUND_REASON_RETRY_EXPIRED)
    }
    throw paymentRequired(amountCents, serviceKey)
  }

  private async markNotMade(orderId: string, event: ServiceTripEvent): Promise<void> {
    const row = await this.prisma.serviceOrder.findUnique({ where: { id: orderId } })
    if (!row || !isServiceOrderKey(row.serviceKey) || row.status !== 'consumed') return
    const outcome = classifyServiceOutcome(row.serviceKey, event)
    if (outcome === 'layout_only') return
    if (outcome === 'made') {
      await this.finishMade(orderId)
      return
    }
    const session = await this.prisma.kioskSession.findUnique({
      where: { terminalId_clientSessionId: { terminalId: row.terminalId, clientSessionId: row.kioskSessionId } },
      select: { endedAt: true },
    })
    if (!session?.endedAt && row.attemptsUsed < 2) {
      const updated = await this.prisma.serviceOrder.updateMany({
        where: { id: row.id, status: 'consumed', attemptsUsed: row.attemptsUsed },
        data: {
          status: 'paid',
          failureReason: failureReasonFor(event),
          retryUntil: new Date(Date.now() + SERVICE_RETRY_WINDOW_MS),
          consumedAt: null,
          consumedRef: null,
        },
      })
      if (updated.count === 1) return
    }
    await executeServiceOrderRefund(
      this.prisma, this.registry, this.audit, this.redis ?? null, row.id, failureReasonFor(event),
    )
  }

  private async finishMade(orderId: string): Promise<void> {
    await this.prisma.serviceOrder.updateMany({
      where: { id: orderId, status: 'consumed' },
      data: { failureReason: null, retryUntil: null },
    })
  }

  private async attachRef(orderId: string, consumedRef: string): Promise<void> {
    await this.prisma.serviceOrder.updateMany({
      where: { id: orderId, status: 'consumed' },
      data: { consumedRef },
    })
  }

  private async sweepScans(now: Date): Promise<void> {
    const rows = await this.prisma.serviceOrder.findMany({
      where: { status: 'consumed', serviceKey: 'scan', consumedAt: { lt: new Date(now.getTime() - 15_000) } },
      take: 30,
    })
    for (const row of rows) {
      if (!row.consumedRef || row.consumedRef === 'pending') {
        if (row.consumedAt && row.consumedAt.getTime() < now.getTime() - 2 * 60 * 1000) {
          await this.markNotMade(row.id, 'scan_no_file')
        }
        continue
      }
      const task = await this.prisma.scanTask.findUnique({
        where: { id: row.consumedRef },
        select: { fileId: true, status: true },
      })
      if (task?.fileId) {
        await this.finishMade(row.id)
        continue
      }
      if (task && (task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired') && !task.fileId) {
        await this.markNotMade(row.id, 'scan_no_file')
      }
    }
  }

  private async requireOpenSession(terminalId: string, kioskSessionId: string): Promise<void> {
    const session = await this.prisma.kioskSession.findUnique({
      where: { terminalId_clientSessionId: { terminalId, clientSessionId: kioskSessionId } },
      select: { endedAt: true },
    })
    if (!session || session.endedAt) {
      throw new BadRequestException({
        error: { code: 'SERVICE_SESSION_REQUIRED', message: '请先开始这一次使用' },
      })
    }
  }

  private async owned(terminalId: string, orderId: string, kioskSessionId: string): Promise<OrderRow> {
    const row = await this.prisma.serviceOrder.findUnique({ where: { id: orderId } })
    if (!row || row.terminalId !== terminalId || row.kioskSessionId !== kioskSessionId) {
      throw new NotFoundException({
        error: { code: 'SERVICE_ORDER_NOT_FOUND', message: '没有这一张付款单' },
      })
    }
    return row
  }

  private toView(row: OrderRow, checking: boolean): ServiceOrderView {
    const serviceKey = isServiceOrderKey(row.serviceKey) ? row.serviceKey : 'scan'
    return {
      id: row.id,
      serviceKey: row.serviceKey,
      serviceName: SERVICE_ORDER_NAMES[serviceKey],
      status: row.status,
      amountCents: row.amountCents,
      expiresAt: row.expiresAt.toISOString(),
      qrCodeContent: row.qrCodeContent,
      paidAt: iso(row.paidAt),
      refundReason: row.refundReason,
      refundedAt: iso(row.refundedAt),
      failureReason: row.failureReason,
      retryUntil: iso(row.retryUntil),
      attemptsUsed: row.attemptsUsed,
      closeReason: row.closeReason,
      paymentFailed: row.paymentFailed,
      checking,
      consumedAt: iso(row.consumedAt),
      provider: row.provider,
    }
  }

  private async auditPaid(row: Pick<OrderRow, 'id' | 'amountCents' | 'serviceKey' | 'provider'>): Promise<void> {
    await this.audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'service_order.paid',
      targetType: 'service_order',
      targetId: row.id,
      payload: { amountCents: row.amountCents, serviceKey: row.serviceKey, provider: row.provider },
    })
  }

  /** 超时未付关掉。渠道说已经付了就改成已付，不把付过的单关成没付钱。 */
  private async closeExpiredPending(now: Date): Promise<void> {
    const rows = await this.prisma.serviceOrder.findMany({
      where: { status: 'pending', expiresAt: { lt: now } },
      take: 50,
    })
    for (const row of rows) {
      const provider = this.registry.get(row.provider)
      if (provider?.closeExpiredQrPayment) {
        try {
          const closed = await provider.closeExpiredQrPayment({ attemptId: row.providerOrderNo, orderId: row.id })
          if (closed.status === 'paid') {
            if (closed.channelTxnNo && closed.amountCents === row.amountCents) {
              const marked = await this.prisma.serviceOrder.updateMany({
                where: { id: row.id, status: 'pending' },
                data: { status: 'paid', paidAt: new Date(), channelTxnNo: closed.channelTxnNo, paymentFailed: false },
              })
              if (marked.count === 1) await this.auditPaid(row)
            }
            continue
          }
          if (closed.status !== 'closed' && closed.status !== 'failed') continue
        } catch {
          // 关码失败仍按未付关闭。之后若迟到的成功通知进来，会按原路退回。
        }
      }
      await this.prisma.serviceOrder.updateMany({
        where: { id: row.id, status: 'pending', expiresAt: { lt: now } },
        data: { status: 'closed', closeReason: 'expired' },
      })
    }
  }

  private toAdminItem(row: OrderRow, terminal: { terminalCode: string | null; locationLabel: string | null }) {
    const serviceKey = isServiceOrderKey(row.serviceKey) ? row.serviceKey : row.serviceKey
    const payStatus = row.status === 'pending' ? 'unpaid' : row.status === 'consumed' ? 'paid' : row.status
    const taskStatus = row.status === 'consumed'
      ? 'completed'
      : row.status === 'refunded' || row.status === 'closed'
        ? 'cancelled'
        : row.status === 'refunding'
          ? 'failed'
          : 'pending'
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
      retryForbidden: row.status !== 'refunding',
      refundRequired: false,
      opsAttention: row.status === 'refunding',
      opsAttentionCode: row.status === 'refunding' ? 'refunding' as const : null,
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
}
