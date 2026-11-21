/**
 * 关单改支付状态的那一条更新。
 * 和确认退成一样：同一条语句先锁订单、再锁打印任务。
 * 任务已领、正在打、已完成，或 printOutcome 已是 printed，这条更新就不命中。
 */
import type { DbKind } from '../prisma/create-client'
import type { PrismaTransactionClient } from '../prisma/prisma.service'

const BUSY = ['claimed', 'printing', 'completed'] as const

export async function closeOrderIfPaperUnreleased(
  tx: PrismaTransactionClient,
  dbKind: DbKind,
  orderId: string,
  expectedPayStatus: string,
): Promise<boolean> {
  if (expectedPayStatus === 'partial_refunded') return false
  if (dbKind === 'postgres') {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      WITH locked_order AS MATERIALIZED (
        SELECT o."id", o."printTaskId"
        FROM "Order" o
        WHERE o."id" = ${orderId}
          AND o."payStatus" = ${expectedPayStatus}
          AND o."payStatus" <> 'partial_refunded'
          AND o."taskStatus" NOT IN ('claimed', 'printing', 'completed')
        FOR UPDATE
      ),
      locked_task AS MATERIALIZED (
        SELECT t."id", t."status"
        FROM "PrintTask" t
        JOIN locked_order o ON t."id" = o."printTaskId"
        WHERE t."status" NOT IN ('claimed', 'printing', 'completed')
          AND (t."printOutcome" IS NULL OR t."printOutcome" <> 'printed')
        FOR UPDATE
      )
      UPDATE "Order" o
      SET "payStatus" = 'closed',
          "taskStatus" = CASE
            WHEN EXISTS (
              SELECT 1 FROM locked_task WHERE locked_task."status" = 'pending'
            ) THEN 'cancelled'
            ELSE o."taskStatus"
          END,
          "updatedAt" = CURRENT_TIMESTAMP
      FROM locked_order
      WHERE o."id" = locked_order."id"
        AND (
          locked_order."printTaskId" IS NULL
          OR EXISTS (SELECT 1 FROM locked_task)
        )
      RETURNING o."id"
    `
    return rows.length === 1
  }
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { printTaskId: true, payStatus: true, taskStatus: true },
  })
  if (!order) return false
  if (order.payStatus !== expectedPayStatus) return false
  if (BUSY.includes(order.taskStatus as 'claimed' | 'printing' | 'completed')) return false
  let pendingTask = false
  if (order.printTaskId) {
    const held = await tx.printTask.updateMany({
      where: {
        id: order.printTaskId,
        status: { notIn: [...BUSY] },
        OR: [{ printOutcome: null }, { printOutcome: { not: 'printed' } }],
      },
      data: { updatedAt: new Date() },
    })
    if (held.count !== 1) return false
    const task = await tx.printTask.findUnique({
      where: { id: order.printTaskId },
      select: { status: true },
    })
    pendingTask = task?.status === 'pending'
  }
  const marked = await tx.order.updateMany({
    where: {
      id: orderId,
      payStatus: expectedPayStatus,
      taskStatus: { notIn: [...BUSY] },
    },
    data: {
      payStatus: 'closed',
      ...(pendingTask ? { taskStatus: 'cancelled' } : {}),
    },
  })
  return marked.count === 1
}
