import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'

/**
 * 到机码自付款成功起的有效期（产品裁决：7 天）。
 * 未付款建单仍用 `min(该上限, 文件 expiresAt)`，避免未支付的码比文件活得久。
 * 付款落定时把云打印单的 `pickupCodeExpiresAt` 改到 `paidAt + 该值`，
 * 并把仍 active、且到期更早的源文件延长到同一时刻（`expiresAt = null` 的长期文件不缩短）。
 */
export const PICKUP_VALIDITY_FROM_PAYMENT_MS = 7 * 24 * 60 * 60 * 1000

export function pickupDeadlineFromPayment(paidAt: Date): Date {
  return new Date(paidAt.getTime() + PICKUP_VALIDITY_FROM_PAYMENT_MS)
}

type PickupFileDb = PrismaService | PrismaTransactionClient

export async function collectPickupFileIds(
  db: PickupFileDb,
  order: { id: string; sourceFileId: string | null },
): Promise<string[]> {
  const ids: string[] = []
  if (order.sourceFileId) ids.push(order.sourceFileId)
  const items = await db.orderItem.findMany({
    where: { orderId: order.id },
    select: { fileId: true },
  })
  for (const item of items) ids.push(item.fileId)
  return ids
}

/** 只延长、不缩短。已删除或非 active 的文件不动。 */
export async function extendActivePrintFilesToDeadline(
  db: PickupFileDb,
  fileIds: string[],
  deadline: Date,
): Promise<void> {
  const ids = [...new Set(fileIds.filter((id) => id.length > 0))]
  if (ids.length === 0) return
  await db.fileObject.updateMany({
    where: {
      id: { in: ids },
      deletedAt: null,
      status: 'active',
      expiresAt: { lt: deadline },
    },
    data: { expiresAt: deadline },
  })
}
