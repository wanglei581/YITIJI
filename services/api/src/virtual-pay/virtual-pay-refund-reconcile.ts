import type { Logger } from '@nestjs/common'
import { BadGatewayException, ConflictException } from '@nestjs/common'
import type { AuditService } from '../audit/audit.service'
import { resolveMiniappVirtualPayAppKeyForEnv } from '../config/production-runtime-gates'
import type { PrismaService } from '../prisma/prisma.service'
import { sendVirtualPayOpsAlert, type VirtualPayAlertRedis } from './virtual-pay-alert'
import { confirmPaid } from './virtual-pay-delivery'
import { VIRTUAL_PAY_DIAGNOSTIC_ACTION } from './virtual-pay-order.service'
import { notifyWechatProvideGoods, queryWechatVirtualPayOrder } from './virtual-pay-xpay-client'
import {
  markVirtualPayRefundFailed,
  settleVirtualPayRefundSucceeded,
} from './virtual-pay-xpay-refund'
import {
  WECHAT_VPAY_STATUS_CLOSED,
  WECHAT_VPAY_STATUS_REFUND_DEDUCTED,
  WECHAT_VPAY_STATUS_REFUND_FAILED,
  WECHAT_VPAY_STATUS_REFUND_SUCCEEDED,
} from './virtual-pay.contract'

const PAID_STATUSES = new Set([2, 3, 4])
const NEED_NOTIFY_PROVIDE_STATUSES = new Set([2, 3])

export interface RefundingOrderRow {
  id: string
  outTradeNo: string
  openId: string | null
  env: number
  priceCents: number
  refundOrderId: string | null
  wxRefundId: string | null
  lastDiagnosticReason: string | null
}

export interface ReconcileRefundingDeps {
  prisma: PrismaService
  audit: AuditService
  redis?: VirtualPayAlertRedis | null
  logger?: Pick<Logger, 'warn'>
  source: 'reconcile' | 'admin_sync'
}

export interface ReconcileRefundingOutcome {
  kind: 'refunded' | 'refund_failed' | 'refunding' | 'unchanged' | 'error'
  wxStatus: number | null
  leftFee: number | null
  reason?: string
}

function mapEnvType(envType: number | undefined): 0 | 1 | null {
  if (envType === 1) return 0
  if (envType === 2) return 1
  return null
}

async function diagnoseOnce(
  prisma: PrismaService,
  audit: AuditService,
  order: Pick<RefundingOrderRow, 'id' | 'outTradeNo'>,
  reason: string,
): Promise<void> {
  const claimed = await prisma.virtualPayOrder.updateMany({
    where: {
      id: order.id,
      OR: [{ lastDiagnosticReason: null }, { lastDiagnosticReason: { not: reason } }],
    },
    data: { lastDiagnosticReason: reason },
  })
  if (claimed.count !== 1) return
  await audit.write({
    actorId: null,
    actorRole: 'system',
    action: VIRTUAL_PAY_DIAGNOSTIC_ACTION,
    targetType: 'virtual_pay_order',
    targetId: order.outTradeNo,
    payload: { reason },
  })
}

/**
 * 收敛 refunding 状态订单（定时查单或管理员同步查单共用）。按微信官方 query_order 定义：
 * - status === 8（用户侧收款完成）→ 收敛为 refunded 并同步权益为 refunded（绝不凭 left_fee=0 提前判成功）
 * - status === 7（退款失败）→ 标 refund_failed + 告警（权益维持锁定 refunding，不自动解锁）
 * - status === 5（商户侧扣款完成）→ 退款进行中，即便 left_fee=0 也继续等待 refunding
 * - status === 6（订单关闭）→ 绝不是退款成功，写诊断告警并保持需核查，不解锁权益
 * - status === 2/3/4（旧支付态）→ 严禁改回 paid 或解锁权益（防先前超时请求晚到完成导致双损）
 */
export async function reconcileRefundingOrder(
  deps: ReconcileRefundingDeps,
  order: RefundingOrderRow,
  token: string,
  fetchImpl: typeof fetch,
  httpTimeoutMs?: number,
): Promise<ReconcileRefundingOutcome> {
  if (!order.openId) {
    await diagnoseOnce(deps.prisma, deps.audit, order, 'refund_openid_missing')
    return { kind: 'error', wxStatus: null, leftFee: null, reason: 'refund_openid_missing' }
  }
  const appKey = resolveMiniappVirtualPayAppKeyForEnv(order.env)
  if (!appKey) {
    await diagnoseOnce(deps.prisma, deps.audit, order, 'app_key_missing')
    return { kind: 'error', wxStatus: null, leftFee: null, reason: 'app_key_missing' }
  }
  let data
  try {
    data = await queryWechatVirtualPayOrder({
      openId: order.openId,
      env: order.env,
      orderId: order.outTradeNo,
      appKey,
      token,
      fetchImpl,
      timeoutMs: httpTimeoutMs,
    })
  } catch {
    await diagnoseOnce(deps.prisma, deps.audit, order, 'refund_query_failed')
    return { kind: 'error', wxStatus: null, leftFee: null, reason: 'refund_query_failed' }
  }
  if (data.errcode !== 0 || !data.order || typeof data.order.status !== 'number') {
    await diagnoseOnce(deps.prisma, deps.audit, order, 'refund_query_failed')
    return { kind: 'error', wxStatus: null, leftFee: null, reason: 'refund_query_failed' }
  }
  const wxEnv = mapEnvType(data.order.env_type)
  if (wxEnv !== null && wxEnv !== order.env) {
    await diagnoseOnce(deps.prisma, deps.audit, order, 'env_mismatch')
    return { kind: 'error', wxStatus: data.order.status, leftFee: data.order.left_fee ?? null, reason: 'env_mismatch' }
  }

  const wxStatus = data.order.status
  const leftFee = typeof data.order.left_fee === 'number' ? data.order.left_fee : null

  if (wxStatus === WECHAT_VPAY_STATUS_REFUND_SUCCEEDED) {
    await settleVirtualPayRefundSucceeded(deps.prisma, deps.audit, {
      orderId: order.id,
      outTradeNo: order.outTradeNo,
      refundOrderId: order.refundOrderId,
      wxRefundId: data.order.wx_refund_id ?? order.wxRefundId,
      source: deps.source,
    })
    return { kind: 'refunded', wxStatus, leftFee }
  }

  if (wxStatus === WECHAT_VPAY_STATUS_REFUND_FAILED) {
    await markVirtualPayRefundFailed(
      deps.prisma,
      deps.audit,
      { redis: deps.redis, logger: deps.logger, fetchImpl },
      {
        orderId: order.id,
        outTradeNo: order.outTradeNo,
        reason: `refund_query_failed_status_${wxStatus}`,
        source: deps.source,
        extra: { wxStatus, leftFee },
      },
    )
    return { kind: 'refund_failed', wxStatus, leftFee }
  }

  if (wxStatus === WECHAT_VPAY_STATUS_REFUND_DEDUCTED) {
    return { kind: 'refunding', wxStatus, leftFee }
  }

  if (wxStatus === WECHAT_VPAY_STATUS_CLOSED) {
    await diagnoseOnce(deps.prisma, deps.audit, order, 'refund_query_order_closed_6')
    await sendVirtualPayOpsAlert({
      redis: deps.redis,
      fetchImpl,
      outTradeNo: order.outTradeNo,
      episodeToken: 'refund_query_order_closed_6',
      type: 'virtual_pay_refund_failed',
      severity: 'error',
      title: `小程序虚拟支付退款中查单见关单态 ${order.outTradeNo}（status=6，需人工核查）`,
      logger: deps.logger,
    })
    return { kind: 'unchanged', wxStatus, leftFee, reason: 'refund_query_order_closed_6' }
  }

  if (PAID_STATUSES.has(wxStatus)) {
    // 已发过退款的单查到旧支付态 2/3/4：严禁改回 paid 或解锁权益，防超时请求随后完成造成双损。
    await diagnoseOnce(deps.prisma, deps.audit, order, `refund_query_still_paid_${wxStatus}`)
    return { kind: 'refunding', wxStatus, leftFee }
  }

  await diagnoseOnce(deps.prisma, deps.audit, order, `refund_query_unexpected_status_${wxStatus}`)
  return { kind: 'unchanged', wxStatus, leftFee }
}

export interface AdminSyncOrderRow extends RefundingOrderRow {
  status: string
}

/**
 * 管理员单笔主动同步（非 refunding 状态）。
 * - 仅微信官方 status === 8（用户侧收款完成）可收敛为 refunded；
 * - status === 5（商户侧扣款完成）转入/保持 refunding 并锁权益；
 * - 已发过退款的单查到旧支付态 2/3/4 严禁恢复 paid 或解锁权益回 available。
 */
export async function syncNonRefundingOrderWithWechat(
  deps: {
    prisma: PrismaService
    audit: AuditService
    appKey: string
    token: string
    fetchImpl: typeof fetch
    timeoutMs?: number
  },
  order: AdminSyncOrderRow,
): Promise<{ wxStatus: number; leftFee: number | null }> {
  let queried
  try {
    queried = await queryWechatVirtualPayOrder({
      openId: order.openId!,
      env: order.env,
      orderId: order.outTradeNo,
      appKey: deps.appKey,
      token: deps.token,
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.timeoutMs,
    })
  } catch {
    throw new BadGatewayException({
      error: { code: 'VPAY_QUERY_FAILED', message: '向微信同步查单失败，请稍后重试' },
    })
  }
  if (queried.errcode !== 0 || !queried.order || typeof queried.order.status !== 'number') {
    throw new BadGatewayException({
      error: { code: 'VPAY_QUERY_FAILED', message: '向微信同步查单未返回有效订单状态' },
    })
  }
  const wxEnv = mapEnvType(queried.order.env_type)
  if (wxEnv !== null && wxEnv !== order.env) {
    throw new ConflictException({
      error: { code: 'VPAY_ENV_MISMATCH', message: '微信订单环境与本地记录不一致' },
    })
  }
  const wxStatus = queried.order.status
  const leftFee = typeof queried.order.left_fee === 'number' ? queried.order.left_fee : null

  if (order.status === 'pending' && PAID_STATUSES.has(wxStatus) && typeof queried.order.paid_fee === 'number' && wxEnv !== null) {
    const res = await confirmPaid(deps.prisma, {
      outTradeNo: order.outTradeNo,
      openId: order.openId!,
      env: wxEnv,
      priceCents: queried.order.paid_fee,
      wxOrderId: queried.order.wx_order_id || null,
      paidAt: queried.order.paid_time && queried.order.paid_time > 0 ? new Date(queried.order.paid_time * 1000) : null,
    })
    if (res.ok && res.granted && NEED_NOTIFY_PROVIDE_STATUSES.has(wxStatus)) {
      await notifyWechatProvideGoods({
        orderId: order.outTradeNo,
        env: order.env,
        token: deps.token,
        fetchImpl: deps.fetchImpl,
        timeoutMs: deps.timeoutMs,
      })
    }
  } else if (order.status === 'pending' && wxStatus === WECHAT_VPAY_STATUS_CLOSED) {
    await deps.prisma.virtualPayOrder.updateMany({
      where: { id: order.id, status: 'pending' },
      data: { status: 'closed', lastDiagnosticReason: 'order_closed' },
    })
  } else if (
    order.status === 'pending' &&
    (wxStatus === WECHAT_VPAY_STATUS_REFUND_DEDUCTED || wxStatus === WECHAT_VPAY_STATUS_REFUND_SUCCEEDED)
  ) {
    await deps.prisma.virtualPayOrder.updateMany({
      where: { id: order.id, status: 'pending' },
      data: { status: 'closed', lastDiagnosticReason: 'refunded_before_grant' },
    })
  } else if (order.status === 'refund_failed' || order.status === 'paid') {
    if (wxStatus === WECHAT_VPAY_STATUS_REFUND_SUCCEEDED) {
      await settleVirtualPayRefundSucceeded(deps.prisma, deps.audit, {
        orderId: order.id,
        outTradeNo: order.outTradeNo,
        refundOrderId: order.refundOrderId,
        wxRefundId: queried.order.wx_refund_id ?? order.wxRefundId,
        source: 'admin_sync',
      })
    } else if (wxStatus === WECHAT_VPAY_STATUS_REFUND_DEDUCTED) {
      await deps.prisma.$transaction(async (tx) => {
        await tx.virtualPayOrder.updateMany({
          where: { id: order.id, status: order.status },
          data: { status: 'refunding', lastDiagnosticReason: null },
        })
        await tx.memberServiceCredit.updateMany({
          where: { sourceOrderId: order.id, status: 'available' },
          data: { status: 'refunding' },
        })
      })
    } else if (wxStatus === WECHAT_VPAY_STATUS_CLOSED) {
      await diagnoseOnce(deps.prisma, deps.audit, order, 'refund_query_order_closed_6')
    } else if (order.refundOrderId && PAID_STATUSES.has(wxStatus)) {
      // 严禁根据旧支付态 2/3/4 改回 paid 或解锁权益回 available，避免与先前在途/晚到退款冲突。
      await diagnoseOnce(deps.prisma, deps.audit, order, `refund_query_still_paid_${wxStatus}`)
    }
  }
  return { wxStatus, leftFee }
}
