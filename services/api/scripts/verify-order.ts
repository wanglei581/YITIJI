/**
 * Order model + print-job accounting verification.
 *
 * This exercises production services directly, without HTTP:
 * - PrintJobsService.create() must create a PrintTask and its Order in one flow.
 * - TerminalsService status transitions must mirror into Order.taskStatus.
 * - PrintTasks without an Order must still work for legacy/seed safety.
 */
import 'dotenv/config'
import { randomBytes, randomUUID } from 'crypto'

process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-print-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-print-terminal-action-secret-0123456789'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-print-file-signing-secret-0123456789abcd'

import { AuditService } from '../src/audit/audit.service'
import { signFileUrl } from '../src/files/signing'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PRINT_UNIT_PRICE_CENTS } from '../src/print-jobs/print-pricing'
import { PrismaService } from '../src/prisma/prisma.service'

const ORDER_NO_PATTERN = /^ORD-\d{8}-[0-9A-F]{10}$/

const PRINT_PARAMS = {
  copies: 2,
  colorMode: 'color' as const,
  duplex: 'simplex' as const,
  paperSize: 'A4' as const,
  orientation: 'auto' as const,
  quality: 'standard' as const,
  scale: 'fit' as const,
  pagesPerSheet: 1 as const,
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const { TerminalToolboxService } = await import('../src/terminals/terminal-toolbox.service')
  const { TerminalsService } = await import('../src/terminals/terminals.service')

  console.log('\n=== Order model + print-job accounting verification ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()

  const audit = new AuditService(prisma)
  const printJobs = new PrintJobsService(prisma, audit)
  const toolbox = new TerminalToolboxService(prisma)
  const terminals = new TerminalsService(prisma, toolbox)
  const resetExpiredClaims = (
    terminals as unknown as { resetExpiredClaims: () => Promise<void> }
  ).resetExpiredClaims.bind(terminals)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const terminalId = `t_order_${suffix}`
  const terminalToken = randomBytes(16).toString('hex')
  const endUserId = `eu_order_${suffix}`
  const taskIds: string[] = []

  const signedUrl = (label: string) => signFileUrl(`f_order_${suffix}_${label}`, 60_000).url

  async function cleanup(): Promise<void> {
    await prisma.order.deleteMany({ where: { printTaskId: { in: taskIds } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.auditLog.deleteMany({
      where: { targetId: { in: taskIds }, action: 'print_job.create' },
    })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
  }

  try {
    await cleanup()

    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `KSK-ORD-${suffix}`,
        agentToken: terminalToken,
        deviceFingerprint: 'verify-order',
      },
    })
    await prisma.endUser.create({
      data: {
        id: endUserId,
        phoneHash: `order-${endUserId}`,
        phoneEnc: `order-enc-${endUserId}`,
        nickname: '订单验证会员',
      },
    })
    pass('test fixtures created')

    const anonymousPrint = await printJobs.create(
      {
        fileUrl: signedUrl('anonymous'),
        fileMd5: 'sha256-order-anonymous',
        fileName: '匿名打印.pdf',
        params: PRINT_PARAMS,
      },
      { endUserId: null, ipAddress: '127.0.0.1', userAgent: 'verify-order', terminalId },
    )
    taskIds.push(anonymousPrint.taskId)

    if (
      anonymousPrint.taskId.startsWith('ptask_kiosk_') &&
      anonymousPrint.status === 'pending' &&
      !Number.isNaN(Date.parse(anonymousPrint.createdAt))
    ) {
      pass('print-job create contract remains { taskId, status, createdAt }')
    } else {
      fail(`unexpected create response: ${JSON.stringify(anonymousPrint)}`)
    }

    const anonymousOrder = await prisma.order.findUnique({
      where: { printTaskId: anonymousPrint.taskId },
    })
    if (
      anonymousOrder &&
      ORDER_NO_PATTERN.test(anonymousOrder.orderNo) &&
      anonymousOrder.type === 'print' &&
      anonymousOrder.amountCents === 0 &&
      anonymousOrder.currency === 'CNY' &&
      anonymousOrder.payStatus === 'unpaid' &&
      anonymousOrder.taskStatus === 'pending' &&
      anonymousOrder.endUserId === null &&
      anonymousOrder.terminalId === terminalId
    ) {
      pass('anonymous print creates a terminal-bound pending unpaid print Order with amountCents=0')
    } else {
      fail(`anonymous order mismatch: ${JSON.stringify(anonymousOrder)}`)
    }

    const memberPrint = await printJobs.create(
      {
        fileUrl: signedUrl('member'),
        fileMd5: 'sha256-order-member',
        fileName: '会员打印.pdf',
        params: PRINT_PARAMS,
      },
      { endUserId, terminalId },
    )
    taskIds.push(memberPrint.taskId)

    const memberOrder = await prisma.order.findUnique({
      where: { printTaskId: memberPrint.taskId },
    })
    if (memberOrder?.endUserId === endUserId && memberOrder.payStatus === 'unpaid') {
      pass('member endUserId is copied into Order')
    } else {
      fail(`member order mismatch: ${JSON.stringify(memberOrder)}`)
    }

    const statusPrint = await printJobs.create(
      {
        fileUrl: signedUrl('status'),
        fileMd5: 'sha256-order-status',
        fileName: '状态镜像.pdf',
        params: PRINT_PARAMS,
      },
      { endUserId: null, terminalId },
    )
    taskIds.push(statusPrint.taskId)
    await prisma.printTask.update({
      where: { id: statusPrint.taskId },
      data: { createdAt: new Date(0) },
    })

    const claimed = await terminals.claimTasks(
      terminalId,
      { maxTasks: 1 },
      `Bearer ${terminalToken}`,
    )
    if (claimed[0]?.taskId !== statusPrint.taskId) {
      fail(`claimTasks claimed unexpected task: ${JSON.stringify(claimed)}`)
    }

    const claimedOrder = await prisma.order.findUnique({
      where: { printTaskId: statusPrint.taskId },
    })
    if (claimedOrder?.taskStatus === 'claimed' && claimedOrder.terminalId === terminalId) {
      pass('claimTasks mirrors taskStatus=claimed and terminalId into Order')
    } else {
      fail(`claimed order mismatch: ${JSON.stringify(claimedOrder)}`)
    }

    await terminals.patchTaskStatus(
      statusPrint.taskId,
      { status: 'printing' },
      `Bearer ${terminalToken}`,
      terminalId,
    )
    const printingOrder = await prisma.order.findUnique({
      where: { printTaskId: statusPrint.taskId },
    })
    if (printingOrder?.taskStatus === 'printing') {
      pass('patchTaskStatus mirrors taskStatus=printing into Order')
    } else {
      fail(`printing order mismatch: ${JSON.stringify(printingOrder)}`)
    }

    await terminals.patchTaskStatus(
      statusPrint.taskId,
      { status: 'completed' },
      `Bearer ${terminalToken}`,
      terminalId,
    )
    const completedTask = await prisma.printTask.findUnique({ where: { id: statusPrint.taskId } })
    const completedOrder = await prisma.order.findUnique({
      where: { printTaskId: statusPrint.taskId },
    })
    if (
      completedTask?.status === 'completed' &&
      completedTask.completedAt &&
      completedOrder?.taskStatus === 'completed'
    ) {
      pass('patchTaskStatus mirrors taskStatus=completed while PrintTask keeps completedAt')
    } else {
      fail(`completed mirror mismatch: task=${JSON.stringify(completedTask)} order=${JSON.stringify(completedOrder)}`)
    }

    const expiredPrint = await printJobs.create(
      {
        fileUrl: signedUrl('expired'),
        fileMd5: 'sha256-order-expired',
        fileName: '超时回收.pdf',
        params: PRINT_PARAMS,
      },
      { endUserId: null, terminalId },
    )
    taskIds.push(expiredPrint.taskId)
    await prisma.printTask.update({
      where: { id: expiredPrint.taskId },
      data: {
        status: 'claimed',
        terminalId,
        claimedAt: new Date(),
        claimExpiry: new Date(Date.now() - 1000),
      },
    })
    await prisma.order.updateMany({
      where: { printTaskId: expiredPrint.taskId },
      data: { taskStatus: 'claimed', terminalId },
    })
    await resetExpiredClaims()

    const resetTask = await prisma.printTask.findUnique({ where: { id: expiredPrint.taskId } })
    const resetOrder = await prisma.order.findUnique({
      where: { printTaskId: expiredPrint.taskId },
    })
    if (
      resetTask?.status === 'pending' &&
      resetTask.terminalId === terminalId &&
      resetOrder?.taskStatus === 'pending' &&
      resetOrder.terminalId === terminalId
    ) {
      pass('resetExpiredClaims mirrors expired tasks back to pending while preserving target terminalId')
    } else {
      fail(`reset mirror mismatch: task=${JSON.stringify(resetTask)} order=${JSON.stringify(resetOrder)}`)
    }

    const bareTaskId = `ptask_bare_${suffix}`
    taskIds.push(bareTaskId)
    await prisma.printTask.create({
      data: {
        id: bareTaskId,
        fileUrl: 'sig://bare',
        fileMd5: 'sha256-bare',
        paramsJson: JSON.stringify(PRINT_PARAMS),
        status: 'claimed',
        terminalId,
        claimedAt: new Date(),
      },
    })
    const bareAck = await terminals.patchTaskStatus(
      bareTaskId,
      { status: 'printing' },
      `Bearer ${terminalToken}`,
      terminalId,
    )
    const bareOrder = await prisma.order.findUnique({ where: { printTaskId: bareTaskId } })
    if (bareAck.acknowledged && bareOrder === null) {
      pass('legacy PrintTask without Order can still transition without creating an Order')
    } else {
      fail(`legacy no-order task mismatch: ack=${JSON.stringify(bareAck)} order=${JSON.stringify(bareOrder)}`)
    }

    if (PRINT_UNIT_PRICE_CENTS.black_white === 20 && PRINT_UNIT_PRICE_CENTS.color === 50) {
      pass('print pricing constants match kiosk display price: black_white=20, color=50')
    } else {
      fail(`unexpected pricing constants: ${JSON.stringify(PRINT_UNIT_PRICE_CENTS)}`)
    }
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
