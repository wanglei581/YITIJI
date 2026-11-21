import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { AuditService } from '../audit/audit.service'
import {
  evaluateMiniappVirtualPayRuntime,
  resolveMiniappVirtualPayAppKeyForEnv,
} from '../config/production-runtime-gates'
import { MiniappAccessTokenService } from '../miniapp-access-token/miniapp-access-token.service'
import { PrismaService } from '../prisma/prisma.service'
import { confirmPaid } from './virtual-pay-delivery'
import { VIRTUAL_PAY_DIAGNOSTIC_ACTION } from './virtual-pay-order.service'
import { calcPaySig } from './virtual-pay-sign'

/** 超过 2 分钟仍待支付才查，避免刚下单就打微信。核对表补充规则 8。 */
export const VIRTUAL_PAY_QUERY_MIN_AGE_MS = 2 * 60 * 1000
/** 超过 2 小时仍未付就关单。关之前再查一次，已付的不丢掉。 */
export const VIRTUAL_PAY_QUERY_MAX_AGE_MS = 2 * 60 * 60 * 1000
const QUERY_TAKE = 50
const QUERY_URI = '/xpay/query_order'
const PAID_STATUSES = new Set([2, 3, 4, 7, 9, 10])

interface PendingOrder {
  id: string
  outTradeNo: string
  openId: string | null
  env: number
  priceCents: number
}

/**
 * 每 5 分钟查一次仍待支付的单。查到已支付走发货同一条幂等路径。
 * 服务端 pay_sig 只签实际发出的 body。核对表 3.3、3.4、3.6、3.7、补充规则 8、10、15。
 */
@Injectable()
export class VirtualPayReconcileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: MiniappAccessTokenService,
  ) {}

  @Cron('0 */5 * * * *', { name: 'miniapp-virtual-pay-reconcile' })
  tick(): Promise<void> {
    return this.reconcileOnce(new Date())
  }

  async reconcileOnce(now: Date, fetchImpl: typeof fetch = fetch): Promise<void> {
    const runtime = evaluateMiniappVirtualPayRuntime()
    if (!runtime.ready || !runtime.appKey) {
      await this.diagnose(runtime.block ?? 'env_missing', null)
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
    if (due.length === 0 && expired.length === 0) return
    let token: string
    try {
      token = await this.tokens.getAccessToken(fetchImpl)
    } catch {
      await this.diagnose('query_failed', null)
      return
    }
    for (const order of due) {
      await this.reconcileOrder(order, token, false, fetchImpl)
    }
    for (const order of expired) {
      await this.reconcileOrder(order, token, true, fetchImpl)
    }
  }

  private async reconcileOrder(
    order: PendingOrder,
    token: string,
    expired: boolean,
    fetchImpl: typeof fetch,
  ): Promise<void> {
    if (!order.openId) {
      await this.diagnose('openid_mismatch', order.outTradeNo)
      if (expired) await this.close(order.id)
      return
    }
    const orderAppKey = resolveMiniappVirtualPayAppKeyForEnv(order.env)
    if (!orderAppKey) {
      await this.diagnose('app_key_missing', order.outTradeNo)
      return
    }
    const openId = order.openId
    let outcome: 'paid' | 'unpaid' | 'close' | 'mismatch' | 'error'
    try {
      outcome = await this.queryOne({ ...order, openId }, orderAppKey, token, fetchImpl)
    } catch {
      await this.diagnose('query_failed', order.outTradeNo)
      return
    }
    if (outcome === 'close' || ((outcome === 'unpaid' || outcome === 'mismatch') && expired)) {
      await this.close(order.id)
    }
  }

  private async queryOne(
    order: PendingOrder & { openId: string },
    appKey: string,
    token: string,
    fetchImpl: typeof fetch,
  ): Promise<'paid' | 'unpaid' | 'close' | 'mismatch' | 'error'> {
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
      await this.diagnose('query_failed', order.outTradeNo)
      return 'error'
    }
    const status = data.order.status
    if (status === 0 || status === 1) return 'unpaid'
    if (status === 5 || status === 8) {
      await this.diagnose('refunded_before_grant', order.outTradeNo)
      return 'close'
    }
    if (status === 6) {
      await this.diagnose('order_closed', order.outTradeNo)
      return 'close'
    }
    if (!PAID_STATUSES.has(status)) return 'unpaid'
    const env = data.order.env_type === 1 ? 0 : data.order.env_type === 2 ? 1 : null
    if (env == null || typeof data.order.paid_fee !== 'number') {
      await this.diagnose('query_failed', order.outTradeNo)
      return 'error'
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
      await this.diagnose(result.reason, order.outTradeNo)
      return 'mismatch'
    }
    return 'paid'
  }

  private close(id: string): Promise<unknown> {
    return this.prisma.virtualPayOrder.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'closed' },
    })
  }

  private diagnose(reason: string, outTradeNo: string | null): Promise<string | null> {
    return this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: VIRTUAL_PAY_DIAGNOSTIC_ACTION,
      targetType: 'virtual_pay_order',
      targetId: outTradeNo,
      payload: { reason },
    })
  }
}
