/**
 * Admin print operations verification.
 *
 * Covers the commercial safety rules for first-release print operations:
 * - admin can cancel pending / claimed / printing tasks only
 * - admin can reassign pending / failed tasks only
 * - reassign never touches claimed / printing tasks, preventing double output
 * - disabled / unknown terminals cannot be assigned
 * - cancelled is an idempotent terminal state for late Agent callbacks
 * - responses expose safe metadata only; audit + status logs are written
 *
 * Run: pnpm --filter @ai-job-print/api verify:admin-print-ops
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'

process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-print-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-print-terminal-action-secret-0123456789'

import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { AdminOrdersReadonlyService } from '../src/admin-orders-readonly/admin-orders-readonly.service'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new Error(message)
}

function errCode(error: unknown): string | undefined {
  const ex = error as { getResponse?: () => unknown; response?: unknown }
  const response = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } }
    | undefined
  return response?.error?.code
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — expected ${code}, but no error was thrown`)
  } catch (error) {
    const actual = errCode(error)
    if (actual === code) {
      pass(label)
      return
    }
    fail(`${label} — expected ${code}, got ${actual ?? (error as Error).message}`)
  }
}

async function main(): Promise<void> {
  const { TerminalToolboxService } = await import('../src/terminals/terminal-toolbox.service')
  const { TerminalsService } = await import('../src/terminals/terminals.service')

  console.log('\n=== Admin print operations verification ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const orders = new AdminOrdersReadonlyService(prisma, audit)
  const toolbox = new TerminalToolboxService(prisma)
  const terminals = new TerminalsService(prisma, toolbox)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const terminalA = { id: `t_apo_a_${suffix}`, code: `KSK-APO-A-${suffix}`, token: `tok-apo-a-${suffix}` }
  const terminalB = { id: `t_apo_b_${suffix}`, code: `KSK-APO-B-${suffix}`, token: `tok-apo-b-${suffix}` }
  const disabled = { id: `t_apo_x_${suffix}`, code: `KSK-APO-X-${suffix}`, token: `tok-apo-x-${suffix}` }
  const taskIds: string[] = []
  const orderIds: string[] = []

  async function cleanup(): Promise<void> {
    const allTasks = await prisma.printTask.findMany({
      where: { id: { startsWith: `ptask_apo_${suffix}` } },
      select: { id: true },
    })
    const allTaskIds = [...new Set([...taskIds, ...allTasks.map((task) => task.id)])]
    await prisma.order.deleteMany({ where: { id: { startsWith: `ord_apo_${suffix}` } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: allTaskIds } } })
    await prisma.auditLog.deleteMany({
      where: {
        action: { in: ['print_task.admin_cancel', 'print_task.admin_reassign'] },
        targetId: { in: allTaskIds },
      },
    })
    await prisma.printTask.deleteMany({ where: { id: { in: allTaskIds } } })
    await prisma.terminal.deleteMany({ where: { id: { in: [terminalA.id, terminalB.id, disabled.id] } } })
  }

  async function createFixture(status: string, label: string): Promise<{ taskId: string; orderId: string }> {
    const taskId = `ptask_apo_${suffix}_${label}`
    const orderId = `ord_apo_${suffix}_${label}`
    taskIds.push(taskId)
    orderIds.push(orderId)
    await prisma.printTask.create({
      data: {
        id: taskId,
        terminalId: terminalA.id,
        fileUrl: `https://internal.example/${label}/secret-file-url`,
        fileMd5: `sha256-secret-${label}`,
        paramsJson: JSON.stringify({
          fileName: `${label}.pdf`,
          copies: 1,
          colorMode: 'black_white',
          paperSize: 'A4',
          unsafeField: 'must-not-leak',
        }),
        status,
        claimedAt: status === 'claimed' || status === 'printing' ? new Date('2026-06-30T09:00:00.000Z') : null,
        claimExpiry: status === 'claimed' ? new Date('2026-06-30T09:05:00.000Z') : null,
        completedAt: status === 'completed' ? new Date('2026-06-30T09:10:00.000Z') : null,
        errorCode: status === 'failed' ? 'PRINTER_OFFLINE' : null,
        errorMessage: status === 'failed' ? 'internal printer trace must not leak' : null,
      },
    })
    await prisma.order.create({
      data: {
        id: orderId,
        orderNo: `ORD-APO-${suffix.toUpperCase()}-${label.toUpperCase()}`,
        type: 'print',
        printTaskId: taskId,
        terminalId: terminalA.id,
        amountCents: 0,
        currency: 'CNY',
        payStatus: 'unpaid',
        taskStatus: status,
      },
    })
    return { taskId, orderId }
  }

  const actor = {
    actorId: null,
    actorRole: 'admin',
    ipAddress: '127.0.0.1',
    userAgent: 'verify-admin-print-ops',
    requestId: `req-apo-${suffix}`,
  }

  try {
    await cleanup()
    await prisma.terminal.createMany({
      data: [
        { id: terminalA.id, terminalCode: terminalA.code, agentToken: terminalA.token, deviceFingerprint: 'apo-a' },
        { id: terminalB.id, terminalCode: terminalB.code, agentToken: terminalB.token, deviceFingerprint: 'apo-b' },
        {
          id: disabled.id,
          terminalCode: disabled.code,
          agentToken: disabled.token,
          deviceFingerprint: 'apo-disabled',
          enabled: false,
        },
      ],
    })
    pass('terminal fixtures created')

    const pending = await createFixture('pending', 'pending')
    const claimed = await createFixture('claimed', 'claimed')
    const printing = await createFixture('printing', 'printing')
    const completed = await createFixture('completed', 'completed')
    const failed = await createFixture('failed', 'failed')
    const pendingReassign = await createFixture('pending', 'pending_reassign')
    const claimedReassign = await createFixture('claimed', 'claimed_reassign')
    const disabledReassign = await createFixture('failed', 'disabled_reassign')

    for (const fixture of [pending, claimed, printing]) {
      const detail = await orders.cancelPrintTask(fixture.orderId, { ...actor, reason: 'verify cancel' })
      const task = await prisma.printTask.findUnique({ where: { id: fixture.taskId } })
      if (
        detail.taskStatus === 'cancelled' &&
        detail.print?.status === 'cancelled' &&
        task?.status === 'cancelled' &&
        task.completedAt instanceof Date
      ) {
        pass(`cancel ${fixture.taskId} writes cancelled terminal state`)
      } else {
        fail(`cancel result mismatch: ${JSON.stringify({ detail, task })}`)
      }
    }

    await expectCode(
      () => orders.cancelPrintTask(completed.orderId, { ...actor, reason: 'should fail' }),
      'PRINT_TASK_CANCEL_NOT_ALLOWED',
      'completed task cannot be cancelled',
    )

    const reassignedFailed = await orders.reassignPrintTask(failed.orderId, terminalB.id, {
      ...actor,
      reason: 'verify reassign failed',
    })
    const failedTask = await prisma.printTask.findUnique({ where: { id: failed.taskId } })
    if (
      reassignedFailed.taskStatus === 'pending' &&
      reassignedFailed.terminalCode === terminalB.code &&
      failedTask?.terminalId === terminalB.id &&
      failedTask.status === 'pending' &&
      failedTask.claimedAt === null &&
      failedTask.claimExpiry === null &&
      failedTask.errorCode === null &&
      failedTask.errorMessage === null &&
      failedTask.completedAt === null
    ) {
      pass('failed task can be safely reassigned and reset to pending')
    } else {
      fail(`failed reassign mismatch: ${JSON.stringify({ reassignedFailed, failedTask })}`)
    }

    const reassignedPending = await orders.reassignPrintTask(pendingReassign.orderId, terminalB.code, {
      ...actor,
      reason: 'verify reassign pending by code',
    })
    if (reassignedPending.taskStatus === 'pending' && reassignedPending.terminalCode === terminalB.code) {
      pass('pending task can be reassigned by terminalCode')
    } else {
      fail(`pending reassign mismatch: ${JSON.stringify(reassignedPending)}`)
    }

    await expectCode(
      () => orders.reassignPrintTask(claimedReassign.orderId, terminalB.id, { ...actor, reason: 'should fail' }),
      'PRINT_TASK_REASSIGN_NOT_ALLOWED',
      'claimed task cannot be reassigned',
    )
    await expectCode(
      () => orders.reassignPrintTask(disabledReassign.orderId, disabled.id, { ...actor, reason: 'should fail' }),
      'PRINT_TARGET_TERMINAL_DISABLED',
      'disabled terminal cannot be reassigned as target',
    )
    await expectCode(
      () => orders.reassignPrintTask(disabledReassign.orderId, `missing-${suffix}`, { ...actor, reason: 'should fail' }),
      'PRINT_TARGET_TERMINAL_NOT_FOUND',
      'unknown terminal cannot be reassigned as target',
    )

    const statusLogs = await prisma.printTaskStatusLog.findMany({
      where: { taskId: { in: taskIds } },
      orderBy: { createdAt: 'asc' },
    })
    const audits = await prisma.auditLog.findMany({
      where: {
        action: { in: ['print_task.admin_cancel', 'print_task.admin_reassign'] },
        targetId: { in: taskIds },
      },
    })
    if (
      statusLogs.some((log) => log.toStatus === 'cancelled' && log.errorCode === 'ADMIN_CANCELLED') &&
      statusLogs.some((log) => log.toStatus === 'pending' && log.errorCode === 'ADMIN_REASSIGNED') &&
      audits.some((log) => log.action === 'print_task.admin_cancel') &&
      audits.some((log) => log.action === 'print_task.admin_reassign')
    ) {
      pass('status logs and audit logs are written for admin operations')
    } else {
      fail(`missing logs: ${JSON.stringify({ statusLogs, audits })}`)
    }

    const lateAck = await terminals.patchTaskStatus(pending.taskId, { status: 'completed' }, `Bearer ${terminalA.token}`, terminalA.id)
    const cancelledAfterLateAck = await prisma.printTask.findUnique({ where: { id: pending.taskId } })
    if (lateAck.acknowledged === true && cancelledAfterLateAck?.status === 'cancelled') {
      pass('cancelled task ignores late Agent status callback idempotently')
    } else {
      fail(`late ack mismatch: ${JSON.stringify({ lateAck, cancelledAfterLateAck })}`)
    }

    const safeDetail = await orders.getById(failed.orderId)
    const serialized = JSON.stringify(safeDetail)
    for (const banned of [
      'secret-file-url',
      'sha256-secret',
      'paramsJson',
      'fileUrl',
      'fileMd5',
      'errorMessage',
      'internal printer trace',
      'must-not-leak',
      terminalA.id,
      terminalB.id,
    ]) {
      if (serialized.includes(banned)) fail(`response leaked banned field/value: ${banned}`)
    }
    pass('operation responses expose safe metadata only')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
