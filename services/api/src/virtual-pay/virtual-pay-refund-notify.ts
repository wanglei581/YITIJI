import type { Logger } from '@nestjs/common'
import type { AuditService } from '../audit/audit.service'
import type { PrismaService } from '../prisma/prisma.service'
import type { VirtualPayAlertRedis } from './virtual-pay-alert'
import { VIRTUAL_PAY_DIAGNOSTIC_ACTION } from './virtual-pay-order.service'
import {
  markVirtualPayRefundFailed,
  settleVirtualPayRefundSucceeded,
} from './virtual-pay-xpay-refund'

export const VIRTUAL_PAY_REFUND_EVENT = 'xpay_refund_notify'

export interface ParsedRefundNotify {
  mchOrderId: string | null
  wxOrderId: string | null
  mchRefundId: string
  wxRefundId: string | null
  refundFee: number
  retCode: number
  retMsg: string | null
  finishedAt: Date | null
}

function readString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function readInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
  }
  return null
}

export function parseVirtualPayRefundNotify(payload: Record<string, unknown>): ParsedRefundNotify | null {
  const mchOrderId = readString(payload['MchOrderId'])
  const wxOrderId = readString(payload['WxOrderId'])
  const mchRefundId = readString(payload['MchRefundId'])
  const wxRefundId = readString(payload['WxRefundId'])
  const refundFee = readInt(payload['RefundFee'])
  const retCode = readInt(payload['RetCode'])
  const retMsg = readString(payload['RetMsg'])
  const finishTs = readInt(payload['RefundFinishTimestamp'])
  if ((!mchOrderId && !wxOrderId) || !mchRefundId || refundFee == null || retCode == null) {
    return null
  }
  return {
    mchOrderId,
    wxOrderId,
    mchRefundId,
    wxRefundId,
    refundFee,
    retCode,
    retMsg,
    finishedAt: finishTs != null && finishTs > 0 ? new Date(finishTs * 1000) : null,
  }
}

/**
 * 处理微信 xpay_refund_notify 推送（已通过安全模式 msg_signature 验签、AES 解密与 AppID 校验）。
 * 核对表 5.5、5.6。
 */
export async function handleVirtualPayRefundNotify(
  deps: {
    prisma: PrismaService
    audit: AuditService
    redis?: VirtualPayAlertRedis | null
    logger?: Pick<Logger, 'warn'>
  },
  payload: Record<string, unknown>,
): Promise<void> {
  const notice = parseVirtualPayRefundNotify(payload)
  if (!notice) {
    await diagnose(deps.audit, 'refund_notify_incomplete', readString(payload['MchOrderId']))
    return
  }

  const order = notice.mchOrderId
    ? await deps.prisma.virtualPayOrder.findUnique({ where: { outTradeNo: notice.mchOrderId } })
    : await deps.prisma.virtualPayOrder.findFirst({ where: { wxOrderId: notice.wxOrderId ?? undefined } })
  if (!order) {
    await diagnose(deps.audit, 'refund_order_missing', notice.mchOrderId)
    return
  }

  if (notice.mchOrderId && order.outTradeNo !== notice.mchOrderId) {
    await diagnose(deps.audit, 'refund_order_mismatch', order.outTradeNo)
    return
  }
  if (notice.wxOrderId && order.wxOrderId && order.wxOrderId !== notice.wxOrderId) {
    await diagnose(deps.audit, 'refund_wx_order_mismatch', order.outTradeNo)
    return
  }
  if (order.refundOrderId != null && order.refundOrderId !== notice.mchRefundId) {
    await diagnose(deps.audit, 'refund_id_mismatch', order.outTradeNo)
    return
  }
  if (order.refundOrderId == null && order.status !== 'paid') {
    await diagnose(deps.audit, 'refund_id_mismatch', order.outTradeNo)
    return
  }
  if (notice.refundFee !== order.priceCents) {
    await diagnose(deps.audit, 'refund_amount_mismatch', order.outTradeNo)
    return
  }

  if (notice.retCode === 0) {
    await settleVirtualPayRefundSucceeded(deps.prisma, deps.audit, {
      orderId: order.id,
      outTradeNo: order.outTradeNo,
      refundOrderId: notice.mchRefundId,
      wxRefundId: notice.wxRefundId,
      refundedAt: notice.finishedAt ?? new Date(),
      source: 'notify',
    })
    return
  }

  await markVirtualPayRefundFailed(
    deps.prisma,
    deps.audit,
    { redis: deps.redis, logger: deps.logger },
    {
      orderId: order.id,
      outTradeNo: order.outTradeNo,
      reason: `refund_notify_failed_${notice.retCode}`,
      source: 'notify',
      extra: {
        retCode: notice.retCode,
        retMsg: notice.retMsg ? notice.retMsg.slice(0, 120) : null,
        mchRefundId: notice.mchRefundId,
        wxRefundId: notice.wxRefundId,
      },
    },
  )
}

function diagnose(audit: AuditService, reason: string, outTradeNo: string | null): Promise<string | null> {
  return audit.write({
    actorId: null,
    actorRole: 'system',
    action: VIRTUAL_PAY_DIAGNOSTIC_ACTION,
    targetType: 'virtual_pay_order',
    targetId: outTradeNo,
    payload: { reason },
  })
}
