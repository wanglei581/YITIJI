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
import { assertUserPaysUnit, getEffectiveUserPrices } from './effective-user-prices'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalSessionService } from '../terminals/terminal-session.service'
import { PAYMENT_PROVIDER_TOKEN, type PaymentProviderRegistry } from './payment-provider.factory'
import {
  chargingProvider,
  executeServiceOrderRefund,
  newProviderOrderNo,
} from './service-order.payment'
import {
  attachServiceOrderConsumedRef,
  displaceOrBlockOpenRef,
  isServiceOrderOpenRefConflict,
  serviceOrderRefOccupied,
} from './service-order.ref'
import { drainServiceOrderSweep, releaseInterviewSession } from './service-order.sweep'
import {
  SERVICE_ORDER_NAMES,
  SERVICE_PAY_TTL_MS,
  SERVICE_REFUND_REASON_ADMIN,
  SERVICE_REFUND_REASON_LEFT,
  SERVICE_REFUND_REASON_NOW_FREE,
  SERVICE_REFUND_REASON_RETRY_EXPIRED,
  SERVICE_REFUND_REASON_USER_CANCELLED,
  SERVICE_REFUND_RETRY_CAP,
  SERVICE_RETRY_WINDOW_MS,
  SERVICE_SCAN_PENDING_LIMIT_MS,
  SERVICE_SWEEP_BATCH,
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
  attachRef(consumedRef: string): Promise<boolean>
  adopt(orderId: string): void
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
    async attachRef() { return false },
    adopt() {},
  }
}

function orderInUse(consumedRef: string | null): HttpException {
  return new ConflictException({
    error: {
      code: 'SERVICE_ORDER_IN_USE',
      message: '这一次已经在进行',
      ...(consumedRef ? { consumedRef } : {}),
    },
  })
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
    const unit = prices.prices[input.serviceKey]
    try {
      assertUserPaysUnit(unit)
    } catch (error) {
      if (error instanceof Error && error.message === 'PRICE_CONFIG_INVALID') {
        throw new BadRequestException({
          error: { code: 'PRICE_CONFIG_INVALID', message: '这台机器的价目还不能向个人收费' },
        })
      }
      throw error
    }
    const amountCents = unit.effectiveCents
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
        description: SERVICE_ORDER_NAMES[input.serviceKey],
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
    // 没带终端头的是手机、桌面，这一版不收费。带了终端头必须先验会话，再看价。
    if (!terminalId) return freeHold()
    await this.sessions.validate(terminalId, headerOf(headers, 'x-terminal-session-token') ?? undefined)
    const prices = await getEffectiveUserPrices(this.prisma, terminalId)
    const amountCents = prices.prices[serviceKey].effectiveCents
    if (amountCents <= 0) {
      await this.refundBecauseMachineFree(headers, terminalId, serviceKey)
      return freeHold()
    }
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
      if (!hold.orderId) return false
      return this.attachRef(hold.orderId, consumedRef)
    }
    hold.adopt = (orderId: string) => {
      hold.orderId = orderId
    }
    return hold
  }

  /** 收费机器上，这张已开始的单还盖得住这一趟子调用。不收费的机器一律不算，每日次数照旧。 */
  async coversTrip(headers: Headers, serviceKey: ServiceOrderKey): Promise<string | null> {
    const terminalId = headerOf(headers, 'x-terminal-id')
    if (!terminalId) return null
    await this.sessions.validate(terminalId, headerOf(headers, 'x-terminal-session-token') ?? undefined)
    const prices = await getEffectiveUserPrices(this.prisma, terminalId)
    if (prices.prices[serviceKey].effectiveCents <= 0) {
      await this.refundBecauseMachineFree(headers, terminalId, serviceKey)
      return null
    }
    const kioskSessionId = headerOf(headers, 'x-kiosk-session-id')
    const serviceOrderId = headerOf(headers, 'x-service-order-id')
    if (!kioskSessionId || !serviceOrderId) return null
    const row = await this.prisma.serviceOrder.findUnique({ where: { id: serviceOrderId } })
    if (!row || row.status !== 'consumed') return null
    if (row.terminalId !== terminalId || row.kioskSessionId !== kioskSessionId || row.serviceKey !== serviceKey) return null
    return row.id
  }

  /** 请求还带着本会话已付未用的单，而这台机器现在不收费：当场原路退，然后按免费放行。 */
  private async refundBecauseMachineFree(headers: Headers, terminalId: string, serviceKey: ServiceOrderKey): Promise<void> {
    const orderId = headerOf(headers, 'x-service-order-id')
    const kioskSessionId = headerOf(headers, 'x-kiosk-session-id')
    if (!orderId || !kioskSessionId) return
    const row = await this.prisma.serviceOrder.findUnique({ where: { id: orderId } })
    if (!row || row.terminalId !== terminalId || row.kioskSessionId !== kioskSessionId) return
    if (row.serviceKey !== serviceKey || row.status !== 'paid' || row.attemptsUsed !== 0) return
    await executeServiceOrderRefund(
      this.prisma, this.registry, this.audit, this.redis ?? null, row.id, SERVICE_REFUND_REASON_NOW_FREE,
    )
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
    await drainServiceOrderSweep({
      prisma: this.prisma,
      now,
      refund: (orderId, reason) => executeServiceOrderRefund(
        this.prisma, this.registry, this.audit, this.redis ?? null, orderId, reason,
      ),
      markNotMade: (orderId, event) => this.markNotMade(orderId, event),
      finishMade: (orderId) => this.finishMade(orderId),
    })
  }

  async retryRefund(orderId: string, actorId: string | null) {
    const row = await this.prisma.serviceOrder.findUnique({ where: { id: orderId } })
    if (!row || (row.status !== 'refunding' && row.status !== 'refund_failed')) {
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
      const fresh = await this.prisma.serviceOrder.findUnique({ where: { id: orderId }, select: { refundLeaseUntil: true, refundAttempts: true, status: true } })
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
    return this.adminGet(orderId)
  }

  /** 卡住的已付、或还没结案的已占用单。二次确认后原路退。做成的单不从这里退。 */
  async adminRefund(orderId: string, actorId: string | null, confirm: boolean) {
    if (confirm !== true) {
      throw new BadRequestException({
        error: { code: 'SERVICE_REFUND_CONFIRM_REQUIRED', message: '请再确认一次原路退款' },
      })
    }
    const row = await this.prisma.serviceOrder.findUnique({ where: { id: orderId } })
    const stuckConsumed = row?.status === 'consumed' && !row.settledAt
    if (!row || (row.status !== 'paid' && !stuckConsumed)) {
      throw new ConflictException({
        error: { code: 'SERVICE_REFUND_NOT_RETRYABLE', message: '这张单现在不能原路退款' },
      })
    }
    const result = await executeServiceOrderRefund(
      this.prisma, this.registry, this.audit, this.redis ?? null, row.id, SERVICE_REFUND_REASON_ADMIN,
    )
    if (result === 'skipped') {
      throw new ConflictException({
        error: { code: 'SERVICE_REFUND_NOT_RETRYABLE', message: '这张单现在不能原路退款' },
      })
    }
    await this.audit.write({
      actorId,
      actorRole: actorId ? 'admin' : 'system',
      action: 'service_order.admin_refund',
      targetType: 'service_order',
      targetId: row.id,
      payload: { reason: SERVICE_REFUND_REASON_ADMIN, amountCents: row.amountCents, result },
    })
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
    await this.yieldOpenRef(serviceKey, consumedRef, serviceOrderId, now)
    const claimed = await this.claimConsume(terminalId, kioskSessionId, serviceKey, serviceOrderId, consumedRef, now)
    if (claimed === 1) return serviceOrderId
    if (claimed < 0) {
      await this.yieldOpenRef(serviceKey, consumedRef, serviceOrderId, now)
      const again = await this.claimConsume(terminalId, kioskSessionId, serviceKey, serviceOrderId, consumedRef, now)
      if (again === 1) return serviceOrderId
      throw await this.refOccupiedBy(serviceKey, consumedRef, serviceOrderId)
    }
    const row = await this.prisma.serviceOrder.findUnique({ where: { id: serviceOrderId } })
    const sameTrip = Boolean(
      row && row.terminalId === terminalId && row.kioskSessionId === kioskSessionId && row.serviceKey === serviceKey,
    )
    if (sameTrip && row?.status === 'consumed' && serviceKey === 'scan') {
      const reclaimed = await this.reclaimFailedScan(row)
      if (reclaimed) {
        await this.yieldOpenRef(serviceKey, consumedRef, serviceOrderId, now)
        const again = await this.claimConsume(terminalId, kioskSessionId, serviceKey, serviceOrderId, consumedRef, now)
        if (again === 1) return serviceOrderId
        if (again < 0) throw await this.refOccupiedBy(serviceKey, consumedRef, serviceOrderId)
      }
    }
    const fresh = sameTrip ? await this.prisma.serviceOrder.findUnique({ where: { id: serviceOrderId } }) : row
    if (fresh && fresh.terminalId === terminalId && fresh.kioskSessionId === kioskSessionId && fresh.serviceKey === serviceKey && fresh.status === 'consumed') {
      throw orderInUse(fresh.consumedRef)
    }
    if (row?.status === 'paid' && row.attemptsUsed >= 1 && row.retryUntil && row.retryUntil.getTime() <= now.getTime()) {
      await executeServiceOrderRefund(this.prisma, this.registry, this.audit, this.redis ?? null, row.id, SERVICE_REFUND_REASON_RETRY_EXPIRED)
    }
    throw paymentRequired(amountCents, serviceKey)
  }

  /** 扫描没出文件时当场改回可再试，不等下一拍清扫。只有回到已付才让这次认领重试。 */
  private async reclaimFailedScan(row: OrderRow): Promise<boolean> {
    if (row.serviceKey !== 'scan' || row.status !== 'consumed') return false
    const ref = row.consumedRef
    const pendingTooLong = Boolean(
      row.consumedAt && row.consumedAt.getTime() < Date.now() - SERVICE_SCAN_PENDING_LIMIT_MS,
    )
    let notMade = false
    if (!ref || ref === 'pending') {
      notMade = pendingTooLong
    } else {
      const task = await this.prisma.scanTask.findUnique({
        where: { id: ref },
        select: { fileId: true, status: true },
      })
      if (task?.fileId) return false
      const dead = Boolean(task && (task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired'))
      notMade = !task || dead || pendingTooLong
    }
    if (!notMade) return false
    await this.markNotMade(row.id, 'scan_no_file')
    const fresh = await this.prisma.serviceOrder.findUnique({ where: { id: row.id }, select: { status: true } })
    return fresh?.status === 'paid'
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
      data: { failureReason: null, retryUntil: null, settledAt: new Date() },
    })
  }

  /** 同一任务上还有没结案的旧单时，能判没做成就退掉，判不了就留给认领回 409。 */
  private async yieldOpenRef(serviceKey: ServiceOrderKey, consumedRef: string, incomingOrderId: string, now: Date): Promise<void> {
    await displaceOrBlockOpenRef({
      prisma: this.prisma,
      now,
      refund: (orderId, reason) => executeServiceOrderRefund(
        this.prisma, this.registry, this.audit, this.redis ?? null, orderId, reason,
      ),
      releaseInterview: (sessionId) => releaseInterviewSession(this.prisma, sessionId),
    }, { serviceKey, consumedRef, incomingOrderId })
  }

  private async claimConsume(
    terminalId: string,
    kioskSessionId: string,
    serviceKey: ServiceOrderKey,
    serviceOrderId: string,
    consumedRef: string,
    now: Date,
  ): Promise<number> {
    try {
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
      return claimed.count
    } catch (error) {
      if (isServiceOrderOpenRefConflict(error)) return -1
      throw error
    }
  }

  private async refOccupiedBy(serviceKey: ServiceOrderKey, consumedRef: string, incomingOrderId: string): Promise<HttpException> {
    const holder = await this.prisma.serviceOrder.findFirst({
      where: {
        serviceKey,
        consumedRef,
        id: { not: incomingOrderId },
        status: { in: ['pending', 'paid', 'consumed'] },
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    })
    return serviceOrderRefOccupied(holder?.id ?? incomingOrderId)
  }

  /** 一个扫描任务只能挂在一张还没结案的单上。已经挂过就拒绝，调用方退回这一次占用。 */
  private async attachRef(orderId: string, consumedRef: string): Promise<boolean> {
    return attachServiceOrderConsumedRef(this.prisma, orderId, consumedRef)
  }

  /** 同一张已占用的扫描单重放时直接接着做，不再占一张新单。任务已经失败则交给认领失败后的当场复核。 */
  async replayOpenScan(headers: Headers): Promise<string | null> {
    const terminalId = headerOf(headers, 'x-terminal-id')
    const kioskSessionId = headerOf(headers, 'x-kiosk-session-id')
    const serviceOrderId = headerOf(headers, 'x-service-order-id')
    if (!terminalId || !kioskSessionId || !serviceOrderId) return null
    const row = await this.prisma.serviceOrder.findUnique({ where: { id: serviceOrderId } })
    if (!row || row.terminalId !== terminalId || row.kioskSessionId !== kioskSessionId) return null
    if (row.serviceKey !== 'scan' || row.status !== 'consumed' || row.settledAt) return null
    const ref = row.consumedRef
    if (!ref || ref === 'pending') return null
    const task = await this.prisma.scanTask.findUnique({
      where: { id: ref },
      select: { fileId: true, status: true },
    })
    if (!task) return null
    if (!task.fileId && (task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired')) return null
    return row.id
  }

  /** 这次占用没挂上任务。退回已付，次数减一，好让这一单还能用，也不会和别人共有一个任务。 */
  async releasePendingConsume(orderId: string): Promise<void> {
    await this.prisma.serviceOrder.updateMany({
      where: { id: orderId, status: 'consumed', consumedRef: 'pending', attemptsUsed: { gte: 1 } },
      data: {
        status: 'paid',
        attemptsUsed: { decrement: 1 },
        consumedAt: null,
        consumedRef: null,
        failureReason: null,
        retryUntil: null,
      },
    })
  }

  async interviewHasOpening(sessionId: string): Promise<boolean> {
    const turn = await this.prisma.mockInterviewTurn.findFirst({
      where: { sessionId, role: 'interviewer' },
      select: { id: true },
    })
    return Boolean(turn)
  }

  async releaseStuckInterview(sessionId: string): Promise<void> {
    await releaseInterviewSession(this.prisma, sessionId)
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

  /** 超时未付关掉。渠道说已经付了就改成已付，不把付过的单关成没付钱。游标只往前走，渠道还没给结论的单留到下一拍。 */
  private async closeExpiredPending(now: Date): Promise<void> {
    let cursor: string | null = null
    for (;;) {
      const rows: OrderRow[] = await this.prisma.serviceOrder.findMany({
        where: {
          status: 'pending',
          expiresAt: { lt: now },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: SERVICE_SWEEP_BATCH,
      })
      if (rows.length === 0) return
      for (const row of rows) {
        const provider = this.registry.get(row.provider)
        let leaveOpen = false
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
              leaveOpen = true
            } else if (closed.status !== 'closed' && closed.status !== 'failed') {
              leaveOpen = true
            }
          } catch {
            // 关码失败仍按未付关闭。之后若迟到的成功通知进来，会按原路退回。
          }
        }
        if (!leaveOpen) {
          await this.prisma.serviceOrder.updateMany({
            where: { id: row.id, status: 'pending', expiresAt: { lt: now } },
            data: { status: 'closed', closeReason: 'expired' },
          })
        }
      }
      const next = rows[rows.length - 1]?.id
      if (!next || next === cursor || rows.length < SERVICE_SWEEP_BATCH) return
      cursor = next
    }
  }

  private toAdminItem(row: OrderRow, terminal: { terminalCode: string | null; locationLabel: string | null }) {
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
}
