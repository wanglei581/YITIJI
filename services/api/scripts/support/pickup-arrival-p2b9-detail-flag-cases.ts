/**
 * 后台订单详情的 channelInFlight 和服务端三步处置用同一个判断（第 6 条）。
 * - 渠道受理过、记成待人工：true；三步也确实不放行。
 * - 窗口关闭后本地停放的待人工（渠道没受理过）：false；三步照常。
 * - 两笔退款里有一笔还在途：true（第 2 条：任何一笔在途都算）。
 * - 在途那笔有了明确答复之后：false。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { parkClosedWindowUnprinted } from '../../src/payment/closed-window-unprinted'
import { resolvePrintReturnHold } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } } | string
  if (typeof body === 'string') return body
  return body?.error?.code ?? error.message
}

export async function runP2b9DetailFlagCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9df_${tag}`
  const terminalId = `term_p2b9df_${tag}`
  await db.organization.create({ data: { id: orgId, name: '渠道在途标记', type: 'school_employment_center' } })
  await db.terminal.create({
    data: { id: terminalId, terminalCode: terminalId, agentToken: `tok-${terminalId}`, deviceFingerprint: `fp-${terminalId}`, orgId, enabled: true, lifecycleStatus: 'active' },
  })
  const created: string[] = []
  const detail = (orderId: string) => new AdminOrdersReadonlyService(db).getById(orderId)
  const seed = async (label: string, payStatus = 'refunding'): Promise<string> => {
    const id = `ord_${tag}_p2b9df_${label}`
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(`pt_${id}`)
    await db.printTask.create({
      data: { id: `pt_${id}`, fileUrl: 'https://example.invalid/print', fileMd5: 'md5', status: 'failed', errorCode: 'PAPER_JAM', printOutcome: 'not_printed', orderId: id, terminalId },
    })
    await db.order.create({
      data: {
        id, orderNo: `P9DF${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32), type: 'print', terminalId, amountCents: 200, discountCents: 0,
        payStatus, paymentSource: 'wechat', paidAt: new Date(Date.now() - 60 * 60 * 1000), pickupStatus: 'expired',
        pickupCodeExpiresAt: new Date(Date.now() - 60_000), taskStatus: 'failed', billablePages: 2, printParamsJson: PAGES,
        itemsJson: '[]', channel: 'kiosk', printTaskId: `pt_${id}`,
      },
    })
    return id
  }
  const refund = (orderId: string, suffix: string, status: string, submitted: boolean, minutesAgo: number) => db.refund.create({
    data: {
      orderId,
      refundNo: `RFD-P9DF-${tag}-${suffix}`.slice(0, 48),
      amountCents: 200,
      status,
      reason: '渠道金额对不上',
      channel: 'wechat',
      createdAt: new Date(Date.now() - minutesAgo * 60 * 1000),
      ...(submitted ? { channelSubmittedAt: new Date(Date.now() - minutesAgo * 60 * 1000) } : {}),
    },
  })

  try {
    // 渠道受理过、记成待人工：true，三步确实不放行。
    const channelManual = await seed('chm')
    await refund(channelManual, 'chm', 'manual_review', true, 40)
    assert.equal((await detail(channelManual)).channelInFlight, true, '渠道受理过的待人工要标成在途')
    assert.equal((await detail(channelManual)).refundStatus, 'manual_review', '退款状态是待人工，按钮不能靠它猜')
    const blocked = await resolvePrintReturnHold(db, channelManual, 'release_paper', 'admin-test')
      .then(() => 'ok', (error: unknown) => errorCode(error))
    assert.equal(blocked, 'REFUND_CHANNEL_UNCONFIRMED')

    // 窗口关闭后本地停放：false，三步照常。
    const windowLocal = await seed('win', 'paid')
    assert.equal(await parkClosedWindowUnprinted(db, windowLocal, async () => undefined), 'manual')
    const localDetail = await detail(windowLocal)
    assert.equal(localDetail.channelInFlight, false, '本地停放的待人工不是在途')
    assert.equal(localDetail.refundStatus, 'manual_review')
    assert.equal((await resolvePrintReturnHold(db, windowLocal, 'release_paper', 'admin-test')).refundStatus, 'withdrawn')

    // 两笔退款，较早一笔已失败、较晚一笔还在途：true。
    const two = await seed('two')
    await refund(two, 'two-a', 'failed', true, 60)
    await refund(two, 'two-b', 'pending', true, 20)
    assert.equal((await detail(two)).channelInFlight, true, '任何一笔在途都算')
    // 在途那笔有了明确答复（失败）之后：false。
    const answered = await resolvePrintReturnHold(db, two, 'close_order', 'admin-test', async () => 'failed')
    assert.equal(answered.payStatus, 'closed')
    assert.equal((await detail(two)).channelInFlight, false, '全部落定后不再是在途')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
