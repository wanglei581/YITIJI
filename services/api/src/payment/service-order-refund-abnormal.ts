/**
 * AI 服务单微信退款异常（ABNORMAL）处理与退款告警推送（从 service-order.payment.ts 拆出，保 500 行内）。
 * 资金停在微信退款中间账户，不当失败：不递增 refundAttempts、不置 refundChannelState='failed'、
 * 不置 refund_failed；保留 refundChannelState='processing'（后续走 queryRefund 收敛），
 * 写入中间账户诊断（refundAnomaly）与审计，并触发运维告警。
 */
import { deliverOpsAlert } from '../admin-ops/admin-alert-push.service'
import type { AuditService } from '../audit/audit.service'
import type { PrismaService } from '../prisma/prisma.service'
import { CHANNEL_ABNORMAL_DETAIL } from './refund-abnormal'
import { SERVICE_REFUND_BACKOFF_MS, SERVICE_REFUND_RETRY_INTERVAL_MS } from './service-order.policy'

export const SERVICE_REFUND_ABNORMAL_AUDIT = 'service_order.refund_abnormal'

export interface ServiceAlertRedis {
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>
  del(key: string): Promise<number>
}

export async function deliverServiceRefundAlert(
  redis: ServiceAlertRedis | null,
  orderId: string,
  episodeToken: string,
  opts?: { type?: string; title?: string },
): Promise<void> {
  if (!redis) return
  try {
    await deliverOpsAlert({
      redis,
      webhook: process.env['ALERT_WEBHOOK_URL']?.trim() || null,
      fetchImpl: fetch,
      alert: {
        subjectKey: `service-order:${orderId}`,
        episodeToken,
        type: opts?.type ?? 'service_order_refund_failed',
        severity: 'error',
        title: opts?.title ?? '服务单退款失败',
        terminalCode: null,
      },
      state: 'firing',
    })
  } catch {
    // 告警失败不改变退款状态。
  }
}

export async function noteServiceRefundAbnormal(
  db: PrismaService,
  audit: AuditService,
  redis: ServiceAlertRedis | null,
  existing: {
    id: string
    refundNo: string | null
    channelRefundNo: string | null
    refundProcessingTries: number
  },
  input: { channelRefundNo?: string | null; source: 'refund' | 'query' | 'notify' },
): Promise<'refunding'> {
  const index = Math.min(existing.refundProcessingTries, SERVICE_REFUND_BACKOFF_MS.length - 1)
  const wait = SERVICE_REFUND_BACKOFF_MS[index] ?? SERVICE_REFUND_RETRY_INTERVAL_MS
  await db.serviceOrder.updateMany({
    where: { id: existing.id, status: { in: ['refunding', 'refund_failed'] } },
    data: {
      status: 'refunding',
      refundChannelState: 'processing',
      refundAnomaly: CHANNEL_ABNORMAL_DETAIL,
      refundProcessingTries: { increment: 1 },
      nextRefundAt: new Date(Date.now() + wait),
      refundLeaseUntil: null,
      ...(input.channelRefundNo && !existing.channelRefundNo ? { channelRefundNo: input.channelRefundNo } : {}),
    },
  })
  const seen = await db.auditLog.findFirst({
    where: { targetId: existing.id, action: SERVICE_REFUND_ABNORMAL_AUDIT },
    select: { id: true },
  })
  if (!seen) {
    await audit.write({
      actorId: null,
      actorRole: 'system',
      action: SERVICE_REFUND_ABNORMAL_AUDIT,
      targetType: 'service_order',
      targetId: existing.id,
      payload: {
        refundNo: existing.refundNo,
        channelRefundNo: input.channelRefundNo ?? existing.channelRefundNo,
        source: input.source,
        detail: CHANNEL_ABNORMAL_DETAIL,
      },
    })
  }
  await deliverServiceRefundAlert(redis, existing.id, 'refund-abnormal', {
    type: 'service_order_refund_abnormal',
    title: '服务单退款渠道异常（资金在中间账户）',
  })
  return 'refunding'
}
