import type { PrismaService } from '../prisma/prisma.service'

export interface ConfirmPaidInput {
  outTradeNo: string
  openId: string
  env: number
  productId: string
  quantity: number
  priceCents: number
  wxOrderId: string | null
  paidAt: Date | null
}

export type ConfirmPaidFailure =
  | 'order_missing'
  | 'order_closed'
  | 'openid_mismatch'
  | 'env_mismatch'
  | 'product_mismatch'
  | 'quantity_mismatch'
  | 'amount_mismatch'

export type ConfirmPaidResult =
  | { ok: true; granted: boolean }
  | { ok: false; reason: ConfirmPaidFailure }

interface CreditOrder {
  id: string
  endUserId: string | null
  serviceKind: string
  openId: string | null
  env: number
  productId: string
  priceCents: number
  status: string
}

/**
 * 发货推送和查单补记走同一条路。一单至多一条权益，靠 sourceOrderId 唯一约束兜底。
 * 对不上只返回原因，不改订单、不记权益。
 */
export async function confirmPaid(prisma: PrismaService, input: ConfirmPaidInput): Promise<ConfirmPaidResult> {
  try {
    return await grantPaid(prisma, input)
  } catch (error) {
    if (!isUniqueConflict(error)) throw error
    const order = await prisma.virtualPayOrder.findUnique({ where: { outTradeNo: input.outTradeNo } })
    if (!order) return { ok: false, reason: 'order_missing' }
    const credit = await prisma.memberServiceCredit.findUnique({ where: { sourceOrderId: order.id } })
    if (!credit) throw error
    if (order.status === 'pending') {
      await prisma.virtualPayOrder.updateMany({
        where: { id: order.id, status: 'pending' },
        data: { status: 'paid', wxOrderId: input.wxOrderId, paidAt: input.paidAt ?? new Date() },
      })
    }
    return { ok: true, granted: false }
  }
}

async function grantPaid(prisma: PrismaService, input: ConfirmPaidInput): Promise<ConfirmPaidResult> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.virtualPayOrder.findUnique({ where: { outTradeNo: input.outTradeNo } })
    if (!order) return { ok: false, reason: 'order_missing' }
    if (order.status === 'closed') return { ok: false, reason: 'order_closed' }
    const reason = mismatch(order, input)
    if (reason) return { ok: false, reason }
    if (order.status === 'paid') {
      await ensureCredit(tx, order)
      return { ok: true, granted: false }
    }
    if (order.status !== 'pending') return { ok: false, reason: 'order_closed' }
    const updated = await tx.virtualPayOrder.updateMany({
      where: { id: order.id, status: 'pending' },
      data: {
        status: 'paid',
        wxOrderId: input.wxOrderId,
        paidAt: input.paidAt ?? new Date(),
      },
    })
    if (updated.count !== 1) {
      const again = await tx.virtualPayOrder.findUnique({ where: { id: order.id } })
      if (again?.status !== 'paid') return { ok: false, reason: 'order_closed' }
      await ensureCredit(tx, again)
      return { ok: true, granted: false }
    }
    await ensureCredit(tx, order)
    return { ok: true, granted: true }
  })
}

function mismatch(order: CreditOrder, input: ConfirmPaidInput): ConfirmPaidFailure | null {
  if (order.openId !== input.openId) return 'openid_mismatch'
  if (order.env !== input.env) return 'env_mismatch'
  if (order.productId !== input.productId) return 'product_mismatch'
  if (input.quantity !== 1) return 'quantity_mismatch'
  if (order.priceCents !== input.priceCents) return 'amount_mismatch'
  return null
}

async function ensureCredit(
  tx: Pick<PrismaService, 'memberServiceCredit'>,
  order: Pick<CreditOrder, 'id' | 'endUserId' | 'serviceKind'>,
): Promise<void> {
  const existing = await tx.memberServiceCredit.findUnique({ where: { sourceOrderId: order.id } })
  if (existing) return
  await tx.memberServiceCredit.create({
    data: {
      endUserId: order.endUserId,
      serviceKind: order.serviceKind,
      sourceOrderId: order.id,
      status: 'available',
    },
  })
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002'
}
