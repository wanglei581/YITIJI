/**
 * 长期查不到渠道结果时的出路：按商户平台核实结果登记（第 8 条）。
 * - 渠道能查、提交还不到 24 小时：不能登记，详情里也没有登记入口。
 * - 渠道不支持在线查询：在途就能登记；「渠道确认没退出去」记失败、订单回已付，之后改为出纸照常；写审计（操作人、依据）。
 * - 满 24 小时、渠道仍查不到：「渠道已退成」按退款金额记成成功、订单按合计记已退、待打印任务取消。
 * - 满 24 小时但这时渠道答复了退成：按渠道答复记（金额以渠道为准），不用这次登记。
 * - 重输订单号不对、该填的没填、本地停放的待人工：都不登记，状态不变。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { parkClosedWindowUnprinted } from '../../src/payment/closed-window-unprinted'
import { registerChannelResult } from '../../src/payment/refund-channel-registration'
import { resolvePrintReturnHold, type PendingRefundChannelQuery } from '../../src/payment/resolve-print-return-hold'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const DAY = 24 * 60 * 60 * 1000

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } } | string
  if (typeof body === 'string') return body
  return body?.error?.code ?? error.message
}

export async function runP2b9RegistrationCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9rg_${tag}`
  const terminalId = `term_p2b9rg_${tag}`
  await db.organization.create({ data: { id: orgId, name: '按商户平台核实结果登记', type: 'school_employment_center' } })
  await db.terminal.create({
    data: { id: terminalId, terminalCode: terminalId, agentToken: `tok-${terminalId}`, deviceFingerprint: `fp-${terminalId}`, orgId, enabled: true, lifecycleStatus: 'active' },
  })
  const created: string[] = []
  const seed = async (label: string, opts: { channel: string; submittedMsAgo: number | null; status?: string; taskStatus?: string }) => {
    const id = `ord_${tag}_p2b9rg_${label}`
    const orderNo = `P9RG${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    const taskStatus = opts.taskStatus ?? 'failed'
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(`pt_${id}`)
    await db.printTask.create({
      data: { id: `pt_${id}`, fileUrl: 'https://example.invalid/print', fileMd5: 'md5', status: taskStatus, errorCode: taskStatus === 'failed' ? 'PAPER_JAM' : null, printOutcome: taskStatus === 'failed' ? 'not_printed' : null, orderId: id, terminalId },
    })
    await db.order.create({
      data: {
        id, orderNo, type: 'print', terminalId, amountCents: 200, discountCents: 0, payStatus: 'refunding', paymentSource: opts.channel,
        paidAt: new Date(Date.now() - 2 * DAY), pickupStatus: 'expired', pickupCodeExpiresAt: new Date(Date.now() - DAY),
        taskStatus, billablePages: 2, printParamsJson: PAGES, itemsJson: '[]', channel: 'kiosk', printTaskId: `pt_${id}`,
      },
    })
    const refundNo = `RFD-${orderNo}`
    const at = opts.submittedMsAgo === null ? null : new Date(Date.now() - opts.submittedMsAgo)
    await db.refund.create({
      data: { orderId: id, refundNo, amountCents: 200, status: opts.status ?? 'pending', reason: '没出纸先退', channel: opts.channel, createdAt: at ?? new Date(), ...(at ? { channelSubmittedAt: at } : {}) },
    })
    return { id, orderNo, refundNo }
  }
  const register = (
    order: { id: string; orderNo: string; refundNo: string },
    body: { result: string; channelRefundNo?: string; note?: string; confirmOrderNo?: string },
    deps: { supportsQuery: boolean; answer?: Awaited<ReturnType<PendingRefundChannelQuery>> },
  ) => registerChannelResult(db, order.id, {
    refundNo: order.refundNo,
    result: body.result,
    channelRefundNo: body.channelRefundNo,
    note: body.note,
    confirmOrderNo: body.confirmOrderNo ?? order.orderNo,
  }, 'admin-registrar', {
    supportsQuery: () => deps.supportsQuery,
    channelQuery: async () => deps.answer ?? 'unknown',
  }).then((done) => ({ code: 'ok', done }), (error: unknown) => ({ code: errorCode(error), done: null }))
  const detail = (orderId: string) => new AdminOrdersReadonlyService(db).getById(orderId)

  try {
    // 1. 渠道能查、提交还不到 24 小时：不能登记，详情也没有入口。
    const early = await seed('early', { channel: 'wechat', submittedMsAgo: 2 * 60 * 60 * 1000 })
    assert.equal((await detail(early.id)).channelResultRegistration, null)
    assert.equal((await register(early, { result: 'not_refunded', note: '商户平台查无此退款' }, { supportsQuery: true })).code, 'REGISTRATION_TOO_EARLY')
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: early.refundNo } })).status, 'pending')

    // 2. 渠道不支持在线查询（沙箱）：在途就能登记「没退出去」，记失败、订单回已付、之后改为出纸照常。
    const sandbox = await seed('sbx', { channel: 'sandbox', submittedMsAgo: 10 * 60 * 1000 })
    const sandboxEntry = (await detail(sandbox.id)).channelResultRegistration
    assert.equal(sandboxEntry?.refundNo, sandbox.refundNo, '不支持在线查询的在途退款要给登记入口')
    assert.equal((await register(sandbox, { result: 'not_refunded', note: '商户平台查无此退款', confirmOrderNo: 'WRONG-NO' }, { supportsQuery: false })).code, 'REGISTRATION_ORDER_NO_MISMATCH')
    assert.equal((await register(sandbox, { result: 'not_refunded', note: '短' }, { supportsQuery: false })).code, 'REGISTRATION_INPUT_REQUIRED')
    assert.equal((await register(sandbox, { result: 'refunded' }, { supportsQuery: false })).code, 'REGISTRATION_INPUT_REQUIRED')
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: sandbox.refundNo } })).status, 'pending', '没登记成的不改状态')
    const notOut = await register(sandbox, { result: 'not_refunded', note: '商户平台查无此退款，确认没有出款' }, { supportsQuery: false })
    assert.equal(notOut.code, 'ok')
    assert.equal(notOut.done?.recordedBy, 'registration')
    assert.equal(notOut.done?.refundStatus, 'failed')
    assert.equal(notOut.done?.payStatus, 'paid')
    const audit = await db.auditLog.findFirst({ where: { targetId: sandbox.id, action: 'refund.channel_result_registered' } })
    assert.match(audit?.payloadJson ?? '', /"operatorId":"admin-registrar"/)
    assert.match(audit?.payloadJson ?? '', /按商户平台核实结果登记/)
    assert.equal((await detail(sandbox.id)).channelInFlight, false)
    const released = await resolvePrintReturnHold(db, sandbox.id, 'release_paper', 'admin-test')
    assert.equal(released.refundStatus, 'withdrawn', '登记没退出去之后三步照常')
    assert.equal(released.taskStatus, 'pending')

    // 3. 满 24 小时、渠道仍查不到：登记「已退成」按退款金额记成成功，订单按合计记已退，待打印任务取消。
    const stale = await seed('day', { channel: 'wechat', submittedMsAgo: DAY + 60_000, taskStatus: 'pending' })
    assert.equal((await detail(stale.id)).channelResultRegistration?.refundNo, stale.refundNo)
    const paid = await register(stale, { result: 'refunded', channelRefundNo: 'WX-PLATFORM-200' }, { supportsQuery: true, answer: 'unknown' })
    assert.equal(paid.code, 'ok')
    assert.equal(paid.done?.recordedBy, 'registration')
    assert.equal(paid.done?.refundStatus, 'success')
    assert.equal(paid.done?.payStatus, 'refunded')
    const staleRefund = await db.refund.findUniqueOrThrow({ where: { refundNo: stale.refundNo } })
    assert.equal(staleRefund.channelRefundNo, 'WX-PLATFORM-200')
    assert.equal((await db.order.findUniqueOrThrow({ where: { id: stale.id } })).refundedAmountCents, 200)
    assert.equal((await db.printTask.findUniqueOrThrow({ where: { id: `pt_${stale.id}` } })).status, 'cancelled')

    // 4. 满 24 小时但渠道这时答复了退成（150）：按渠道答复记，不用这次登记。
    const answered = await seed('ans', { channel: 'wechat', submittedMsAgo: DAY + 60_000, status: 'manual_review' })
    const byChannel = await register(answered, { result: 'refunded', channelRefundNo: 'WX-ADMIN-TYPED' }, {
      supportsQuery: true,
      answer: { verdict: 'success', refundAmountCents: 150, channelRefundNo: 'WX-CHANNEL-150' },
    })
    assert.equal(byChannel.code, 'ok')
    assert.equal(byChannel.done?.recordedBy, 'channel')
    assert.equal(byChannel.done?.amountCents, 150, '金额以渠道答复为准')
    assert.equal(byChannel.done?.payStatus, 'partial_refunded')
    assert.equal(await db.auditLog.count({ where: { targetId: answered.id, action: 'refund.channel_result_registered' } }), 0)
    // 渠道还在处理、退款异常：不能登记。
    const busy = await seed('busy', { channel: 'wechat', submittedMsAgo: DAY + 60_000 })
    assert.equal((await register(busy, { result: 'not_refunded', note: '商户平台查无此退款' }, { supportsQuery: true, answer: 'processing' })).code, 'REFUND_CHANNEL_UNCONFIRMED')
    assert.equal((await register(busy, { result: 'not_refunded', note: '商户平台查无此退款' }, { supportsQuery: true, answer: 'abnormal' })).code, 'REFUND_CHANNEL_ABNORMAL')
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: busy.refundNo } })).status, 'pending')

    // 5. 本地停放的待人工（渠道没受理过）：不在途，不用登记。
    const local = await seed('loc', { channel: 'wechat', submittedMsAgo: null, status: 'failed' })
    await db.order.update({ where: { id: local.id }, data: { payStatus: 'paid' } })
    assert.equal(await parkClosedWindowUnprinted(db, local.id, async () => undefined), 'manual')
    const window = await db.refund.findFirstOrThrow({ where: { orderId: local.id, refundNo: { startsWith: 'RFD-WINDOW-' } } })
    assert.equal((await detail(local.id)).channelResultRegistration, null)
    assert.equal((await register({ ...local, refundNo: window.refundNo }, { result: 'not_refunded', note: '商户平台查无此退款' }, { supportsQuery: false })).code, 'REGISTRATION_NOT_IN_FLIGHT')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
