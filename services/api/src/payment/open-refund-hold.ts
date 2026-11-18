/**
 * 还可能变成退款成功的退款行。放行出纸之前必须先看这里。
 * pending、failed、manual_review 之后都可能收到渠道的成功通知。
 */
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import { findBlockingRefund } from './refund-paper-exclusion'

type HoldDb = PrismaService | PrismaTransactionClient

export const OPEN_REFUND_STATUSES = ['pending', 'failed', 'manual_review'] as const

export async function findOpenRefund(db: HoldDb, orderId: string): Promise<{ id: string } | null> {
  return findBlockingRefund(db, orderId)
}
