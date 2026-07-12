/**
 * 受控处置历史 pending PrintTask 的 service 级验证。
 *
 * 只覆盖 2026-07-11 KSK-001 冻结窗口前、匿名、未领取、未支付/已关闭的历史任务：
 * pending → cancelled，订单镜像、状态日志、Admin 审计必须同一事务落库。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:legacy-pending-print-task-disposition
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import {
  AdminLegacyPendingPrintTaskDispositionService,
  LEGACY_PENDING_PRINT_TASK_CUTOFF,
} from '../src/print-jobs/admin-legacy-pending-print-task-disposition.service'

process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-legacy-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-legacy-terminal-action-secret-0123456789'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

async function expectReject(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
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
  console.log('\n=== 历史 pending PrintTask 受控处置验证 ===')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const service = new AdminLegacyPendingPrintTaskDispositionService(prisma)
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const adminId = `admin_legacy_disposition_${suffix}`
  const nonAdminId = `partner_legacy_disposition_${suffix}`
  const terminalId = `term_legacy_disposition_${suffix}`
  const terminalToken = `token_legacy_disposition_${suffix}`
  const bareTaskId = `ptask_legacy_bare_${suffix}`
  const unpaidTaskId = `ptask_legacy_unpaid_${suffix}`
  const closedTaskId = `ptask_legacy_closed_${suffix}`
  const freshTaskId = `ptask_fresh_${suffix}`
  const paidTaskId = `ptask_legacy_paid_${suffix}`
  const claimedTaskId = `ptask_legacy_claimed_${suffix}`
  const taskIds = [bareTaskId, unpaidTaskId, closedTaskId, freshTaskId, paidTaskId, claimedTaskId]
  const orderIds = [
    `order_legacy_unpaid_${suffix}`,
    `order_legacy_closed_${suffix}`,
    `order_legacy_paid_${suffix}`,
  ]
  const createdAt = new Date(LEGACY_PENDING_PRINT_TASK_CUTOFF.getTime() - 60_000)

  async function cleanup(): Promise<void> {
    await prisma.auditLog.deleteMany({ where: { targetId: { in: taskIds } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.order.deleteMany({ where: { printTaskId: { in: taskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.user.deleteMany({ where: { id: { in: [adminId, nonAdminId] } } })
  }

  try {
    await cleanup()
    await prisma.user.createMany({
      data: [
        {
          id: adminId,
          username: `legacy-admin-${suffix}`,
          passwordHash: 'verify',
          name: '历史任务管理员',
          role: 'admin',
        },
        {
          id: nonAdminId,
          username: `legacy-partner-${suffix}`,
          passwordHash: 'verify',
          name: '历史任务非管理员',
          role: 'partner',
        },
      ],
    })
    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `LEGACY-${suffix}`,
        agentToken: terminalToken,
        deviceFingerprint: `legacy-${suffix}`,
      },
    })
    await prisma.printTask.createMany({
      data: [
        {
          id: bareTaskId,
          fileUrl: 'internal://legacy-bare',
          fileMd5: 'bare',
          status: 'pending',
          createdAt,
        },
        {
          id: unpaidTaskId,
          terminalId,
          fileUrl: 'internal://legacy-unpaid',
          fileMd5: 'unpaid',
          status: 'pending',
          createdAt,
        },
        {
          id: closedTaskId,
          fileUrl: 'internal://legacy-closed',
          fileMd5: 'closed',
          status: 'pending',
          createdAt,
        },
        {
          id: freshTaskId,
          fileUrl: 'internal://fresh',
          fileMd5: 'fresh',
          status: 'pending',
          createdAt: new Date(LEGACY_PENDING_PRINT_TASK_CUTOFF.getTime() + 60_000),
        },
        {
          id: paidTaskId,
          fileUrl: 'internal://legacy-paid',
          fileMd5: 'paid',
          status: 'pending',
          createdAt,
        },
        {
          id: claimedTaskId,
          fileUrl: 'internal://legacy-claimed',
          fileMd5: 'claimed',
          status: 'claimed',
          claimedAt: createdAt,
          claimExpiry: new Date(createdAt.getTime() + 60_000),
          createdAt,
        },
      ],
    })
    await prisma.order.createMany({
      data: [
        {
          id: orderIds[0],
          orderNo: `ORD-LEGACY-U-${suffix}`,
          type: 'print',
          printTaskId: unpaidTaskId,
          payStatus: 'unpaid',
          taskStatus: 'pending',
        },
        {
          id: orderIds[1],
          orderNo: `ORD-LEGACY-C-${suffix}`,
          type: 'print',
          printTaskId: closedTaskId,
          payStatus: 'closed',
          taskStatus: 'pending',
        },
        {
          id: orderIds[2],
          orderNo: `ORD-LEGACY-P-${suffix}`,
          type: 'print',
          printTaskId: paidTaskId,
          payStatus: 'paid',
          taskStatus: 'pending',
        },
      ],
    })

    const first = await service.dispose({
      taskIds: [bareTaskId, unpaidTaskId, closedTaskId],
      operatorId: adminId,
      reason: 'preproduction legacy pending task audit closure',
    })
    if (first.disposedTaskIds.length === 3 && first.alreadyDisposedTaskIds.length === 0) {
      pass('管理员可一次处置三个合格历史 pending 任务')
    } else fail(`unexpected first disposition response: ${JSON.stringify(first)}`)

    const disposed = await prisma.printTask.findMany({
      where: { id: { in: [bareTaskId, unpaidTaskId, closedTaskId] } },
      orderBy: { id: 'asc' },
    })
    if (
      disposed.length === 3 &&
      disposed.every(
        (task) =>
          task.status === 'cancelled' &&
          task.completedAt &&
          task.errorCode === 'LEGACY_PENDING_TASK_DISPOSED'
      )
    ) {
      pass('合格任务变为 cancelled 终态，带确定性运维错误码和终态时间')
    } else fail(`disposed task rows mismatch: ${JSON.stringify(disposed)}`)

    const disposedOrders = await prisma.order.findMany({
      where: { printTaskId: { in: [unpaidTaskId, closedTaskId] } },
    })
    if (
      disposedOrders.length === 2 &&
      disposedOrders.every((order) => order.taskStatus === 'cancelled') &&
      disposedOrders.some((order) => order.payStatus === 'unpaid') &&
      disposedOrders.some((order) => order.payStatus === 'closed')
    ) {
      pass('关联订单只镜像 taskStatus=cancelled，不篡改 unpaid/closed 支付事实')
    } else fail(`disposed orders mismatch: ${JSON.stringify(disposedOrders)}`)

    const [logs, audits] = await Promise.all([
      prisma.printTaskStatusLog.findMany({
        where: { taskId: { in: [bareTaskId, unpaidTaskId, closedTaskId] } },
      }),
      prisma.auditLog.findMany({
        where: {
          targetId: { in: [bareTaskId, unpaidTaskId, closedTaskId] },
          action: 'print_task.legacy_pending_disposed',
        },
      }),
    ])
    if (
      logs.length === 3 &&
      logs.every(
        (row) =>
          row.fromStatus === 'pending' &&
          row.toStatus === 'cancelled' &&
          row.errorCode === 'LEGACY_PENDING_TASK_DISPOSED'
      ) &&
      audits.length === 3 &&
      audits.every((row) => row.actorId === adminId && row.actorRole === 'admin')
    ) {
      pass('每个任务都有 pending→cancelled 状态日志与 Admin 审计')
    } else fail(`audit/log mismatch: logs=${JSON.stringify(logs)} audits=${JSON.stringify(audits)}`)

    const second = await service.dispose({
      taskIds: [bareTaskId, unpaidTaskId, closedTaskId],
      operatorId: adminId,
      reason: 'same operation retry',
    })
    const [logsAfterRetry, auditsAfterRetry] = await Promise.all([
      prisma.printTaskStatusLog.count({
        where: { taskId: { in: [bareTaskId, unpaidTaskId, closedTaskId] } },
      }),
      prisma.auditLog.count({
        where: {
          targetId: { in: [bareTaskId, unpaidTaskId, closedTaskId] },
          action: 'print_task.legacy_pending_disposed',
        },
      }),
    ])
    if (
      second.disposedTaskIds.length === 0 &&
      second.alreadyDisposedTaskIds.length === 3 &&
      logsAfterRetry === 3 &&
      auditsAfterRetry === 3
    ) {
      pass('重复受控处置幂等，不追加状态日志或审计')
    } else
      fail(`idempotency mismatch: ${JSON.stringify({ second, logsAfterRetry, auditsAfterRetry })}`)

    const printJobs = new PrintJobsService(
      prisma,
      null as never,
      null as never,
      null as never,
      null as never
    )
    const cancelledStatus = await printJobs.getStatus(unpaidTaskId)
    if (
      cancelledStatus.status === 'cancelled' &&
      cancelledStatus.errorCode === 'LEGACY_PENDING_TASK_DISPOSED' &&
      !cancelledStatus.failureReasonForUser
    ) {
      pass('Kiosk 查询受控关闭任务不伪装为设备打印失败')
    } else fail(`cancelled Kiosk status mismatch: ${JSON.stringify(cancelledStatus)}`)

    const { TerminalsService } = await import('../src/terminals/terminals.service')
    const terminals = new TerminalsService(prisma, null as never, null as never)
    const terminalAck = await terminals.patchTaskStatus(
      unpaidTaskId,
      { status: 'printing' },
      `Bearer ${terminalToken}`,
      terminalId
    )
    const terminalProtected = await prisma.printTask.findUnique({ where: { id: unpaidTaskId } })
    if (terminalAck.acknowledged && terminalProtected?.status === 'cancelled') {
      pass('Agent 状态回传不能重写 cancelled 终态')
    } else
      fail(
        `cancelled terminal-state protection mismatch: ${JSON.stringify({ terminalAck, terminalProtected })}`
      )

    await expectReject(
      '新创建任务被 cutoff 拒绝',
      () =>
        service.dispose({
          taskIds: [freshTaskId],
          operatorId: adminId,
          reason: 'must reject fresh task',
        }),
      'PRINT_TASK_NOT_LEGACY_PENDING'
    )
    await expectReject(
      '已支付订单被拒绝',
      () =>
        service.dispose({
          taskIds: [paidTaskId],
          operatorId: adminId,
          reason: 'must reject paid task',
        }),
      'PRINT_TASK_PAYMENT_PROTECTED'
    )
    await expectReject(
      '已领取任务被拒绝',
      () =>
        service.dispose({
          taskIds: [claimedTaskId],
          operatorId: adminId,
          reason: 'must reject claimed task',
        }),
      'PRINT_TASK_NOT_LEGACY_PENDING'
    )
    await expectReject(
      '非管理员操作员被拒绝',
      () =>
        service.dispose({
          taskIds: [freshTaskId],
          operatorId: nonAdminId,
          reason: 'must reject non-admin',
        }),
      'ADMIN_OPERATOR_REQUIRED'
    )
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
