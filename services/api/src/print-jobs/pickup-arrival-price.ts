/**
 * 到机核销时按这台机器此刻的生效价重算打印订单。
 *
 * 手机先下单时，不带终端的报价是 0。带到这台机器上才按本机价收。
 * 已按大于 0 的金额付过的单：照旧放行，不补收、不退差。
 * 本机生效价为 0（含公共就业点位、总开关关、机构承担）时不改订单。
 */
import type { Prisma } from '../generated/prisma/client'
import { getEffectiveUserPrices } from '../payment/effective-user-prices'
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

async function applyReprice(
  tx: PrismaTransactionClient,
  current: OrderRow,
  terminalId: string,
  quote: { amountCents: number; lines: PrintPriceLine[] },
  reason: 'free_paid_must_pay' | 'unpaid_reprice',
): Promise<boolean> {
  const nextAmount = quote.amountCents
  const data: Prisma.OrderUpdateManyMutationInput = {
    amountCents: nextAmount,
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
  if (reason === 'unpaid_reprice' && (current.payStatus === 'paying' || current.payStatus === 'unpaid')) {
    await tx.paymentAttempt.updateMany({
      where: { orderId: current.id, status: { in: ['created', 'pending'] } },
      data: { status: 'expired', failReason: '价格已按本机价更新，请重新付款' },
    })
  }
  const items = await tx.orderItem.findMany({
    where: { orderId: current.id },
    orderBy: { seq: 'asc' },
    select: { id: true },
  })
  if (items.length > 0 && items.length === quote.lines.length) {
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      const priced = quote.lines[index]
      if (!item || !priced) continue
      await tx.orderItem.updateMany({
        where: { id: item.id },
        data: { amountCents: priced.subtotalCents },
      })
    }
  }
  await writeAudit(tx, ARRIVAL_REPRICE_AUDIT, current.id, {
    terminalId,
    fromAmountCents: current.amountCents,
    toAmountCents: nextAmount,
    reason,
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

async function settlePickupArrivalOnce(
  db: PrismaService,
  input: { orderId: string; terminalId: string },
): Promise<ArrivalSettleResult> {
  return db.$transaction(async (tx) => {
    const won = await tx.order.updateMany({
      where: arrivalClaimWhere(input.orderId, input.terminalId),
      data: { terminalId: input.terminalId },
    })
    if (won.count !== 1) return lost()
    const current = await tx.order.findUnique({ where: { id: input.orderId } })
    if (!current || current.terminalId !== input.terminalId) return lost()
    await writeAudit(tx, ARRIVAL_CLAIM_WON_AUDIT, current.id, {
      terminalId: input.terminalId,
      amountCents: current.amountCents,
      payStatus: current.payStatus,
    })

    // 已按大于 0 的金额付过：照旧放行，不补收、不退差。
    // 退款中、已退款不能放行。抢到「已付款」之后把任务标成认领中，退款的状态门进不来，
    // 避免退款成功回调和核码各走各的，既退了钱又出纸。
    if (current.payStatus === 'paid' && current.amountCents > 0) {
      const held = await tx.order.updateMany({
        where: { id: current.id, payStatus: 'paid', taskStatus: { notIn: ['claimed', 'printing'] } },
        data: { taskStatus: 'claimed' },
      })
      if (held.count !== 1) return lost()
      return { kind: 'release', arrivalCents: current.amountCents, repriced: false, notice: false }
    }

    const prices = await getEffectiveUserPrices(tx, input.terminalId)
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
    // 页数读不出来不能当成 0。回滚这次抢占，换一台或稍后再核还能再算。
    if (!quote.ok) throw unpricedError()

    if (quote.amountCents === 0) {
      const kind = current.payStatus === 'paid' ? 'release' : 'pay'
      return { kind, arrivalCents: 0, repriced: false, notice: false }
    }

    // 0 元按免费记已付，本机生效价大于 0：不许直接放行，先付本机价。
    if (current.payStatus === 'paid' && current.amountCents === 0 && current.paymentSource === 'free') {
      const applied = await applyReprice(tx, current, input.terminalId, quote, 'free_paid_must_pay')
      if (!applied) return lost()
      return { kind: 'pay', arrivalCents: quote.amountCents, repriced: true, notice: true }
    }

    if (current.payStatus === 'unpaid' || current.payStatus === 'paying') {
      let repriced = false
      if (quote.amountCents !== current.amountCents) {
        const applied = await applyReprice(tx, current, input.terminalId, quote, 'unpaid_reprice')
        if (!applied) return lost()
        repriced = true
      }
      return { kind: 'pay', arrivalCents: quote.amountCents, repriced, notice: true }
    }

    return lost()
  })
}
