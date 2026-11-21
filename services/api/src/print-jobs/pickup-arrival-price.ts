/**
 * 到机核销时按这台机器此刻的生效价重算打印订单。
 *
 * 手机先下单时，不带终端的报价是 0。带到这台机器上才按本机价收。
 * 已按大于 0 的金额付过的单：照旧放行，不补收、不退差。
 * 看价格不写终端号。未付且本机生效价为 0（含公共就业点位）时改成 0 元免费并放行。
 * 已经是 0 元免费已付、本机价也是 0 的，不改订单。
 */
import type { Prisma } from '../generated/prisma/client'
import { assertUserPaysUnit, getEffectiveUserPrices } from '../payment/effective-user-prices'
import type { EffectiveUserPrices } from '../payment/terminal-charge.contract'
import { findOpenRefund } from '../payment/open-refund-hold'
import { hasLiveArrivalPayment, releaseStaleArrivalHold } from './pickup-arrival-hold'
import type { PrintPriceLine } from '../payment/payment.types'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'

export const ARRIVAL_CLAIM_WON_AUDIT = 'print_order.arrival_claim_won'
export const ARRIVAL_REPRICE_AUDIT = 'print_order.arrival_reprice'

export type ArrivalSettleKind = 'release' | 'pay' | 'lost' | 'unpriced'

export interface ArrivalSettleResult {
  kind: ArrivalSettleKind
  /** 本机应付（分）。没算出来时为 null。 */
  arrivalCents: number | null
  repriced: boolean
  /** 本机价大于已付金额，核码页要写出这笔钱和原因。 */
  notice: boolean
}

interface QuoteInput {
  unitBw: number
  unitColor: number
  billablePages: number | null
  printParamsJson: string
  itemsJson: string
  orderItems: Array<{ billablePages: number; copies: number; colorMode: string }>
}

type Quote =
  | { ok: true; amountCents: number; lines: PrintPriceLine[] }
  | { ok: false }

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function unitFor(colorMode: string, unitBw: number, unitColor: number): number | null {
  if (colorMode === 'color') return unitColor
  if (colorMode === 'black_white') return unitBw
  return null
}

function readPrintParams(raw: string): { copies: number | null; colorMode: string | null } {
  try {
    const parsed = JSON.parse(raw) as { copies?: unknown; colorMode?: unknown }
    return {
      copies: positiveInt(parsed.copies) ? parsed.copies : null,
      colorMode: parsed.colorMode === 'color' || parsed.colorMode === 'black_white' ? parsed.colorMode : null,
    }
  } catch {
    return { copies: null, colorMode: null }
  }
}

function line(serviceKey: string, unitCents: number, quantity: number): PrintPriceLine {
  return { serviceKey, unitCents, quantity, subtotalCents: unitCents * quantity }
}

/** 按本机单价重算这一单。读不出页数时不要当成 0。两个打印单价都是 0 时金额就是 0。 */
export function quoteArrivalPrintCents(input: QuoteInput): Quote {
  if (input.unitBw === 0 && input.unitColor === 0) return { ok: true, amountCents: 0, lines: [] }

  if (input.orderItems.length > 0) {
    const lines: PrintPriceLine[] = []
    let total = 0
    for (const item of input.orderItems) {
      const unit = unitFor(item.colorMode, input.unitBw, input.unitColor)
      if (unit == null || !positiveInt(item.billablePages) || !positiveInt(item.copies)) return { ok: false }
      const quantity = item.billablePages * item.copies
      const row = line(item.colorMode === 'color' ? 'print_color_page' : 'print_bw_page', unit, quantity)
      lines.push(row)
      total += row.subtotalCents
    }
    return { ok: true, amountCents: total, lines }
  }

  const params = readPrintParams(input.printParamsJson)
  if (positiveInt(input.billablePages) && params.copies && params.colorMode) {
    const unit = unitFor(params.colorMode, input.unitBw, input.unitColor)
    if (unit == null) return { ok: false }
    const row = line(params.colorMode === 'color' ? 'print_color_page' : 'print_bw_page', unit, input.billablePages * params.copies)
    return { ok: true, amountCents: row.subtotalCents, lines: [row] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(input.itemsJson)
  } catch {
    return { ok: false }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { ok: false }
  const lines: PrintPriceLine[] = []
  let total = 0
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') return { ok: false }
    const row = raw as { serviceKey?: unknown; quantity?: unknown }
    if (row.serviceKey !== 'print_bw_page' && row.serviceKey !== 'print_color_page') return { ok: false }
    if (!positiveInt(row.quantity)) return { ok: false }
    const unit = row.serviceKey === 'print_color_page' ? input.unitColor : input.unitBw
    const next = line(row.serviceKey, unit, row.quantity)
    lines.push(next)
    total += next.subtotalCents
  }
  return { ok: true, amountCents: total, lines }
}

type OrderRow = {
  id: string
  amountCents: number
  discountCents: number
  payStatus: string
  paymentSource: string | null
  pickupStatus: string
  printTaskId: string | null
  taskStatus: string
  billablePages: number | null
  printParamsJson: string
  itemsJson: string
}

function lost(): ArrivalSettleResult {
  return { kind: 'lost', arrivalCents: null, repriced: false, notice: false }
}

async function writeAudit(
  tx: PrismaTransactionClient,
  action: string,
  orderId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorId: null,
      actorRole: 'kiosk',
      action,
      targetType: 'order',
      targetId: orderId,
      payloadJson: JSON.stringify(payload),
    },
  })
}

/**
 * 同一张未放行的单，只有一台机器能核过。
 * 已绑在这台机器上的单可以再次核（付款前重试）。绑在别的机器上的进不了这里。
 * 每次抢到都记审计。两台同时抢未绑定的单，输的那台记不到。
 */
function arrivalClaimWhere(orderId: string, terminalId: string): Prisma.OrderWhereInput {
  return {
    id: orderId,
    printTaskId: null,
    pickupStatus: { in: ['pending', 'claimed'] },
    OR: [{ terminalId: null }, { terminalId }],
  }
}

interface PriceFactor {
  colorMode: string
  billablePages: number
  copies: number
  unitCents: number
}

async function priceVersion(tx: PrismaTransactionClient, terminalId: string): Promise<Record<string, string | null>> {
  const rows = await tx.terminalServicePrice.findMany({
    where: { terminalId, serviceKey: { in: ['print_bw_page', 'print_color_page'] } },
    select: { serviceKey: true, updatedAt: true },
  })
  const version: Record<string, string | null> = { print_bw_page: null, print_color_page: null }
  for (const row of rows) version[row.serviceKey] = row.updatedAt.toISOString()
  return version
}

/** 行数对不上就整单失败，不能只改主表。到机按本机价重算时清掉旧抵扣，应付额等于本机价。 */
export async function applyArrivalReprice(
  tx: PrismaTransactionClient,
  current: OrderRow,
  terminalId: string,
  quote: { amountCents: number; lines: PrintPriceLine[] },
  reason: 'free_paid_must_pay' | 'unpaid_reprice',
  prices: EffectiveUserPrices,
  factors: PriceFactor[],
): Promise<boolean> {
  const items = await tx.orderItem.findMany({
    where: { orderId: current.id },
    orderBy: { seq: 'asc' },
    select: { id: true },
  })
  if (items.length > 0 && items.length !== quote.lines.length) return false
  const nextAmount = quote.amountCents
  const data: Prisma.OrderUpdateManyMutationInput = {
    amountCents: nextAmount,
    discountCents: 0,
    itemsJson: JSON.stringify(quote.lines),
  }
  if (reason === 'free_paid_must_pay') {
    data.payStatus = 'unpaid'
    data.paymentSource = null
    data.paidAt = null
    data.paidBy = null
    data.payChannel = null
    data.taskStatus = 'awaiting_payment'
  }
  const where: Prisma.OrderWhereInput = reason === 'free_paid_must_pay'
    ? { id: current.id, payStatus: 'paid', amountCents: 0, paymentSource: 'free', printTaskId: null }
    : { id: current.id, payStatus: { in: ['unpaid', 'paying'] }, printTaskId: null }
  const updated = await tx.order.updateMany({ where, data })
  if (updated.count !== 1) return false
  await tx.paymentAttempt.updateMany({
    where: { orderId: current.id, status: { in: ['created', 'pending'] } },
    data: { status: 'expired', failReason: '价格已按本机价更新，请重新付款' },
  })
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const priced = quote.lines[index]
    if (!item || !priced) continue
    await tx.orderItem.updateMany({
      where: { id: item.id },
      data: { amountCents: priced.subtotalCents },
    })
  }
  await writeAudit(tx, ARRIVAL_REPRICE_AUDIT, current.id, {
    terminalId,
    fromAmountCents: current.amountCents,
    toAmountCents: nextAmount,
    fromDiscountCents: current.discountCents,
    toDiscountCents: 0,
    paymentSourceBefore: current.paymentSource,
    reason,
    priceReason: prices.prices.print_bw_page.reason,
    priceUpdatedAt: await priceVersion(tx, terminalId),
    factors,
    lines: quote.lines,
  })
  return true
}

const UNPRICED_ERROR = 'ARRIVAL_PRICE_UNAVAILABLE'

function unpricedError(): Error {
  const error = new Error(UNPRICED_ERROR)
  error.name = UNPRICED_ERROR
  return error
}

function unpricedResult(): ArrivalSettleResult {
  return { kind: 'unpriced', arrivalCents: null, repriced: false, notice: false }
}

export async function settlePickupArrival(
  db: PrismaService,
  input: { orderId: string; terminalId: string },
): Promise<ArrivalSettleResult> {
  try {
    return await settlePickupArrivalOnce(db, input)
  } catch (error) {
    if (error instanceof Error && error.name === UNPRICED_ERROR) return unpricedResult()
    throw error
  }
}

function factorsFor(
  items: Array<{ billablePages: number; copies: number; colorMode: string }>,
  current: OrderRow,
  lines: PrintPriceLine[],
): PriceFactor[] {
  if (items.length > 0) {
    return items.map((item, index) => ({
      colorMode: item.colorMode,
      billablePages: item.billablePages,
      copies: item.copies,
      unitCents: lines[index]?.unitCents ?? 0,
    }))
  }
  const params = readPrintParams(current.printParamsJson)
  if (params.copies && params.colorMode && positiveInt(current.billablePages)) {
    return [{
      colorMode: params.colorMode,
      billablePages: current.billablePages,
      copies: params.copies,
      unitCents: lines[0]?.unitCents ?? 0,
    }]
  }
  return lines.map((line) => ({
    colorMode: line.serviceKey === 'print_color_page' ? 'color' : 'black_white',
    billablePages: line.quantity,
    copies: 1,
    unitCents: line.unitCents,
  }))
}

async function claimTerminal(
  tx: PrismaTransactionClient,
  orderId: string,
  terminalId: string,
  amountCents: number,
  payStatus: string,
): Promise<boolean> {
  const won = await tx.order.updateMany({
    where: arrivalClaimWhere(orderId, terminalId),
    data: { terminalId },
  })
  if (won.count !== 1) return false
  await writeAudit(tx, ARRIVAL_CLAIM_WON_AUDIT, orderId, { terminalId, amountCents, payStatus })
  return true
}

async function settlePickupArrivalOnce(
  db: PrismaService,
  input: { orderId: string; terminalId: string },
): Promise<ArrivalSettleResult> {
  return db.$transaction(async (tx) => {
    await releaseStaleArrivalHold(tx, input.orderId)
    const current = await tx.order.findUnique({ where: { id: input.orderId } })
    if (!current || current.printTaskId) return lost()
    if (current.pickupStatus !== 'pending' && current.pickupStatus !== 'claimed') return lost()
    // 已经绑在别的机器上（下单时选的，或付款还占着）不能在这里改绑。看价不会写终端号。
    if (current.terminalId && current.terminalId !== input.terminalId) return lost()

    // 已按大于 0 的金额付过：照旧放行，不补收、不退差。
    // 退款中、已退款不能放行。抢到「已付款」之后把任务标成认领中，退款的状态门进不来，
    // 避免退款成功回调和核码各走各的，既退了钱又出纸。
    if (current.payStatus === 'paid' && current.amountCents > 0) {
      if (await findOpenRefund(tx, current.id)) return lost()
      if (!await claimTerminal(tx, current.id, input.terminalId, current.amountCents, current.payStatus)) return lost()
      const held = await tx.order.updateMany({
        where: { id: current.id, payStatus: 'paid', taskStatus: { notIn: ['claimed', 'printing'] } },
        data: { taskStatus: 'claimed' },
      })
      if (held.count !== 1) return lost()
      return { kind: 'release', arrivalCents: current.amountCents, repriced: false, notice: false }
    }

    const prices = await getEffectiveUserPrices(tx, input.terminalId)
    try {
      assertUserPaysUnit(prices.prices.print_bw_page)
      assertUserPaysUnit(prices.prices.print_color_page)
    } catch (error) {
      if (error instanceof Error && error.message === 'PRICE_CONFIG_INVALID') throw unpricedError()
      throw error
    }
    const items = await tx.orderItem.findMany({
      where: { orderId: current.id },
      orderBy: { seq: 'asc' },
      select: { billablePages: true, copies: true, colorMode: true },
    })
    const quote = quoteArrivalPrintCents({
      unitBw: prices.prices.print_bw_page.effectiveCents,
      unitColor: prices.prices.print_color_page.effectiveCents,
      billablePages: current.billablePages,
      printParamsJson: current.printParamsJson,
      itemsJson: current.itemsJson,
      orderItems: items,
    })
    // 页数读不出来不能当成 0。这里还没写终端号，换一台或稍后再核还能再算。
    if (!quote.ok) throw unpricedError()
    const factors = factorsFor(items, current, quote.lines)

    if (quote.amountCents === 0 && current.payStatus === 'paid') {
      if (!await claimTerminal(tx, current.id, input.terminalId, current.amountCents, current.payStatus)) return lost()
      return { kind: 'release', arrivalCents: 0, repriced: false, notice: false }
    }

    // 还有未过期的付款尝试：不改价，也不改成免费放行。本机价是 0 时不能再收，也不能把进行中的付款抹掉。
    if (await hasLiveArrivalPayment(tx, current.id)) {
      if (quote.amountCents === 0) return lost()
      return { kind: 'pay', arrivalCents: current.amountCents, repriced: false, notice: true }
    }

    // 未付且金额大于 0，本机价是 0（含公共就业点位）：不许再付钱，改成免费并放行。
    if (quote.amountCents === 0 && current.amountCents > 0 && (current.payStatus === 'unpaid' || current.payStatus === 'paying')) {
      const freed = await tx.order.updateMany({
        where: {
          id: current.id,
          printTaskId: null,
          payStatus: { in: ['unpaid', 'paying'] },
          OR: [{ terminalId: null }, { terminalId: input.terminalId }],
        },
        data: {
          terminalId: input.terminalId,
          amountCents: 0,
          discountCents: 0,
          itemsJson: '[]',
          payStatus: 'paid',
          paymentSource: 'free',
          paidAt: new Date(),
          paidBy: 'system',
          payChannel: null,
          taskStatus: 'pending',
        },
      })
      if (freed.count !== 1) return lost()
      await tx.orderItem.updateMany({ where: { orderId: current.id }, data: { amountCents: 0 } })
      await tx.paymentAttempt.updateMany({
        where: { orderId: current.id, status: { in: ['created', 'pending'] } },
        data: { status: 'expired', failReason: '本机不向求职者收费，这次付款已取消' },
      })
      await writeAudit(tx, ARRIVAL_REPRICE_AUDIT, current.id, {
        terminalId: input.terminalId,
        fromAmountCents: current.amountCents,
        toAmountCents: 0,
        fromDiscountCents: current.discountCents,
        toDiscountCents: 0,
        paymentSourceBefore: current.paymentSource,
        reason: 'arrival_price_zero',
        priceReason: prices.prices.print_bw_page.reason,
        priceUpdatedAt: await priceVersion(tx, input.terminalId),
        factors,
        lines: quote.lines,
      })
      await writeAudit(tx, ARRIVAL_CLAIM_WON_AUDIT, current.id, {
        terminalId: input.terminalId,
        amountCents: 0,
        payStatus: 'paid',
      })
      return { kind: 'release', arrivalCents: 0, repriced: true, notice: false }
    }

    if (quote.amountCents === 0) {
      return { kind: 'pay', arrivalCents: 0, repriced: false, notice: false }
    }

    // 0 元按免费记已付，本机生效价大于 0：不许直接放行，先付本机价。
    if (current.payStatus === 'paid' && current.amountCents === 0 && current.paymentSource === 'free') {
      const applied = await applyArrivalReprice(tx, current, input.terminalId, quote, 'free_paid_must_pay', prices, factors)
      if (!applied) return lost()
      return { kind: 'pay', arrivalCents: quote.amountCents, repriced: true, notice: true }
    }

    if (current.payStatus === 'unpaid' || current.payStatus === 'paying') {
      let repriced = false
      if (quote.amountCents !== current.amountCents || current.discountCents !== 0) {
        const applied = await applyArrivalReprice(tx, current, input.terminalId, quote, 'unpaid_reprice', prices, factors)
        if (!applied) return lost()
        repriced = true
      }
      return { kind: 'pay', arrivalCents: quote.amountCents, repriced, notice: true }
    }

    return lost()
  })
}
