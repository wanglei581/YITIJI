/**
 * P2b9d 第 2 条：「核对后仍退款」后端双防线守住 channelInFlight（agy #6 + #1 真实二次出款链）。
 * - 非默认单号（RFD-ALT-...）且 channelSubmittedAt != null 的 manual_review 单，
 *   调用 refund(..., { verifiedAfterPaper: true }) 必须被 REFUND_ALREADY_OPEN 拒绝，
 *   provider.refund() 调用次数为 0，原单仍保持 manual_review。
 * - 订单同时存在已提交渠道的过期付款 manual_review（channelSubmittedAt != null）与当前已出纸待退：
 *   放行当前单核对后仍退款时，stage-order-refund 的 channelSubmittedAt: null 守卫必须保住
 *   在途的过期付款 manual_review 不被撤成 withdrawn。
 * - 本地停放（channelSubmittedAt = null）的 manual_review 单：核对后仍退款仍照常撤回并退款。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { AuditService } from '../../src/audit/audit.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider } from '../../src/payment/payment-provider.types'
import { STALE_ATTEMPT_REFUND_REASON } from '../../src/payment/print-no-paper-refund.constants'
import { RefundService } from '../../src/payment/refund.service'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

function errorCode(error: unknown): string {
  if (!(error instanceof BadRequestException)) return error instanceof Error ? error.message : 'error'
  const body = error.getResponse() as { error?: { code?: string } } | string
  if (typeof body === 'string') return body
  return body?.error?.code ?? error.message
}

export async function runP2b9dVerifiedGuardCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9d2_${tag}`
  const terminalId = `term_p2b9d2_${tag}`
  await db.organization.create({ data: { id: orgId, name: '核对后仍退款防二退', type: 'school_employment_center' } })
  await db.terminal.create({
    data: { id: terminalId, terminalCode: terminalId, agentToken: `tok-${terminalId}`, deviceFingerprint: `fp-${terminalId}`, orgId, enabled: true, lifecycleStatus: 'active' },
  })
  const created: string[] = []
  const seed = async (
    label: string,
    refund: { refundNo: string; status: string; reason: string; channelSubmittedAt: Date | null },
  ) => {
    const id = `ord_${tag}_p2b9d2_${label}`
    const taskId = `pt_${id}`
    const orderNo = `P9D2${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: {
        id: taskId,
        fileUrl: 'https://example.invalid/print',
        fileMd5: 'md5',
        status: 'completed',
        printOutcome: 'printed',
        orderId: id,
        terminalId,
      },
    })
    await db.order.create({
      data: {
        id,
        orderNo,
        type: 'print',
        terminalId,
        amountCents: 200,
        discountCents: 0,
        payStatus: 'paid',
        paymentSource: 'wechat',
        paidAt: new Date(Date.now() - 60 * 60 * 1000),
        pickupStatus: 'used',
        taskStatus: 'completed',
        billablePages: 2,
        printParamsJson: PAGES,
        itemsJson: '[]',
        channel: 'kiosk',
        printTaskId: taskId,
      },
    })
    await db.paymentAttempt.create({
      data: {
        id: `pa_${id}`,
        orderId: id,
        channel: 'wechat',
        amountCents: 200,
        status: 'success',
        channelTxnNo: `wxtxn_${tag}_${label}`.slice(0, 64),
        prepayId: `prepay_${id}`.slice(0, 64),
      },
    })
    await db.refund.create({
      data: {
        orderId: id,
        refundNo: refund.refundNo,
        amountCents: 200,
        status: refund.status,
        reason: refund.reason,
        channel: 'wechat',
        channelSubmittedAt: refund.channelSubmittedAt,
      },
    })
    return { id, orderNo, refundNo: refund.refundNo }
  }

  try {
    // 1. 非默认单号 RFD-ALT-... 且 channelSubmittedAt != null 的 manual_review：必须被拒，provider.refund() 调用 0 次。
    let blockedProviderCalls = 0
    const blockedSvc = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([
      {
        channel: 'wechat',
        refund: async () => {
          blockedProviderCalls += 1
          return { status: 'success', channelRefundNo: 'WX-DUP-BAD', refundAmountCents: 200 }
        },
      } as unknown as PaymentProvider,
    ]))
    const altNo = `RFD-ALT-P9D2-${tag}`.slice(0, 48)
    const inFlight = await seed('alt', {
      refundNo: altNo,
      status: 'manual_review',
      reason: '金额不符搁置',
      channelSubmittedAt: new Date(Date.now() - 10 * 60_000),
    })
    const code = await blockedSvc.refund(inFlight.id, {
      reason: '核对后仍退款',
      operatorId: 'admin-p2b9d',
      verifiedAfterPaper: true,
    }).then(() => 'ok', errorCode)
    assert.equal(code, 'REFUND_ALREADY_OPEN', '已提交渠道的 manual_review 不得走核对后仍退款二退')
    assert.equal(blockedProviderCalls, 0, '被拒后 provider.refund() 必须调用 0 次')
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: altNo } })).status, 'manual_review', '原在途单绝不能被撤成 withdrawn')
    assert.equal(await db.refund.count({ where: { orderId: inFlight.id } }), 1, '不得新建第二笔退款单')

    // 2. 订单含已提交渠道的过期付款 manual_review（channelSubmittedAt != null）：
    // 针对当前已出纸单走核对后仍退款时，stage-order-refund 绝不能把已提交渠道的 manual_review 撤成 withdrawn。
    let staleProviderCalls = 0
    const staleSvc = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([
      {
        channel: 'wechat',
        refund: async () => {
          staleProviderCalls += 1
          return { status: 'success', channelRefundNo: 'WX-CUR-200', refundAmountCents: 200 }
        },
      } as unknown as PaymentProvider,
    ]))
    const staleAltNo = `RFD-STALE-ALT-${tag}`.slice(0, 48)
    const withStale = await seed('stale', {
      refundNo: staleAltNo,
      status: 'manual_review',
      reason: STALE_ATTEMPT_REFUND_REASON,
      channelSubmittedAt: new Date(Date.now() - 20 * 60_000),
    })
    const curView = await staleSvc.refund(withStale.id, {
      reason: '核对后仍退当前实付',
      operatorId: 'admin-p2b9d',
      verifiedAfterPaper: true,
    })
    assert.equal(curView.refund.status, 'success')
    assert.equal(staleProviderCalls, 1)
    assert.equal(
      (await db.refund.findUniqueOrThrow({ where: { refundNo: staleAltNo } })).status,
      'manual_review',
      'stage-order-refund 必须加 channelSubmittedAt: null，绝不把已提交渠道的 manual_review 撤成 withdrawn',
    )

    // 3. 本地停放（channelSubmittedAt = null）的 manual_review：核对后仍退款照常撤回旧本地单并完成新退款。
    let localProviderCalls = 0
    const localSvc = new RefundService(db, new AuditService(db), new PaymentProviderRegistry([
      {
        channel: 'wechat',
        refund: async () => {
          localProviderCalls += 1
          return { status: 'success', channelRefundNo: 'WX-LOCAL-200', refundAmountCents: 200 }
        },
      } as unknown as PaymentProvider,
    ]))
    const localAltNo = `RFD-WINDOW-P9D2-${tag}`.slice(0, 48)
    const local = await seed('loc', {
      refundNo: localAltNo,
      status: 'manual_review',
      reason: 'pickup_window_closed_unprinted',
      channelSubmittedAt: null,
    })
    const localView = await localSvc.refund(local.id, {
      reason: '核对后仍退款',
      operatorId: 'admin-p2b9d',
      verifiedAfterPaper: true,
    })
    assert.equal(localView.refund.status, 'success')
    assert.equal(localProviderCalls, 1)
    assert.equal((await db.refund.findUniqueOrThrow({ where: { refundNo: localAltNo } })).status, 'withdrawn')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.paymentAttempt.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
