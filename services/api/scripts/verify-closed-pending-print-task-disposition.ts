/**
 * 已关闭订单遗留 pending PrintTask 的受控处置 service 级验证。
 *
 * 运行前必须指向临时本地 SQLite：
 * DATABASE_URL=file:./prisma/verify-closed-pending-print-task.db \
 * pnpm --filter @ai-job-print/api verify:closed-pending-print-task-disposition
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import {
  AdminClosedPendingPrintTaskDispositionService,
  CLOSED_PENDING_PRINT_TASK_DISPOSITION_ERROR_CODE,
} from '../src/print-jobs/admin-closed-pending-print-task-disposition.service'

process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-closed-pending-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-closed-pending-terminal-action-secret-0123456789'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function assertIsolatedSqlite(): void {
  const databaseUrl = process.env['DATABASE_URL'] ?? ''
  if (!databaseUrl.startsWith('file:')) {
    throw new Error('verify-closed-pending-print-task-disposition requires a local SQLite DATABASE_URL')
  }
}

async function expectReject(label: string, fn: () => Promise<unknown>, expectedCode: string): Promise<void> {
  try {
    await fn()
    fail(`${label}: expected ${expectedCode}, but resolved`)
  } catch (error) {
    const code = (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()
      ?.error?.code
    if (code === expectedCode) pass(label)
    else fail(`${label}: expected ${expectedCode}, got ${code ?? (error as Error).message}`)
  }
}

async function main(): Promise<void> {
  console.log('\n=== 已关闭订单遗留 pending PrintTask 受控处置验证 ===')
  assertIsolatedSqlite()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const service = new AdminClosedPendingPrintTaskDispositionService(prisma)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const adminId = `admin_closed_pending_${suffix}`
  const partnerId = `partner_closed_pending_${suffix}`
  const memberId = `member_closed_pending_${suffix}`
  const terminalId = `term_closed_pending_${suffix}`
  const terminalToken = `token_closed_pending_${suffix}`
  const eligibleTaskId = `ptask_closed_pending_${suffix}`
  const pendingAttemptTaskId = `ptask_pending_attempt_${suffix}`
  const successAttemptTaskId = `ptask_success_attempt_${suffix}`
  const claimedTaskId = `ptask_claimed_closed_${suffix}`
  const memberTaskId = `ptask_member_closed_${suffix}`
  const taskIds = [eligibleTaskId, pendingAttemptTaskId, successAttemptTaskId, claimedTaskId, memberTaskId]

  async function cleanup(): Promise<void> {
    await prisma.auditLog.deleteMany({ where: { targetId: { in: taskIds } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.paymentAttempt.deleteMany({ where: { order: { printTaskId: { in: taskIds } } } })
    await prisma.order.deleteMany({ where: { printTaskId: { in: taskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.user.deleteMany({ where: { id: { in: [adminId, partnerId] } } })
    await prisma.endUser.deleteMany({ where: { id: memberId } })
  }

  try {
    await cleanup()
    await prisma.user.createMany({
      data: [
        { id: adminId, username: `closed-admin-${suffix}`, passwordHash: 'verify', name: '受控处置管理员', role: 'admin' },
        { id: partnerId, username: `closed-partner-${suffix}`, passwordHash: 'verify', name: '非管理员', role: 'partner' },
      ],
    })
    await prisma.endUser.create({
      data: {
        id: memberId,
        phoneHash: `verify-member-hash-${suffix}`,
        phoneEnc: `verify-member-enc-${suffix}`,
      },
    })
    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `CLOSED-${suffix}`,
        agentToken: terminalToken,
        deviceFingerprint: `closed-${suffix}`,
      },
    })
    await prisma.printTask.createMany({
      data: [
        { id: eligibleTaskId, terminalId, fileUrl: 'internal://closed-eligible', fileMd5: 'eligible', status: 'pending' },
        { id: pendingAttemptTaskId, fileUrl: 'internal://closed-pending-attempt', fileMd5: 'pending-attempt', status: 'pending' },
        { id: successAttemptTaskId, fileUrl: 'internal://closed-success-attempt', fileMd5: 'success-attempt', status: 'pending' },
        { id: claimedTaskId, fileUrl: 'internal://closed-claimed', fileMd5: 'claimed', status: 'claimed', claimedAt: new Date(), claimExpiry: new Date(Date.now() + 60_000) },
        { id: memberTaskId, endUserId: memberId, fileUrl: 'internal://closed-member', fileMd5: 'member', status: 'pending' },
      ],
    })
    await prisma.order.createMany({
      data: taskIds.map((taskId, index) => ({
        id: `order_closed_pending_${index}_${suffix}`,
        orderNo: `ORD-CLOSED-${index}-${suffix}`,
        type: 'print',
        printTaskId: taskId,
        payStatus: 'closed',
        taskStatus: 'pending',
      })),
    })
    const [eligibleOrder, pendingOrder, successOrder] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { printTaskId: eligibleTaskId } }),
      prisma.order.findUniqueOrThrow({ where: { printTaskId: pendingAttemptTaskId } }),
      prisma.order.findUniqueOrThrow({ where: { printTaskId: successAttemptTaskId } }),
    ])
    await prisma.paymentAttempt.createMany({
      data: [
        { orderId: eligibleOrder.id, channel: 'sandbox', amountCents: 100, status: 'expired' },
        { orderId: pendingOrder.id, channel: 'sandbox', amountCents: 100, status: 'pending' },
        { orderId: successOrder.id, channel: 'sandbox', amountCents: 100, status: 'success' },
      ],
    })

    const first = await service.dispose({
      taskIds: [eligibleTaskId],
      operatorId: adminId,
      reason: '已关单且支付尝试已过期的匿名未领取任务需要受控收敛',
    })
    if (first.disposedTaskIds.length === 1 && first.alreadyDisposedTaskIds.length === 0) {
      pass('合格 closed/pending 任务首次受控处置成功')
    } else fail(`unexpected first disposition response: ${JSON.stringify(first)}`)

    const [taskAfter, orderAfter, attemptsAfter, logs, audits] = await Promise.all([
      prisma.printTask.findUnique({ where: { id: eligibleTaskId } }),
      prisma.order.findUnique({ where: { printTaskId: eligibleTaskId } }),
      prisma.paymentAttempt.findMany({ where: { orderId: eligibleOrder.id } }),
      prisma.printTaskStatusLog.findMany({ where: { taskId: eligibleTaskId } }),
      prisma.auditLog.findMany({ where: { targetId: eligibleTaskId, action: 'print_task.closed_pending_disposed' } }),
    ])
    if (
      taskAfter?.status === 'cancelled' &&
      taskAfter.errorCode === CLOSED_PENDING_PRINT_TASK_DISPOSITION_ERROR_CODE &&
      taskAfter.completedAt !== null &&
      orderAfter?.payStatus === 'closed' &&
      orderAfter.taskStatus === 'cancelled' &&
      attemptsAfter.length === 1 &&
      attemptsAfter[0]?.status === 'expired' &&
      logs.length === 1 &&
      logs[0]?.fromStatus === 'pending' &&
      logs[0]?.toStatus === 'cancelled' &&
      audits.length === 1 &&
      audits[0]?.actorId === adminId
    ) {
      pass('任务、订单镜像、状态日志与审计原子完成，closed 支付事实与 expired 尝试保持不变')
    } else fail(`post-disposition state mismatch: ${JSON.stringify({ taskAfter, orderAfter, attemptsAfter, logs, audits })}`)

    const second = await service.dispose({
      taskIds: [eligibleTaskId],
      operatorId: adminId,
      reason: '相同受控处置重试不得产生第二次副作用',
    })
    const [logsAfterRetry, auditsAfterRetry] = await Promise.all([
      prisma.printTaskStatusLog.count({ where: { taskId: eligibleTaskId } }),
      prisma.auditLog.count({ where: { targetId: eligibleTaskId, action: 'print_task.closed_pending_disposed' } }),
    ])
    if (second.disposedTaskIds.length === 0 && second.alreadyDisposedTaskIds.length === 1 && logsAfterRetry === 1 && auditsAfterRetry === 1) {
      pass('重复受控处置幂等，不追加状态日志或审计')
    } else fail(`idempotency mismatch: ${JSON.stringify({ second, logsAfterRetry, auditsAfterRetry })}`)

    const printJobs = new PrintJobsService(prisma, null as never, null as never, null as never, null as never)
    const cancelledStatus = await printJobs.getStatus(eligibleTaskId)
    if (cancelledStatus.status === 'cancelled' && !cancelledStatus.failureReasonForUser) {
      pass('Kiosk 查询受控关闭任务不伪装为设备打印失败')
    } else fail(`cancelled Kiosk status mismatch: ${JSON.stringify(cancelledStatus)}`)

    await expectReject('进行中支付尝试被拒绝', () => service.dispose({ taskIds: [pendingAttemptTaskId], operatorId: adminId, reason: '正在支付的订单绝不能关闭对应打印任务' }), 'PRINT_TASK_PAYMENT_ATTEMPT_PROTECTED')
    await expectReject('成功支付尝试被拒绝', () => service.dispose({ taskIds: [successAttemptTaskId], operatorId: adminId, reason: '已成功支付的订单绝不能关闭对应打印任务' }), 'PRINT_TASK_PAYMENT_ATTEMPT_PROTECTED')
    await expectReject('已领取任务被拒绝', () => service.dispose({ taskIds: [claimedTaskId], operatorId: adminId, reason: '已被终端领取的打印任务不能由维护命令关闭' }), 'PRINT_TASK_NOT_CLOSED_PENDING')
    await expectReject('会员任务被拒绝', () => service.dispose({ taskIds: [memberTaskId], operatorId: adminId, reason: '会员本人关联的打印任务不能由维护命令关闭' }), 'PRINT_TASK_NOT_CLOSED_PENDING')
    await expectReject('非管理员操作员被拒绝', () => service.dispose({ taskIds: [pendingAttemptTaskId], operatorId: partnerId, reason: '非管理员不得使用已关闭订单任务维护命令' }), 'ADMIN_OPERATOR_REQUIRED')
    await expectReject('过短原因被拒绝', () => service.dispose({ taskIds: [pendingAttemptTaskId], operatorId: adminId, reason: '太短' }), 'CLOSED_PENDING_TASK_REASON_INVALID')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
