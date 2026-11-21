/**
 * P2b9d 第 7 条：ABNORMAL 满 24 小时提示与查询收口闭环对齐（agy #5）。
 * - 已记 refund.channel_abnormal 且满 24 小时的单，detail.channelResultRegistration.abnormal === true，
 *   非 ABNORMAL 满 24 小时的单 abnormal === false。
 * - registerChannelResult 遇渠道仍返 abnormal，拒绝 REFUND_CHANNEL_ABNORMAL 且提示引导「向渠道查询结果」收口。
 * - 商户在微信商户平台完成异常退款后，渠道流转为 SUCCESS，调 queryPrintReturnChannel 安全收口为 refunded。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { queryPrintReturnChannel } from '../../src/payment/query-print-return-channel'
import { parkAbnormalChannelRefund } from '../../src/payment/refund-abnormal'
import { registerChannelResult } from '../../src/payment/refund-channel-registration'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const DAY = 24 * 60 * 60 * 1000

function rejection(error: unknown): { code: string; message: string } {
  if (!(error instanceof BadRequestException)) return { code: error instanceof Error ? error.message : 'error', message: '' }
  const body = error.getResponse() as { error?: { code?: string; message?: string } } | string
  if (typeof body === 'string') return { code: body, message: '' }
  return { code: body?.error?.code ?? error.message, message: body?.error?.message ?? '' }
}

export async function runP2b9dAbnormal24hCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9d7_${tag}`
  const terminalId = `term_p2b9d7_${tag}`
  await db.organization.create({ data: { id: orgId, name: '异常满24小时闭环', type: 'school_employment_center' } })
  await db.terminal.create({
    data: { id: terminalId, terminalCode: terminalId, agentToken: `tok-${terminalId}`, deviceFingerprint: `fp-${terminalId}`, orgId, enabled: true, lifecycleStatus: 'active' },
  })
  const created: string[] = []
  const seed = async (label: string) => {
    const id = `ord_${tag}_p2b9d7_${label}`
    const taskId = `pt_${id}`
    const orderNo = `P9D7${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    const refundNo = `RFD-${orderNo}`
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: { id: taskId, fileUrl: 'https://example.invalid/print', fileMd5: 'md5', status: 'failed', errorCode: 'PAPER_JAM', printOutcome: 'not_printed', orderId: id, terminalId },
    })
    await db.order.create({
      data: {
        id, orderNo, type: 'print', terminalId, amountCents: 200, discountCents: 0, payStatus: 'refunding', paymentSource: 'wechat',
        paidAt: new Date(Date.now() - 2 * DAY), pickupStatus: 'pending', taskStatus: 'failed', billablePages: 2,
        printParamsJson: PAGES, itemsJson: '[]', channel: 'kiosk', printTaskId: taskId,
      },
    })
    const submitted = new Date(Date.now() - DAY - 60_000)
    const refund = await db.refund.create({
      data: { orderId: id, refundNo, amountCents: 200, status: 'pending', reason: '没出纸先退', channel: 'wechat', createdAt: submitted, channelSubmittedAt: submitted },
    })
    return { id, orderNo, refundId: refund.id, refundNo }
  }

  try {
    const abn = await seed('abn')
    const plain = await seed('plain')
    await parkAbnormalChannelRefund(db, {
      refundId: abn.refundId,
      refundNo: abn.refundNo,
      orderId: abn.id,
      channelRefundNo: 'WX-ABN-24H',
      source: 'notify',
    })
    const readonly = new AdminOrdersReadonlyService(db)
    const abnDetail = await readonly.getById(abn.id)
    assert.equal(abnDetail.channelResultRegistration?.refundNo, abn.refundNo)
    assert.equal(abnDetail.channelResultRegistration?.abnormal, true, '已记 refund.channel_abnormal 必须向前端标明 abnormal=true')
    const plainDetail = await readonly.getById(plain.id)
    assert.equal(plainDetail.channelResultRegistration?.abnormal, false, '非 ABNORMAL 满 24h 单 abnormal=false')

    const err = await registerChannelResult(db, abn.id, {
      refundNo: abn.refundNo,
      result: 'not_refunded',
      note: '商户平台仍在异常中',
      confirmOrderNo: abn.orderNo,
    }, 'admin-p2b9d', {
      supportsQuery: () => true,
      channelQuery: async () => 'abnormal',
    }).then(() => null, rejection)
    assert.equal(err?.code, 'REFUND_CHANNEL_ABNORMAL')
    assert.match(err?.message ?? '', /向渠道查询结果/, '拒绝文案应引导先在微信商户平台完成异常退款再点查询收口')

    // 商户处理完异常退款后，微信查单流转为 SUCCESS，点「向渠道查询结果」自动收口。
    const settled = await queryPrintReturnChannel(db, abn.id, 'admin-p2b9d', async () => ({
      verdict: 'success',
      refundAmountCents: 200,
      channelRefundNo: 'WX-ABN-24H',
    }))
    assert.equal(settled.outcome, 'refunded')
    assert.equal(settled.payStatus, 'refunded')
    assert.equal(settled.refundStatus, 'success')
    assert.equal(settled.channelInFlight, false)
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
