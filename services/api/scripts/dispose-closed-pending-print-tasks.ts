/**
 * 受控关闭已关单但仍 pending 的匿名未领取 PrintTask。
 *
 * 仅供受控运维窗口执行；不提供 HTTP 路由。
 *
 * CLOSED_PENDING_PRINT_TASK_DISPOSITION_CONFIRM=DISPOSE_CLOSED_PENDING_TASKS \
 * CLOSED_PENDING_PRINT_TASK_IDS=ptask_1,ptask_2 \
 * CLOSED_PENDING_PRINT_TASK_OPERATOR_ID=admin_xxx \
 * CLOSED_PENDING_PRINT_TASK_REASON='expired payment task reconciliation' \
 * pnpm run maintenance:dispose-closed-pending-print-tasks
 */
import 'dotenv/config'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminClosedPendingPrintTaskDispositionService } from '../src/print-jobs/admin-closed-pending-print-task-disposition.service'

const CONFIRMATION = 'DISPOSE_CLOSED_PENDING_TASKS'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function readTaskIds(): string[] {
  const taskIds = [
    ...new Set(
      required('CLOSED_PENDING_PRINT_TASK_IDS')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ]
  if (taskIds.length === 0 || taskIds.length > 10) {
    throw new Error('CLOSED_PENDING_PRINT_TASK_IDS must contain 1 to 10 explicit task IDs')
  }
  return taskIds
}

async function main(): Promise<void> {
  if (required('CLOSED_PENDING_PRINT_TASK_DISPOSITION_CONFIRM') !== CONFIRMATION) {
    throw new Error(`CLOSED_PENDING_PRINT_TASK_DISPOSITION_CONFIRM must equal ${CONFIRMATION}`)
  }

  const taskIds = readTaskIds()
  const operatorId = required('CLOSED_PENDING_PRINT_TASK_OPERATOR_ID')
  const reason = required('CLOSED_PENDING_PRINT_TASK_REASON')
  const prisma = new PrismaService()
  try {
    await prisma.onModuleInit()
    const result = await new AdminClosedPendingPrintTaskDispositionService(prisma).dispose({
      taskIds,
      operatorId,
      reason,
    })
    console.log(
      JSON.stringify(
        { operation: 'closed_pending_print_task_disposition', ...result },
        null,
        2
      )
    )
  } finally {
    await prisma.onModuleDestroy()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
