/**
 * 微信退款异常（ABNORMAL）不当失败。
 *
 * 官方说明（2026-11-19 打开核对，下面是要点，不是原文）：
 * - 查询单笔退款的退款状态取值：ABNORMAL 指原路退到用户银行卡时卡已作废或冻结、退不进去，
 *   要到商户平台交易中心手动处理，或调用发起异常退款接口。
 *   https://pay.weixin.qq.com/doc/v3/merchant/4012791884
 * - 退款结果回调通知：refund_status 取值同上，另有 REFUND.ABNORMAL 退款异常通知。
 *   https://pay.weixin.qq.com/doc/v3/merchant/4012791886
 * - 订单退款开发指引的「发起异常退款」一节：退款异常时资金停在微信侧退款中间账户。
 *   https://pay.weixin.qq.com/doc/v3/merchant/4013071031
 *
 * 所以钱已经离开商户、停在渠道中间账户，不是没退出去：不记 failed、不回滚订单、不放行出纸。
 * 退款行状态保持不动（处理中的仍是处理中），这样商户处理完异常退款后，渠道的退成通知与收敛照常完成；
 * 已经落定成失败、撤回、关单的行和渠道答复矛盾，改回待人工。每笔只记一次诊断，并告警。
 */
import type { PrismaService } from '../prisma/prisma.service'
import { notifyPrintReturnHold } from './print-return-alert'

export const CHANNEL_ABNORMAL_AUDIT = 'refund.channel_abnormal'
export const CHANNEL_ABNORMAL_DETAIL =
  '渠道说退款异常：资金在渠道中间账户，需按渠道异常退款流程处理（商户平台手动处理，或调用发起异常退款）。处理完渠道会答复退成。'

const SETTLED_NOT_PAID = new Set(['failed', 'withdrawn', 'closed'])

export function isChannelAbnormal(result: { refundState?: string | null } | null | undefined): boolean {
  return result?.refundState === 'ABNORMAL'
}

export async function parkAbnormalChannelRefund(
  db: PrismaService,
  input: {
    refundId: string
    refundNo: string
    orderId: string
    channelRefundNo: string | null
    source: 'notify' | 'query' | 'refund' | 'hold'
  },
): Promise<void> {
  const row = await db.refund.findUnique({
    where: { id: input.refundId },
    select: { status: true, channelSubmittedAt: true, channelRefundNo: true },
  })
  if (!row || row.status === 'success') return
  const data: { status?: string; channelSubmittedAt?: Date; channelRefundNo?: string } = {}
  if (SETTLED_NOT_PAID.has(row.status)) data.status = 'manual_review'
  // 渠道既然答复了退款异常，就是受理过。没记过的补上，三步与核验出纸据此挡住。
  if (!row.channelSubmittedAt) data.channelSubmittedAt = new Date()
  if (input.channelRefundNo && !row.channelRefundNo) data.channelRefundNo = input.channelRefundNo
  if (Object.keys(data).length > 0) {
    await db.refund.updateMany({ where: { id: input.refundId, status: row.status }, data })
  }
  const seen = await db.auditLog.findFirst({
    where: { targetId: input.orderId, action: CHANNEL_ABNORMAL_AUDIT, payloadJson: { contains: input.refundNo } },
    select: { id: true },
  })
  if (!seen) {
    await db.auditLog.create({
      data: {
        actorId: null,
        actorRole: 'system',
        action: CHANNEL_ABNORMAL_AUDIT,
        targetType: 'order',
        targetId: input.orderId,
        payloadJson: JSON.stringify({
          refundNo: input.refundNo,
          channelRefundNo: input.channelRefundNo,
          source: input.source,
          detail: CHANNEL_ABNORMAL_DETAIL,
        }),
      },
    })
  }
  await notifyPrintReturnHold(db, input.orderId)
}
