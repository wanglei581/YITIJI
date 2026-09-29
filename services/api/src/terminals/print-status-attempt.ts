import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'

type AttemptDb = Pick<PrismaService, 'printTaskStatusLog'> | Pick<PrismaTransactionClient, 'printTaskStatusLog'>

type PrintStatusTx = Pick<PrismaTransactionClient, '$executeRaw' | 'printTask' | 'printTaskStatusLog'>

export type LockedPrintTaskSnapshot = {
  status: string
  terminalId: string | null
  errorCode: string | null
  orderId: string | null
  endUserId: string | null
}

/**
 * 本批任务各算一次。where 以 taskId 开头，可走 PrintTaskStatusLog 的 (taskId, createdAt) 索引。
 * 不按 errorCode 过滤：一体机重试和管理员重试都是 failed→pending，只是日志里的码不同。
 * 领取本身不写这条日志，所以同一次重提被重复领到时 attempt 不变。
 * 补报事务里也调用这一份，不许再写第二套计数。
 */
export async function reprintAttemptsByTaskId(
  prisma: AttemptDb,
  taskIds: string[],
): Promise<Map<string, number>> {
  const attempts = new Map<string, number>()
  if (taskIds.length === 0) return attempts
  const rows = await prisma.printTaskStatusLog.groupBy({
    by: ['taskId'],
    where: {
      taskId: { in: taskIds },
      fromStatus: 'failed',
      toStatus: 'pending',
    },
    _count: { _all: true },
  })
  for (const row of rows) {
    attempts.set(row.taskId, row._count._all)
  }
  return attempts
}

/**
 * 在调用方的状态更新事务里先锁住 PrintTask，再数当前 attempt。
 * 缺省、非整数或负数视为老 Agent，不拒绝。
 * 请求 attempt 小于或大于当前值都记一条同状态日志（不计入 failed→pending）并返回差值。
 * 大于当前值同样拒绝：计数以日志为准，超前的数字说明有缺陷或请求被伪造。
 */
export async function readLockedPrintStatusAttempt(
  tx: PrintStatusTx,
  taskId: string,
  attempt: number | undefined,
): Promise<{ task: LockedPrintTaskSnapshot | null; stale: { requested: number; current: number } | null }> {
  await tx.$executeRaw`UPDATE "PrintTask" SET "errorMessage" = "errorMessage" WHERE "id" = ${taskId}`
  const task = await tx.printTask.findUnique({
    where: { id: taskId },
    select: { status: true, terminalId: true, errorCode: true, orderId: true, endUserId: true },
  })
  if (!task) return { task: null, stale: null }
  if (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 0) {
    return { task, stale: null }
  }
  const current = (await reprintAttemptsByTaskId(tx, [taskId])).get(taskId) ?? 0
  if (attempt < current || attempt > current) {
    await tx.printTaskStatusLog.create({
      data: {
        taskId,
        fromStatus: task.status,
        toStatus: task.status,
        errorCode: `PRINT_STATUS_STALE_ATTEMPT req=${attempt} cur=${current}`,
      },
    })
    return { task, stale: { requested: attempt, current } }
  }
  return { task, stale: null }
}
