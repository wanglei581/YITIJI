import { ConflictException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'

/**
 * 本批任务各算一次。where 以 taskId 开头，可走 PrintTaskStatusLog 的 (taskId, createdAt) 索引。
 * 不按 errorCode 过滤：一体机重试和管理员重试都是 failed→pending，只是日志里的码不同。
 * 领取本身不写这条日志，所以同一次重提被重复领到时 attempt 不变。
 */
export async function reprintAttemptsByTaskId(
  prisma: PrismaService,
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
 * 请求带了 attempt，且小于该任务当前 attempt（failed→pending 条数）时拒绝。
 * 不改任务状态。缺省 attempt 的老 Agent 保持原有状态机。
 * 大于当前值不拒绝：计数以日志为准，超前的数字不能把任务打回旧轮次。
 *
 * 混合版本：老 Agent 不带 attempt，服务端照旧接受。attempt>0 的重提要等新 Agent
 * 才会出纸，不会因此重复出纸。发布顺序是先服务端、再 Agent 0.4.13。
 */
export async function assertFreshPrintStatusAttempt(
  prisma: PrismaService,
  taskId: string,
  attempt: number | undefined,
): Promise<void> {
  if (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 0) return
  const current = (await reprintAttemptsByTaskId(prisma, [taskId])).get(taskId) ?? 0
  if (attempt < current) {
    throw new ConflictException({
      error: {
        code: 'PRINT_STATUS_STALE_ATTEMPT',
        message: '状态回传属于更早的一次打印，已忽略',
      },
    })
  }
}
