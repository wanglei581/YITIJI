/**
 * 看价不占终端、本机价 0 免费放行、非法价拒绝、到机重算清掉旧抵扣、
 * 行数对不上不写、过期尝试的迟到扣款按尝试金额原路退。
 */
import assert from 'node:assert/strict'
import { BadRequestException } from '@nestjs/common'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { AuditService } from '../../src/audit/audit.service'
import { getEffectiveUserPrices } from '../../src/payment/effective-user-prices'
import { OnlinePaymentService } from '../../src/payment/online-payment.service'
import { OrderStatusService } from '../../src/payment/order-status.service'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { createPaymentSessionToken } from '../../src/payment/payment-session-token'
import { SandboxPaymentProvider } from '../../src/payment/providers/sandbox-payment.provider'
import { staleCollectedRefundReason } from '../../src/payment/print-return-disposition'
import { staleAttemptRefundNo } from '../../src/payment/print-no-paper-refund.constants'
import type { PrismaService } from '../../src/prisma/prisma.service'
import { ARRIVAL_REPRICE_AUDIT, applyArrivalReprice, settlePickupArrival } from '../../src/print-jobs/pickup-arrival-price'
import { bindArrivalPaymentTerminal, releaseArrivalPaymentHold } from '../../src/print-jobs/pickup-arrival-hold'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })
const SANDBOX_SECRET = 'verify-pickup-arrival-hold-sandbox-secret-0123456789'

function ensurePaymentSecret(): void {
  const current = process.env['PAYMENT_SESSION_SECRET']
  if (!current || current.length < 32) {
    process.env['PAYMENT_SESSION_SECRET'] = 'verify-pickup-arrival-payment-session-secret-32'
  }
}

export async function runArrivalHoldCases(
  db: PrismaService,
  input: {
    tag: string
    pricedTerminalId: string
    zeroTerminalId: string
    publicTerminalId: string
    otherTerminalId: string
    orderIds: string[]
  },
): Promise<void> {
  ensurePaymentSecret()
  let seq = 0
  const createOrder = async (data: {
    amountCents: number
    payStatus: string
    paymentSource?: string | null
    terminalId?: string | null
    discountCents?: number
    billablePages?: number | null
    printParamsJson?: string
  }): Promise<string> => {
    seq += 1
    const id = `ord_${input.tag}_hold${seq}`
    await db.order.create({
      data: {
        id,
        orderNo: `NO${input.tag}H${seq}`.slice(0, 40),
        type: 'print',
        terminalId: data.terminalId === undefined ? null : data.terminalId,
        amountCents: data.amountCents,
        discountCents: data.discountCents ?? 0,
        payStatus: data.payStatus,
        paymentSource: data.paymentSource ?? null,
        paidAt: data.payStatus === 'paid' ? new Date('2026-11-17T03:00:00Z') : null,
        pickupStatus: 'pending',
        taskStatus: data.payStatus === 'paid' ? 'pending' : 'awaiting_payment',
        billablePages: data.billablePages === undefined ? 2 : data.billablePages,
        printParamsJson: data.printParamsJson ?? PAGES,
        itemsJson: '[]',
        channel: 'miniapp_cloud',
      },
    })
    input.orderIds.push(id)
    return id
  }

  const switchId = await createOrder({ amountCents: 80, payStatus: 'unpaid' })
  const viewed = await settlePickupArrival(db, { orderId: switchId, terminalId: input.pricedTerminalId })
  assert.equal(viewed.kind, 'pay', '收费机上看价要进入付款')
  assert.equal(viewed.arrivalCents, 200)
  const viewedRow = await db.order.findUniqueOrThrow({ where: { id: switchId } })
  assert.equal(viewedRow.terminalId, null, '只看价格不能把订单占到这台机器上')
  assert.equal(viewedRow.amountCents, 200)
  const again = await settlePickupArrival(db, { orderId: switchId, terminalId: input.pricedTerminalId })
  assert.equal(again.kind, 'pay', '返回后再输同一台的码仍然可以付款')
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: switchId } })).terminalId, null)
  const moved = await settlePickupArrival(db, { orderId: switchId, terminalId: input.publicTerminalId })
  assert.equal(moved.kind, 'release', '换到公共就业点位不收钱，直接放行')
  const movedRow = await db.order.findUniqueOrThrow({ where: { id: switchId } })
  assert.equal(movedRow.amountCents, 0)
  assert.equal(movedRow.payStatus, 'paid')
  assert.equal(movedRow.paymentSource, 'free')
  assert.equal(movedRow.terminalId, input.publicTerminalId)
  const switchAudits = await db.auditLog.findMany({ where: { targetId: switchId, action: ARRIVAL_REPRICE_AUDIT } })
  const zeroPayload = switchAudits
    .map((row) => JSON.parse(row.payloadJson ?? '{}') as { reason?: string; toAmountCents?: number })
    .find((row) => row.reason === 'arrival_price_zero')
  assert.ok(zeroPayload, '换到不收费的机器要记下改成 0 的审计')
  assert.equal(zeroPayload?.toAmountCents, 0)

  const zeroPayId = await createOrder({ amountCents: 160, payStatus: 'unpaid' })
  const zeroPay = await settlePickupArrival(db, { orderId: zeroPayId, terminalId: input.zeroTerminalId })
  assert.equal(zeroPay.kind, 'release', '本机价 0 的未付单不能再让人付钱')
  const zeroPayRow = await db.order.findUniqueOrThrow({ where: { id: zeroPayId } })
  assert.equal(zeroPayRow.amountCents, 0)
  assert.equal(zeroPayRow.payStatus, 'paid')
  assert.equal(zeroPayRow.paymentSource, 'free')
  const zeroPayAudit = JSON.parse(
    (await db.auditLog.findFirstOrThrow({ where: { targetId: zeroPayId, action: ARRIVAL_REPRICE_AUDIT } })).payloadJson ?? '{}',
  ) as { reason?: string }
  assert.equal(zeroPayAudit.reason, 'arrival_price_zero')

  const alreadyZeroId = await createOrder({ amountCents: 0, payStatus: 'unpaid' })
  const alreadyZero = await settlePickupArrival(db, { orderId: alreadyZeroId, terminalId: input.zeroTerminalId })
  assert.equal(alreadyZero.kind, 'pay')
  assert.equal(alreadyZero.arrivalCents, 0)
  const alreadyZeroRow = await db.order.findUniqueOrThrow({ where: { id: alreadyZeroId } })
  assert.equal(alreadyZeroRow.amountCents, 0)
  assert.equal(alreadyZeroRow.payStatus, 'unpaid')
  assert.equal(alreadyZeroRow.paymentSource, null)

  const discountId = await createOrder({ amountCents: 80, payStatus: 'unpaid', discountCents: 40 })
  const discounted = await settlePickupArrival(db, { orderId: discountId, terminalId: input.pricedTerminalId })
  assert.equal(discounted.kind, 'pay')
  assert.equal(discounted.arrivalCents, 200)
  const discountRow = await db.order.findUniqueOrThrow({ where: { id: discountId } })
  assert.equal(discountRow.amountCents, 200)
  assert.equal(discountRow.discountCents, 0, '到机按本机价重算时清掉旧抵扣，应付额等于本机价')
  const discountAudit = JSON.parse(
    (await db.auditLog.findFirstOrThrow({ where: { targetId: discountId, action: ARRIVAL_REPRICE_AUDIT } })).payloadJson ?? '{}',
  ) as {
    fromDiscountCents?: number
    toDiscountCents?: number
    terminalId?: string
    priceReason?: string
    priceUpdatedAt?: { print_bw_page?: string }
    factors?: Array<{ colorMode?: string; billablePages?: number; copies?: number; unitCents?: number }>
  }
  assert.equal(discountAudit.fromDiscountCents, 40)
  assert.equal(discountAudit.toDiscountCents, 0)
  assert.equal(discountAudit.terminalId, input.pricedTerminalId)
  assert.equal(discountAudit.priceReason, 'user_pays')
  assert.equal(typeof discountAudit.priceUpdatedAt?.print_bw_page, 'string')
  assert.equal(discountAudit.factors?.[0]?.colorMode, 'black_white')
  assert.equal(discountAudit.factors?.[0]?.billablePages, 2)
  assert.equal(discountAudit.factors?.[0]?.copies, 1)
  assert.equal(discountAudit.factors?.[0]?.unitCents, 100)

  const mismatchId = await createOrder({ amountCents: 80, payStatus: 'unpaid' })
  await db.orderItem.create({
    data: {
      orderId: mismatchId, seq: 0, fileId: `file_${mismatchId}_0`, colorMode: 'black_white',
      duplex: 'simplex', copies: 1, billablePages: 1, amountCents: 40, status: 'pending',
    },
  })
  await db.orderItem.create({
    data: {
      orderId: mismatchId, seq: 1, fileId: `file_${mismatchId}_1`, colorMode: 'black_white',
      duplex: 'simplex', copies: 1, billablePages: 1, amountCents: 40, status: 'pending',
    },
  })
  const mismatchOrder = await db.order.findUniqueOrThrow({ where: { id: mismatchId } })
  const prices = await getEffectiveUserPrices(db, input.pricedTerminalId)
  const applied = await db.$transaction((tx) => applyArrivalReprice(
    tx,
    mismatchOrder,
    input.pricedTerminalId,
    { amountCents: 200, lines: [{ serviceKey: 'print_bw_page', unitCents: 100, quantity: 2, subtotalCents: 200 }] },
    'unpaid_reprice',
    prices,
    [{ colorMode: 'black_white', billablePages: 2, copies: 1, unitCents: 100 }],
  ))
  assert.equal(applied, false, '报价行数和订单子项对不上时不能改价')
  const mismatchRow = await db.order.findUniqueOrThrow({ where: { id: mismatchId } })
  assert.equal(mismatchRow.amountCents, 80)
  const itemAmounts = await db.orderItem.findMany({ where: { orderId: mismatchId }, orderBy: { seq: 'asc' } })
  assert.deepEqual(itemAmounts.map((item) => item.amountCents), [40, 40])

  const priorBw = await db.terminalServicePrice.findUniqueOrThrow({
    where: { terminalId_serviceKey: { terminalId: input.otherTerminalId, serviceKey: 'print_bw_page' } },
  })
  await db.terminalServicePrice.update({ where: { id: priorBw.id }, data: { unitCents: 100_001 } })
  try {
    const illegalId = await createOrder({ amountCents: 10, payStatus: 'unpaid' })
    const illegal = await settlePickupArrival(db, { orderId: illegalId, terminalId: input.otherTerminalId })
    assert.equal(illegal.kind, 'unpriced', '超过上限的单价不能拿来向个人报价')
    const illegalRow = await db.order.findUniqueOrThrow({ where: { id: illegalId } })
    assert.equal(illegalRow.amountCents, 10)
    assert.equal(illegalRow.terminalId, null)
    assert.equal(illegalRow.payStatus, 'unpaid')
  } finally {
    await db.terminalServicePrice.update({ where: { id: priorBw.id }, data: { unitCents: priorBw.unitCents } })
  }

  const liveId = await createOrder({ amountCents: 180, payStatus: 'paying' })
  await db.paymentAttempt.create({
    data: {
      id: `pa_${liveId}`,
      orderId: liveId,
      channel: 'sandbox',
      amountCents: 180,
      status: 'pending',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  })
  const blocked = await settlePickupArrival(db, { orderId: liveId, terminalId: input.publicTerminalId })
  assert.equal(blocked.kind, 'lost', '付款还没过期时，公共就业点位不能改成免费放行')
  const liveRow = await db.order.findUniqueOrThrow({ where: { id: liveId } })
  assert.equal(liveRow.amountCents, 180)
  assert.equal(liveRow.payStatus, 'paying')
  assert.equal(liveRow.paymentSource, null)
  await db.paymentAttempt.update({
    where: { id: `pa_${liveId}` },
    data: { status: 'expired', expiresAt: new Date(Date.now() - 60_000), failReason: '这次付款已过期' },
  })
  const afterExpiry = await settlePickupArrival(db, { orderId: liveId, terminalId: input.publicTerminalId })
  assert.equal(afterExpiry.kind, 'release', '付款过期之后可以按公共就业点位免费放行')
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: liveId } })).paymentSource, 'free')

  const lapsedId = await createOrder({
    amountCents: 180,
    payStatus: 'paying',
    terminalId: input.pricedTerminalId,
  })
  await db.paymentAttempt.create({
    data: {
      id: `pa_${lapsedId}`,
      orderId: lapsedId,
      channel: 'sandbox',
      amountCents: 180,
      status: 'pending',
      expiresAt: new Date(Date.now() - 60_000),
    },
  })
  const lapsed = await settlePickupArrival(db, { orderId: lapsedId, terminalId: input.publicTerminalId })
  assert.equal(lapsed.kind, 'release', '到期但还没标成过期、渠道也没受理的付款，换到公共点位要放开并免费放行')
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: lapsedId } })).paymentSource, 'free')
  assert.equal((await db.paymentAttempt.findUniqueOrThrow({ where: { id: `pa_${lapsedId}` } })).status, 'expired')

  const occupyId = await createOrder({
    amountCents: 50,
    payStatus: 'paying',
    terminalId: input.pricedTerminalId,
  })
  await db.paymentAttempt.create({
    data: {
      id: `pa_${occupyId}`,
      orderId: occupyId,
      channel: 'sandbox',
      amountCents: 50,
      status: 'pending',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  })
  const occupied = await settlePickupArrival(db, { orderId: occupyId, terminalId: input.pricedTerminalId })
  assert.equal(occupied.kind, 'pay')
  assert.equal(occupied.arrivalCents, 50, '付款没过期时不按新的本机价改单')
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: occupyId } })).amountCents, 50)
  assert.equal(await releaseArrivalPaymentHold(db, occupyId, input.pricedTerminalId), 'released')
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: occupyId } })).terminalId, null)

  const keptId = await createOrder({
    amountCents: 200,
    payStatus: 'paying',
    terminalId: input.pricedTerminalId,
  })
  await db.paymentAttempt.create({
    data: {
      id: `pa_${keptId}`,
      orderId: keptId,
      channel: 'sandbox',
      amountCents: 200,
      status: 'pending',
      prepayId: `prepay_${keptId}`,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  })
  assert.equal(await releaseArrivalPaymentHold(db, keptId, input.pricedTerminalId), 'released', '用户放弃付款时，渠道已受理也要放开这台机器')
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: keptId } })).terminalId, null)
  assert.equal((await db.paymentAttempt.findUniqueOrThrow({ where: { id: `pa_${keptId}` } })).status, 'expired')

  const bindId = await createOrder({ amountCents: 200, payStatus: 'unpaid' })
  const bindOrder = await db.order.findUniqueOrThrow({ where: { id: bindId } })
  const token = createPaymentSessionToken({
    orderId: bindOrder.id,
    orderNo: bindOrder.orderNo,
    terminalId: input.pricedTerminalId,
    amountCents: bindOrder.amountCents,
  })
  await bindArrivalPaymentTerminal(db, bindId, token)
  assert.equal((await db.order.findUniqueOrThrow({ where: { id: bindId } })).terminalId, null, '还没有付款尝试时不占机器')
  const boundElsewhere = await settlePickupArrival(db, { orderId: bindId, terminalId: input.publicTerminalId })
  assert.equal(boundElsewhere.kind, 'release', '没占上机器时，公共就业点位免费放行')
  const boundRow = await db.order.findUniqueOrThrow({ where: { id: bindId } })
  assert.equal(boundRow.paymentSource, 'free')
  assert.equal(boundRow.amountCents, 0)

  const closedId = await createOrder({
    amountCents: 200,
    payStatus: 'paying',
    terminalId: input.pricedTerminalId,
  })
  await db.paymentAttempt.create({
    data: {
      id: `pa_${closedId}`,
      orderId: closedId,
      channel: 'sandbox',
      amountCents: 200,
      status: 'expired',
      prepayId: `prepay_${closedId}`,
      qrCodeContent: `qr_${closedId}`,
      expiresAt: new Date(Date.now() - 60_000),
      failReason: '渠道已关闭这次付款',
    },
  })
  const closedMove = await settlePickupArrival(db, { orderId: closedId, terminalId: input.publicTerminalId })
  assert.equal(closedMove.kind, 'release', '渠道关单后换到公共点位按那台免费放行')
  const closedRow = await db.order.findUniqueOrThrow({ where: { id: closedId } })
  assert.equal(closedRow.paymentSource, 'free')
  assert.equal(closedRow.amountCents, 0)
  assert.equal(closedRow.terminalId, input.publicTerminalId)

  const staleId = await createOrder({ amountCents: 0, payStatus: 'paid', paymentSource: 'free' })
  await db.paymentAttempt.create({
    data: {
      id: `pa_${staleId}`,
      orderId: staleId,
      channel: 'sandbox',
      amountCents: 80,
      status: 'pending',
    },
  })
  const repriced = await settlePickupArrival(db, { orderId: staleId, terminalId: input.pricedTerminalId })
  assert.equal(repriced.kind, 'pay')
  assert.equal(repriced.arrivalCents, 200)
  const staleAttempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: `pa_${staleId}` } })
  assert.equal(staleAttempt.status, 'expired', '改回未付时要把旧的待付尝试过期')
  const payment = new OnlinePaymentService(
    db,
    new AuditService(db),
    new OrderStatusService(db, new AuditService(db)),
    new PaymentProviderRegistry([new SandboxPaymentProvider(SANDBOX_SECRET)]),
  )
  const parked = await payment.simulateSandboxCallback({ attemptId: staleAttempt.id, result: 'success' })
  assert.equal(parked.ok, true)
  const parkedRow = await db.order.findUniqueOrThrow({ where: { id: staleId } })
  assert.equal(parkedRow.payStatus, 'unpaid', '过期尝试的旧金额不能入账放行')
  assert.equal(parkedRow.amountCents, 200)
  assert.equal(parkedRow.refundReason, null, '原路退成之后清掉待退信号，下一笔才能按现在的价付')
  const staleAudit = JSON.parse(
    (await db.auditLog.findFirstOrThrow({ where: { targetId: staleId, action: 'order.stale_attempt_collection' } })).payloadJson ?? '{}',
  ) as { reason?: string; attemptAmountCents?: number; orderAmountCents?: number; refundNo?: string }
  assert.equal(staleAudit.reason, 'repriced_attempt_collected')
  assert.equal(staleAudit.attemptAmountCents, 80)
  assert.equal(staleAudit.orderAmountCents, 200)
  assert.equal(staleAudit.refundNo, staleAttemptRefundNo(staleAttempt.id))
  const parkedAttempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: staleAttempt.id } })
  assert.equal(parkedAttempt.status, 'success')
  assert.ok(parkedAttempt.channelTxnNo)
  const parkedRefund = await db.refund.findUnique({ where: { refundNo: staleAttemptRefundNo(staleAttempt.id) } })
  assert.equal(parkedRefund?.status, 'success')
  assert.equal(parkedRefund?.amountCents, 80)
  const parkedDetail = await new AdminOrdersReadonlyService(db).getById(staleId)
  assert.equal(parkedDetail.printRefundDisposition, 'auto_success')
  assert.equal(parkedDetail.printRefundReason, staleCollectedRefundReason(80))
  assert.equal(parkedDetail.refundLedgerNo, parkedRefund?.refundNo)
  assert.equal(parkedDetail.refundLedgerCents, 80)
  await db.order.update({ where: { id: staleId }, data: { terminalId: input.pricedTerminalId } })
  const nextToken = createPaymentSessionToken({
    orderId: staleId,
    orderNo: parkedRow.orderNo,
    terminalId: input.pricedTerminalId,
    amountCents: 200,
  })
  await payment.createPayAttempt(staleId, nextToken, 'sandbox')
  const nextAttempt = await db.paymentAttempt.findFirst({
    where: { orderId: staleId, amountCents: 200, status: { in: ['created', 'pending'] } },
  })
  assert.ok(nextAttempt, '旧的 80 分已经退成，可以按现在的 200 分再付款')

  const lateFailId = await createOrder({ amountCents: 200, payStatus: 'unpaid' })
  await db.paymentAttempt.create({
    data: {
      id: `pa_${lateFailId}`,
      orderId: lateFailId,
      channel: 'sandbox',
      amountCents: 80,
      status: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    },
  })
  const lateFail = await payment.simulateSandboxCallback({ attemptId: `pa_${lateFailId}`, result: 'failed' })
  assert.equal(lateFail.ok, true)
  const lateFailRow = await db.order.findUniqueOrThrow({ where: { id: lateFailId } })
  assert.equal(lateFailRow.payStatus, 'unpaid')
  assert.equal(lateFailRow.refundReason, null)
  assert.equal(await db.refund.count({ where: { orderId: lateFailId } }), 0)
  assert.equal(await db.auditLog.count({ where: { targetId: lateFailId, action: 'order.stale_attempt_collection' } }), 0)
  assert.equal((await db.paymentAttempt.findUniqueOrThrow({ where: { id: `pa_${lateFailId}` } })).status, 'expired')

  const freedId = await createOrder({ amountCents: 200, payStatus: 'unpaid' })
  await db.paymentAttempt.create({
    data: {
      id: `pa_${freedId}`,
      orderId: freedId,
      channel: 'sandbox',
      amountCents: 80,
      status: 'expired',
      expiresAt: new Date(Date.now() - 60_000),
    },
  })
  const freed = await settlePickupArrival(db, { orderId: freedId, terminalId: input.publicTerminalId })
  assert.equal(freed.kind, 'release', '过期付款还没到时，公共点位先免费放行')
  const freedPaid = await payment.simulateSandboxCallback({ attemptId: `pa_${freedId}`, result: 'success' })
  assert.equal(freedPaid.ok, true)
  const freedRow = await db.order.findUniqueOrThrow({ where: { id: freedId } })
  assert.equal(freedRow.payStatus, 'paid')
  assert.equal(freedRow.paymentSource, 'free')
  assert.equal(freedRow.amountCents, 0)
  const freedRefund = await db.refund.findUnique({ where: { refundNo: staleAttemptRefundNo(`pa_${freedId}`) } })
  assert.equal(freedRefund?.status, 'success')
  assert.equal(freedRefund?.amountCents, 80, '免费放行之后迟到的 80 分要原路退，不能记成 0 分')
  const freedDetail = await new AdminOrdersReadonlyService(db).getById(freedId)
  assert.equal(freedDetail.printRefundDisposition, 'auto_success')
  assert.equal(freedDetail.printRefundReason, staleCollectedRefundReason(80))
  assert.equal(freedDetail.refundLedgerCents, 80)
  assert.notEqual(freedDetail.refundLedgerCents, 0)

  const freshId = await createOrder({ amountCents: 200, payStatus: 'unpaid' })
  await db.paymentAttempt.create({
    data: {
      id: `pa_${freshId}`,
      orderId: freshId,
      channel: 'sandbox',
      amountCents: 50,
      status: 'pending',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  })
  await assert.rejects(
    () => payment.simulateSandboxCallback({ attemptId: `pa_${freshId}`, result: 'success' }),
    (error: unknown) => error instanceof BadRequestException && `${error.message}`.includes('CALLBACK_AMOUNT_MISMATCH'),
    '还没过期的金额不符仍拒绝回调',
  )
  const freshRow = await db.order.findUniqueOrThrow({ where: { id: freshId } })
  assert.equal(freshRow.payStatus, 'unpaid')
  assert.equal(freshRow.refundReason, null)
  assert.equal(await db.auditLog.count({ where: { targetId: freshId, action: 'order.stale_attempt_collection' } }), 0)
}
