/**
 * Admin print order actions verification.
 *
 * Covers the narrow write surface used by Admin order ops:
 * - pending print order can be cancelled, mirroring PrintTask and Order status
 * - pending print order can be reassigned to an enabled terminal
 * - claimed/terminal-state orders cannot be changed
 * - disabled/missing target terminals are rejected
 * - status logs and audit logs are written without exposing file content
 *
 * Run: pnpm --filter @ai-job-print/api verify:admin-print-order-actions
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { AuditService } from '../src/audit/audit.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { AdminPrintOrderActionsService } from '../src/payment/admin-print-order-actions.service'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new Error(message)
}

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } }
    | undefined
  return resp?.error?.code
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label}: expected ${code}, got success`)
  } catch (e) {
    const actual = errCode(e)
    if (actual === code) pass(label)
    else fail(`${label}: expected ${code}, got ${actual ?? (e as Error).message}`)
  }
}

async function main(): Promise<void> {
  console.log('\n=== Admin print order actions verification ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const service = new AdminPrintOrderActionsService(prisma, audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const terminalA = `t_apoa_a_${suffix}`
  const terminalB = `t_apoa_b_${suffix}`
  const terminalDisabled = `t_apoa_disabled_${suffix}`
  const taskCancel = `ptask_apoa_cancel_${suffix}`
  const taskReassign = `ptask_apoa_reassign_${suffix}`
  const taskClaimed = `ptask_apoa_claimed_${suffix}`
  const taskCompleted = `ptask_apoa_completed_${suffix}`
  const orderCancel = `ord_apoa_cancel_${suffix}`
  const orderReassign = `ord_apoa_reassign_${suffix}`
  const orderClaimed = `ord_apoa_claimed_${suffix}`
  const orderCompleted = `ord_apoa_completed_${suffix}`

  const allTaskIds = [taskCancel, taskReassign, taskClaimed, taskCompleted]
  const allOrderIds = [orderCancel, orderReassign, orderClaimed, orderCompleted]
  const allTerminalIds = [terminalA, terminalB, terminalDisabled]

  async function cleanup(): Promise<void> {
    await prisma.auditLog.deleteMany({
      where: { targetType: 'order', targetId: { in: allOrderIds } },
    })
    await prisma.order.deleteMany({ where: { id: { in: allOrderIds } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: allTaskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: allTaskIds } } })
    await prisma.terminal.deleteMany({ where: { id: { in: allTerminalIds } } })
  }

  async function createTaskAndOrder(input: {
    taskId: string
    orderId: string
    orderNo: string
    status: string
    terminalId: string
  }): Promise<void> {
    await prisma.printTask.create({
      data: {
        id: input.taskId,
        terminalId: input.terminalId,
        fileUrl: 'https://internal.example/admin-action-source.pdf',
        fileMd5: 'sha256-admin-action-source',
        paramsJson: JSON.stringify({ fileName: `${input.orderNo}.pdf`, copies: 1 }),
        status: input.status,
        claimedAt: input.status === 'claimed' ? new Date() : null,
        completedAt: input.status === 'completed' ? new Date() : null,
      },
    })
    await prisma.order.create({
      data: {
        id: input.orderId,
        orderNo: input.orderNo,
        type: 'print',
        printTaskId: input.taskId,
        terminalId: input.terminalId,
        amountCents: 100,
        currency: 'CNY',
        payStatus: input.orderNo.includes('PAID') ? 'paid' : 'unpaid',
        taskStatus: input.status,
      },
    })
  }

  try {
    await cleanup()

    await prisma.terminal.createMany({
      data: [
        {
          id: terminalA,
          terminalCode: `APOA-A-${suffix}`,
          agentToken: `tok-a-${suffix}`,
          deviceFingerprint: 'verify-admin-print-actions',
        },
        {
          id: terminalB,
          terminalCode: `APOA-B-${suffix}`,
          agentToken: `tok-b-${suffix}`,
          deviceFingerprint: 'verify-admin-print-actions',
        },
        {
          id: terminalDisabled,
          terminalCode: `APOA-D-${suffix}`,
          agentToken: `tok-d-${suffix}`,
          deviceFingerprint: 'verify-admin-print-actions',
          enabled: false,
        },
      ],
    })

    await createTaskAndOrder({
      taskId: taskCancel,
      orderId: orderCancel,
      orderNo: `ORD-APOA-CANCEL-${suffix}`,
      status: 'pending',
      terminalId: terminalA,
    })
    await createTaskAndOrder({
      taskId: taskReassign,
      orderId: orderReassign,
      orderNo: `ORD-APOA-REASSIGN-PAID-${suffix}`,
      status: 'pending',
      terminalId: terminalA,
    })
    await createTaskAndOrder({
      taskId: taskClaimed,
      orderId: orderClaimed,
      orderNo: `ORD-APOA-CLAIMED-${suffix}`,
      status: 'claimed',
      terminalId: terminalA,
    })
    await createTaskAndOrder({
      taskId: taskCompleted,
      orderId: orderCompleted,
      orderNo: `ORD-APOA-COMPLETED-${suffix}`,
      status: 'completed',
      terminalId: terminalA,
    })
    pass('fixtures created')

    const cancelResult = await service.cancelOrder(orderCancel, {
      reason: 'operator requested cancellation',
      operatorId: 'admin_verify',
    })
    const cancelledTask = await prisma.printTask.findUnique({ where: { id: taskCancel } })
    const cancelledOrder = await prisma.order.findUnique({ where: { id: orderCancel } })
    const cancelLog = await prisma.printTaskStatusLog.findFirst({ where: { taskId: taskCancel } })
    if (
      cancelResult.taskStatus === 'cancelled' &&
      cancelledTask?.status === 'cancelled' &&
      cancelledTask.errorCode === 'ADMIN_CANCELLED' &&
      cancelledOrder?.taskStatus === 'cancelled' &&
      cancelledOrder.payStatus === 'unpaid' &&
      cancelLog?.fromStatus === 'pending' &&
      cancelLog.toStatus === 'cancelled'
    ) {
      pass('pending print order cancel mirrors task/order status and preserves payStatus')
    } else {
      fail(`cancel mismatch: ${JSON.stringify({ cancelResult, cancelledTask, cancelledOrder, cancelLog })}`)
    }

    const reassignResult = await service.reassignOrder(orderReassign, {
      terminalId: terminalB,
      reason: 'move to healthy terminal',
      operatorId: 'admin_verify',
    })
    const reassignedTask = await prisma.printTask.findUnique({ where: { id: taskReassign } })
    const reassignedOrder = await prisma.order.findUnique({ where: { id: orderReassign } })
    const reassignLog = await prisma.printTaskStatusLog.findFirst({ where: { taskId: taskReassign } })
    if (
      reassignResult.taskStatus === 'pending' &&
      reassignResult.terminalId === terminalB &&
      reassignedTask?.status === 'pending' &&
      reassignedTask.terminalId === terminalB &&
      reassignedOrder?.taskStatus === 'pending' &&
      reassignedOrder.terminalId === terminalB &&
      reassignedOrder.payStatus === 'paid' &&
      reassignLog?.fromStatus === 'pending' &&
      reassignLog.toStatus === 'pending' &&
      reassignLog.errorCode === 'ADMIN_REASSIGNED'
    ) {
      pass('pending print order reassign changes target terminal and preserves payment state')
    } else {
      fail(`reassign mismatch: ${JSON.stringify({ reassignResult, reassignedTask, reassignedOrder, reassignLog })}`)
    }

    await expectCode(
      () => service.cancelOrder(orderClaimed, { operatorId: 'admin_verify' }),
      'ORDER_TASK_NOT_PENDING',
      'claimed order cannot be cancelled by Admin action',
    )
    await expectCode(
      () => service.reassignOrder(orderCompleted, { terminalId: terminalB, operatorId: 'admin_verify' }),
      'ORDER_TASK_NOT_PENDING',
      'completed order cannot be reassigned by Admin action',
    )
    await expectCode(
      () => service.reassignOrder(orderCompleted, { terminalId: 'missing-terminal', operatorId: 'admin_verify' }),
      'ORDER_TASK_NOT_PENDING',
      'terminal lookup is not reached for non-pending orders',
    )
    await expectCode(
      () => service.reassignOrder(orderCancel, { terminalId: terminalDisabled, operatorId: 'admin_verify' }),
      'ORDER_TASK_NOT_PENDING',
      'cancelled order cannot be reassigned after terminal state',
    )

    const pendingForDisabled = `ptask_apoa_disabled_target_${suffix}`
    const orderForDisabled = `ord_apoa_disabled_target_${suffix}`
    allTaskIds.push(pendingForDisabled)
    allOrderIds.push(orderForDisabled)
    await createTaskAndOrder({
      taskId: pendingForDisabled,
      orderId: orderForDisabled,
      orderNo: `ORD-APOA-DISABLED-${suffix}`,
      status: 'pending',
      terminalId: terminalA,
    })
    await expectCode(
      () => service.reassignOrder(orderForDisabled, { terminalId: terminalDisabled, operatorId: 'admin_verify' }),
      'TERMINAL_DISABLED',
      'pending order cannot be reassigned to disabled terminal',
    )
    await expectCode(
      () => service.reassignOrder(orderForDisabled, { terminalId: `missing-${suffix}`, operatorId: 'admin_verify' }),
      'TERMINAL_NOT_FOUND',
      'pending order cannot be reassigned to missing terminal',
    )

    const audits = await prisma.auditLog.findMany({
      where: { targetType: 'order', targetId: { in: [orderCancel, orderReassign] } },
      orderBy: { createdAt: 'asc' },
    })
    const auditBlob = JSON.stringify(audits)
    if (
      audits.some((a) => a.action === 'order.print.cancel') &&
      audits.some((a) => a.action === 'order.print.reassign') &&
      !auditBlob.includes('admin-action-source.pdf') &&
      !auditBlob.includes('sha256-admin-action-source')
    ) {
      pass('cancel/reassign audit logs are written without file URL or hash leakage')
    } else {
      fail(`audit mismatch: ${auditBlob}`)
    }

    await expectCode(
      () => service.cancelOrder(`missing-order-${suffix}`, {}),
      'ORDER_NOT_FOUND',
      'missing order is rejected with ORDER_NOT_FOUND',
    )
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  if (error instanceof BadRequestException || error instanceof NotFoundException) {
    console.error('\nUnexpected HTTP exception:', JSON.stringify(error.getResponse()))
  } else {
    console.error('\nFatal error:', (error as Error).message)
  }
  console.error((error as Error).stack)
  process.exit(1)
})
