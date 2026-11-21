import { Injectable, Logger, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { AuditService } from '../audit/audit.service'
import { RedisService } from '../common/redis/redis.service'
import {
  evaluateMiniappVirtualPayRuntime,
  resolveMiniappVirtualPayAppKeyForEnv,
} from '../config/production-runtime-gates'
import { MiniappAccessTokenService } from '../miniapp-access-token/miniapp-access-token.service'
import { PrismaService } from '../prisma/prisma.service'
import { sendVirtualPayOpsAlert } from './virtual-pay-alert'
import { confirmPaid } from './virtual-pay-delivery'
import { VIRTUAL_PAY_DIAGNOSTIC_ACTION } from './virtual-pay-order.service'
import { calcPaySig } from './virtual-pay-sign'

/** 超过 2 分钟仍待支付才查，避免刚下单就打微信。核对表补充规则 8。 */
export const VIRTUAL_PAY_QUERY_MIN_AGE_MS = 2 * 60 * 1000
/** 超过 2 小时仍未付就关单。关之前再查一次，已付的不丢掉。 */
export const VIRTUAL_PAY_QUERY_MAX_AGE_MS = 2 * 60 * 60 * 1000
/** 同一单连续查询失败达到上限后转待人工，不再占自动批次。 */
export const VIRTUAL_PAY_QUERY_MAX_FAILS = 3
/** 待支付单超过 24 小时仍因查询失败无法收敛时直接转待人工。 */
export const VIRTUAL_PAY_MANUAL_REVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000
const QUERY_TAKE = 50
const QUERY_URI = '/xpay/query_order'
const PAID_STATUSES = new Set([2, 3, 4, 7, 9, 10])

interface PendingOrder {
  id: string
  outTradeNo: string
  openId: string | null
  env: number
  priceCents: number
  createdAt: Date
  queryFailCount: number
  lastDiagnosticReason: string | null
}

type QueryOutcome =
  | { kind: 'paid' | 'unpaid' | 'close' | 'mismatch' }
  | { kind: 'error'; reason: string }

/**
 * 每 5 分钟查一次仍待支付的单。查到已支付走发货同一条幂等路径。
 * 服务端 pay_sig 只签实际发出的 body，按订单自己的 env 选键。核对表 1.17、3.3、3.4、3.6、3.7、补充规则 8、10、15。
 */
@Injectable()
export class VirtualPayReconcileService {
  private readonly logger = new Logger(VirtualPayReconcileService.name)
  private lastGlobalDiagnostic: string | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: MiniappAccessTokenService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  @Cron('0 */5 * * * *', { name: 'miniapp-virtual-pay-reconcile' })
  tick(): Promise<void> {
    return this.reconcileOnce(new Date())
  }

  async reconcileOnce(now: Date, fetchImpl: typeof fetch = fetch): Promise<void> {
    const runtime = evaluateMiniappVirtualPayRuntime()
    if (!runtime.ready || !runtime.appKey) {
      const pendingCount = await this.prisma.virtualPayOrder.count({ where: { status: 'pending' } })
      if (pendingCount === 0) {
        this.lastGlobalDiagnostic = null
        return
      }
      await this.diagnoseGlobal(runtime.block ?? 'env_missing')
      return
    }
    const dueBefore = new Date(now.getTime() - VIRTUAL_PAY_QUERY_MIN_AGE_MS)
    const closeBefore = new Date(now.getTime() - VIRTUAL_PAY_QUERY_MAX_AGE_MS)
    const due = await this.prisma.virtualPayOrder.findMany({
      where: { status: 'pending', createdAt: { lt: dueBefore, gt: closeBefore } },
      orderBy: { createdAt: 'asc' },
      take: QUERY_TAKE,
    })
    const expired = await this.prisma.virtualPayOrder.findMany({
      where: { status: 'pending', createdAt: { lte: closeBefore } },
      orderBy: { createdAt: 'asc' },
      take: QUERY_TAKE,
    })
    if (due.length === 0 && expired.length === 0) {
      this.lastGlobalDiagnostic = null
      return
    }
    let token: string
    try {
      token = await this.tokens.getAccessToken(fetchImpl)
    } catch {
      await this.diagnoseGlobal('query_failed')
      return
    }
    this.lastGlobalDiagnostic = null
    for (const order of due) {
      await this.reconcileOrder(order, token, false, now, fetchImpl)
    }
    for (const order of expired) {
      await this.reconcileOrder(order, token, true, now, fetchImpl)
    }
  }

  private async reconcileOrder(
    order: PendingOrder,
    token: string,
    expired: boolean,
    now: Date,
    fetchImpl: typeof fetch,
  ): Promise<void> {
    if (!order.openId) {
      await this.diagnoseOrder(order, 'openid_mismatch')
      if (expired) await this.close(order.id)
      return
    }
    const orderAppKey = resolveMiniappVirtualPayAppKeyForEnv(order.env)
    if (!orderAppKey) {
      await this.recordQueryFailure(order, now, 'app_key_missing', fetchImpl)
      return
    }
    let outcome: QueryOutcome
    try {
      outcome = await this.queryOne({ ...order, openId: order.openId }, orderAppKey, token, fetchImpl)
    } catch {
      await this.recordQueryFailure(order, now, 'query_failed', fetchImpl)
      return
    }
    if (outcome.kind === 'error') {
      await this.recordQueryFailure(order, now, outcome.reason, fetchImpl)
      return
    }
    if (outcome.kind === 'unpaid' && !expired && (order.queryFailCount > 0 || order.lastDiagnosticReason !== null)) {
      await this.resetQueryState(order.id)
    } else if (outcome.kind === 'mismatch' && !expired && order.queryFailCount > 0) {
      await this.clearFailCount(order.id)
    }
    if (outcome.kind === 'close' || ((outcome.kind === 'unpaid' || outcome.kind === 'mismatch') && expired)) {
      await this.close(order.id)
    }
  }

  private async queryOne(
    order: PendingOrder & { openId: string },
    appKey: string,
    token: string,
    fetchImpl: typeof fetch,
  ): Promise<QueryOutcome> {
    const body = JSON.stringify({ openid: order.openId, env: order.env, order_id: order.outTradeNo })
    const paySig = calcPaySig(QUERY_URI, body, appKey)
    const url =
      'https://api.weixin.qq.com/xpay/query_order' +
      `?access_token=${encodeURIComponent(token)}` +
      `&pay_sig=${encodeURIComponent(paySig)}`
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!response.ok) throw new Error('VPAY_QUERY_HTTP')
    const data = (await response.json()) as {
      errcode?: number
      order?: { status?: number; paid_fee?: number; env_type?: number; wx_order_id?: string; paid_time?: number }
    }
    if (data.errcode !== 0 || !data.order || typeof data.order.status !== 'number') {
      return { kind: 'error', reason: 'query_failed' }
    }
    const status = data.order.status
    if (status === 0 || status === 1) return { kind: 'unpaid' }
    if (status === 5 || status === 8) {
      await this.diagnoseOrder(order, 'refunded_before_grant')
      return { kind: 'close' }
    }
    if (status === 6) {
      await this.diagnoseOrder(order, 'order_closed')
      return { kind: 'close' }
    }
    if (!PAID_STATUSES.has(status)) return { kind: 'unpaid' }
    const env = data.order.env_type === 1 ? 0 : data.order.env_type === 2 ? 1 : null
    if (env == null || typeof data.order.paid_fee !== 'number') {
      return { kind: 'error', reason: 'query_failed' }
    }
    const result = await confirmPaid(this.prisma, {
      outTradeNo: order.outTradeNo,
      openId: order.openId,
      env,
      priceCents: data.order.paid_fee,
      wxOrderId: data.order.wx_order_id || null,
      paidAt: data.order.paid_time && data.order.paid_time > 0 ? new Date(data.order.paid_time * 1000) : null,
    })
    if (!result.ok) {
      await this.diagnoseOrder(order, result.reason)
      return { kind: 'mismatch' }
    }
    return { kind: 'paid' }
  }

  private async recordQueryFailure(
    order: PendingOrder,
    now: Date,
    failReason: string,
    fetchImpl: typeof fetch,
  ): Promise<void> {
    const nextFails = (order.queryFailCount ?? 0) + 1
    const ageMs = now.getTime() - order.createdAt.getTime()
    if (nextFails >= VIRTUAL_PAY_QUERY_MAX_FAILS || ageMs >= VIRTUAL_PAY_MANUAL_REVIEW_MAX_AGE_MS) {
      const moved = await this.prisma.virtualPayOrder.updateMany({
        where: { id: order.id, status: 'pending' },
        data: { status: 'manual_review', queryFailCount: nextFails },
      })
      if (moved.count === 1) {
        await this.diagnoseOrder(order, 'query_manual_review', { failCount: nextFails, lastError: failReason })
        await sendVirtualPayOpsAlert({
          redis: this.redis,
          fetchImpl,
          outTradeNo: order.outTradeNo,
          episodeToken: 'manual-review',
          type: 'virtual_pay_manual_review',
          severity: 'error',
          title: `小程序虚拟支付订单 ${order.outTradeNo} 查单持续失败已转待人工`,
          logger: this.logger,
        })
      }
      return
    }
    await this.prisma.virtualPayOrder.updateMany({
      where: { id: order.id, status: 'pending' },
      data: { queryFailCount: nextFails },
    })
    await this.diagnoseOrder(order, failReason)
  }

  private close(id: string): Promise<unknown> {
    return this.prisma.virtualPayOrder.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'closed' },
    })
  }

  private clearFailCount(id: string): Promise<unknown> {
    return this.prisma.virtualPayOrder.updateMany({
      where: { id, status: 'pending' },
      data: { queryFailCount: 0 },
    })
  }

  private resetQueryState(id: string): Promise<unknown> {
    return this.prisma.virtualPayOrder.updateMany({
      where: { id, status: 'pending' },
      data: { queryFailCount: 0, lastDiagnosticReason: null },
    })
  }

  private async diagnoseOrder(
    order: PendingOrder,
    reason: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    if (order.lastDiagnosticReason === reason) return
    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: VIRTUAL_PAY_DIAGNOSTIC_ACTION,
      targetType: 'virtual_pay_order',
      targetId: order.outTradeNo,
      payload: { reason, ...extra },
    })
    order.lastDiagnosticReason = reason
    await this.prisma.virtualPayOrder.update({
      where: { id: order.id },
      data: { lastDiagnosticReason: reason },
    })
  }

  private async diagnoseGlobal(reason: string): Promise<void> {
    if (this.lastGlobalDiagnostic === reason) return
    this.lastGlobalDiagnostic = reason
    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: VIRTUAL_PAY_DIAGNOSTIC_ACTION,
      targetType: 'virtual_pay_order',
      targetId: null,
      payload: { reason },
    })
  }
}
