/**
 * 受控关闭 KSK-001 冻结前遗留的 pending PrintTask。
 *
 * 仅供受控运维窗口执行；不提供 HTTP 路由。必须显式确认，且 service 会再次
 * 校验管理员身份、冻结时间、匿名性、未领取及订单支付状态。
 *
 * 示例：
 * LEGACY_PRINT_TASK_DISPOSITION_CONFIRM=DISPOSE_LEGACY_PENDING_TASKS \
 * LEGACY_PRINT_TASK_IDS=ptask_1,ptask_2 \
 * LEGACY_PRINT_TASK_OPERATOR_ID=admin_xxx \
 * LEGACY_PRINT_TASK_REASON='KSK-001 freeze cleanup' \
 * pnpm run maintenance:dispose-legacy-pending-print-tasks
 */
import 'dotenv/config'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminLegacyPendingPrintTaskDispositionService } from '../src/print-jobs/admin-legacy-pending-print-task-disposition.service'

const CONFIRMATION = 'DISPOSE_LEGACY_PENDING_TASKS'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function readTaskIds(): string[] {
  const taskIds = [
    ...new Set(
      required('LEGACY_PRINT_TASK_IDS')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    ),
  ]
  if (taskIds.length === 0 || taskIds.length > 10) {
    throw new Error('LEGACY_PRINT_TASK_IDS must contain 1 to 10 explicit task IDs')
  }
  return taskIds
}

async function main(): Promise<void> {
  if (required('LEGACY_PRINT_TASK_DISPOSITION_CONFIRM') !== CONFIRMATION) {
    throw new Error(`LEGACY_PRINT_TASK_DISPOSITION_CONFIRM must equal ${CONFIRMATION}`)
  }

  const taskIds = readTaskIds()
  const operatorId = required('LEGACY_PRINT_TASK_OPERATOR_ID')
  const reason = required('LEGACY_PRINT_TASK_REASON')
  const prisma = new PrismaService()

  try {
    await prisma.onModuleInit()
    const service = new AdminLegacyPendingPrintTaskDispositionService(prisma)
    const result = await service.dispose({ taskIds, operatorId, reason })
    console.log(
      JSON.stringify({ operation: 'legacy_pending_print_task_disposition', ...result }, null, 2)
    )
  } finally {
    await prisma.onModuleDestroy()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
