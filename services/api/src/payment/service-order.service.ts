import {
  BadRequestException,
  ConflictException,
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
  markServiceOrderPaid,
  newProviderOrderNo,
} from './service-order.payment'
import { attachServiceOrderConsumedRef } from './service-order.ref'
import { retryPendingChannelCloses } from './service-order.retire'
import { drainServiceOrderSweep, releaseInterviewSession } from './service-order.sweep'
import {
  SERVICE_ORDER_NAMES,
  SERVICE_PAY_TTL_MS,
  SERVICE_REFUND_REASON_LEFT,
  SERVICE_REFUND_REASON_NOW_FREE,
  SERVICE_REFUND_REASON_USER_CANCELLED,
  isServiceOrderKey,
  type ServiceOrderKey,
  type ServiceTripEvent,
} from './service-order.policy'
import {
  getServiceOrderForAdmin,
  listServiceOrdersForAdmin,
  refundServiceOrderByAdmin,
  retryServiceOrderRefund,
  type ServiceOrderAdminQuery,
} from './service-order.admin'
import {
  reclaimFailedScan,
  releasePendingServiceConsume,
  replayOpenScanOrder,
} from './service-order.scan'
import {
  closeExpiredServiceOrders,
  consumePaidServiceOrder,
  finishServiceOrder,
  markServiceOrderNotMade,
  type ServiceOrderSettleDeps,
} from './service-order.settle'

export type { ServiceOrderAdminQuery }

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
  settledAt: string | null
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

@Injectable()
export class ServiceOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: TerminalSessionService,
    @Inject(PAYMENT_PROVIDER_TOKEN) private readonly registry: PaymentProviderRegistry,
    @Optional() private readonly redis?: RedisService,
  ) {}

  private settleDeps(): ServiceOrderSettleDeps {
    return {
      prisma: this.prisma,
      registry: this.registry,
      audit: this.audit,
      redis: this.redis ?? null,
    }
  }

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
            await markServiceOrderPaid(
              this.prisma, this.registry, this.audit, row, found.channelTxnNo, row.prepayId ?? '', this.redis ?? null,
            )
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
    const deps = this.settleDeps()
    const hold = freeHold()
    hold.required = true
    hold.consume = async (consumedRef: string) => {
      hold.orderId = await consumePaidServiceOrder(deps, {
        terminalId,
        kioskSessionId,
        serviceKey,
        serviceOrderId,
        amountCents,
        consumedRef,
      }, (row) => reclaimFailedScan(deps, row))
      hold.skipDailyQuota = true
    }
    hold.noteMade = async () => {
      if (hold.orderId) await finishServiceOrder(this.prisma, hold.orderId)
    }
    hold.noteNotMade = async (event: ServiceTripEvent) => {
      if (hold.orderId) await markServiceOrderNotMade(deps, hold.orderId, event)
    }
    hold.attachRef = async (consumedRef: string) => {
      if (!hold.orderId) return false
      return attachServiceOrderConsumedRef(this.prisma, hold.orderId, consumedRef)
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
    const deps = this.settleDeps()
    await closeExpiredServiceOrders(deps, now)
    await retryPendingChannelCloses(this.prisma, this.registry, this.audit, this.redis ?? null)
    await drainServiceOrderSweep({
      prisma: this.prisma,
      now,
      refund: (orderId, reason) => executeServiceOrderRefund(
        this.prisma, this.registry, this.audit, this.redis ?? null, orderId, reason,
      ),
      markNotMade: (orderId, event) => markServiceOrderNotMade(deps, orderId, event),
      finishMade: (orderId) => finishServiceOrder(this.prisma, orderId),
    })
  }

  async retryRefund(orderId: string, actorId: string | null) {
    return retryServiceOrderRefund(this.settleDeps(), orderId, actorId)
  }

  /** 卡住的已付、或还没结案的已占用单。二次确认后原路退。做成的单不从这里退。 */
  async adminRefund(orderId: string, actorId: string | null, confirm: boolean) {
    return refundServiceOrderByAdmin(this.settleDeps(), orderId, actorId, confirm)
  }

  async adminList(query: ServiceOrderAdminQuery) {
    return listServiceOrdersForAdmin(this.prisma, query)
  }

  async adminGet(orderId: string) {
    return getServiceOrderForAdmin(this.prisma, orderId)
  }

  /** 同一张已占用的扫描单重放时直接接着做，不再占一张新单。任务已经失败则交给认领失败后的当场复核。 */
  async replayOpenScan(headers: Headers): Promise<string | null> {
    return replayOpenScanOrder(this.prisma, headers)
  }

  /** 这次占用没挂上任务。退回已付。用过的次数还在的，必须留着再试期限，不能变成没人管。 */
  async releasePendingConsume(orderId: string): Promise<void> {
    return releasePendingServiceConsume(this.prisma, orderId)
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
      settledAt: iso(row.settledAt),
      closeReason: row.closeReason,
      paymentFailed: row.paymentFailed,
      checking,
      consumedAt: iso(row.consumedAt),
      provider: row.provider,
    }
  }
}
