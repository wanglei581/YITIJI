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

export type PrintStatusAttemptCode = 'PRINT_STATUS_STALE_ATTEMPT' | 'PRINT_STATUS_FUTURE_ATTEMPT'

export type PrintStatusAttemptMismatch = {
  code: PrintStatusAttemptCode
  requested: number | null
  current: number
}

type PrintTaskLockTx = Pick<PrismaTransactionClient, '$executeRaw'>

/**
 * 全系统唯一的 PrintTask 行锁。状态补报与两条重试入口都先调它，再更新 Order。
 * 原始 SQL 不触发 Prisma 的 @updatedAt。不许再抄这一句。
 */
export async function lockPrintTaskRow(tx: PrintTaskLockTx, taskId: string): Promise<void> {
  await tx.$executeRaw`UPDATE "PrintTask" SET "errorMessage" = "errorMessage" WHERE "id" = ${taskId}`
}

function usableAttempt(attempt: number | undefined): attempt is number {
  return typeof attempt === 'number' && Number.isInteger(attempt) && attempt >= 0
}

async function recordAttemptMismatch(
  tx: PrintStatusTx,
  task: LockedPrintTaskSnapshot,
  taskId: string,
  code: PrintStatusAttemptCode,
  requested: number | null,
  current: number,
  reqLabel: string,
): Promise<PrintStatusAttemptMismatch> {
  await tx.printTaskStatusLog.create({
    data: {
      taskId,
      fromStatus: task.status,
      toStatus: task.status,
      errorCode: `${code} req=${reqLabel} cur=${current}`,
    },
  })
  return { code, requested, current }
}

/**
 * 在调用方的状态更新事务里先锁住 PrintTask，再数当前 attempt。
 * current === 0 且请求缺 attempt 或 attempt 非法时，仍视为老 Agent，不拒绝。
 * current > 0 时，缺省或非法一律按 PRINT_STATUS_STALE_ATTEMPT 拒绝：能进入重试轮次的终端当时必须带 attempt。
 * attempt < current 记 PRINT_STATUS_STALE_ATTEMPT；attempt > current 记 PRINT_STATUS_FUTURE_ATTEMPT。
 * 两条都不改任务状态，只写同状态元数据日志（不计入 failed→pending）。
 */
export async function readLockedPrintStatusAttempt(
  tx: PrintStatusTx,
  taskId: string,
  attempt: number | undefined,
): Promise<{ task: LockedPrintTaskSnapshot | null; mismatch: PrintStatusAttemptMismatch | null }> {
  await lockPrintTaskRow(tx, taskId)
  const task = await tx.printTask.findUnique({
    where: { id: taskId },
    select: { status: true, terminalId: true, errorCode: true, orderId: true, endUserId: true },
  })
  if (!task) return { task: null, mismatch: null }
  const current = (await reprintAttemptsByTaskId(tx, [taskId])).get(taskId) ?? 0
  if (!usableAttempt(attempt)) {
    if (current === 0) return { task, mismatch: null }
    if (current > 0) {
      const reqLabel = attempt === undefined ? 'missing' : 'invalid'
      return {
        task,
        mismatch: await recordAttemptMismatch(
          tx,
          task,
          taskId,
          'PRINT_STATUS_STALE_ATTEMPT',
          null,
          current,
          reqLabel,
        ),
      }
    }
  } else if (attempt > current) {
    return {
      task,
      mismatch: await recordAttemptMismatch(
        tx,
        task,
        taskId,
        'PRINT_STATUS_FUTURE_ATTEMPT',
        attempt,
        current,
        String(attempt),
      ),
    }
  } else if (attempt < current) {
    return {
      task,
      mismatch: await recordAttemptMismatch(
        tx,
        task,
        taskId,
        'PRINT_STATUS_STALE_ATTEMPT',
        attempt,
        current,
        String(attempt),
      ),
    }
  }
  return { task, mismatch: null }
}
