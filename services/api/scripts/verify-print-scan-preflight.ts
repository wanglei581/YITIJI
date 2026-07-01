/**
 * Print/scan production preflight verification.
 *
 * Normal mode is read-only: it checks for unfinished print tasks/orders that
 * cannot be safely claimed because they are missing a target terminal binding.
 *
 * Self-test mode creates isolated fixtures in the configured database and then
 * cleans them up. Use it only against local/temporary databases.
 *
 * Run:
 *   pnpm --filter @ai-job-print/api verify:print-scan-preflight
 *   pnpm --filter @ai-job-print/api verify:print-scan-preflight:postgres
 *   pnpm --filter @ai-job-print/api verify:print-scan-preflight -- --self-test
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'

const UNFINISHED_PRINT_STATUSES = ['pending', 'claimed', 'printing'] as const
const PREFLIGHT_ROW_LIMIT = 1000
const PREFLIGHT_QUERY_TAKE = PREFLIGHT_ROW_LIMIT + 1
type UnfinishedPrintStatus = typeof UNFINISHED_PRINT_STATUSES[number]

interface PreflightIssue {
  code: string
  message: string
  taskId?: string
  orderId?: string
  orderNo?: string
  taskStatus?: string
  orderTaskStatus?: string
  taskTerminalId?: string | null
  orderTerminalId?: string | null
  createdAt?: string
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new Error(message)
}

function isUnfinishedStatus(status: string | null | undefined): status is UnfinishedPrintStatus {
  return UNFINISHED_PRINT_STATUSES.includes(status as UnfinishedPrintStatus)
}

function assertPostgresDatabaseUrl(): void {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) {
    fail('DATABASE_URL environment variable is required')
  }
  if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    fail('--require-postgres requires DATABASE_URL to use postgresql:// or postgres://')
  }
}

async function collectPreflightIssues(prisma: PrismaService): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = []

  const unboundTasks = await prisma.printTask.findMany({
    where: {
      status: { in: [...UNFINISHED_PRINT_STATUSES] },
      terminalId: null,
    },
    orderBy: { createdAt: 'asc' },
    take: PREFLIGHT_QUERY_TAKE,
    select: {
      id: true,
      status: true,
      terminalId: true,
      createdAt: true,
      order: {
        select: {
          id: true,
          orderNo: true,
          taskStatus: true,
          terminalId: true,
        },
      },
    },
  })

  if (unboundTasks.length > PREFLIGHT_ROW_LIMIT) {
    issues.push({
      code: 'PRINT_PREFLIGHT_RESULT_LIMIT_EXCEEDED',
      message: `未完成 PrintTask 缺少目标终端的结果超过 ${PREFLIGHT_ROW_LIMIT} 条，需先按数据库分页排查，避免遗漏上线前处置对象`,
    })
  }

  for (const task of unboundTasks.slice(0, PREFLIGHT_ROW_LIMIT)) {
    issues.push({
      code: 'PRINT_TASK_TARGET_TERMINAL_MISSING',
      message: '未完成 PrintTask 缺少目标终端，Terminal Agent 不会 claim，需上线前人工取消或补绑定后复核',
      taskId: task.id,
      orderId: task.order?.id,
      orderNo: task.order?.orderNo,
      taskStatus: task.status,
      orderTaskStatus: task.order?.taskStatus,
      taskTerminalId: task.terminalId,
      orderTerminalId: task.order?.terminalId ?? null,
      createdAt: task.createdAt.toISOString(),
    })
  }

  const unfinishedOrders = await prisma.order.findMany({
    where: {
      type: 'print',
      taskStatus: { in: [...UNFINISHED_PRINT_STATUSES] },
      printTaskId: { not: null },
    },
    orderBy: { createdAt: 'asc' },
    take: PREFLIGHT_QUERY_TAKE,
    select: {
      id: true,
      orderNo: true,
      printTaskId: true,
      taskStatus: true,
      terminalId: true,
      createdAt: true,
      printTask: {
        select: {
          id: true,
          status: true,
          terminalId: true,
        },
      },
    },
  })

  if (unfinishedOrders.length > PREFLIGHT_ROW_LIMIT) {
    issues.push({
      code: 'PRINT_PREFLIGHT_RESULT_LIMIT_EXCEEDED',
      message: `未完成打印订单结果超过 ${PREFLIGHT_ROW_LIMIT} 条，本次预检不会判定通过，需先按数据库分页排查目标终端绑定与任务镜像一致性`,
    })
  }

  for (const order of unfinishedOrders.slice(0, PREFLIGHT_ROW_LIMIT)) {
    if (!order.terminalId) {
      issues.push({
        code: 'PRINT_ORDER_TARGET_TERMINAL_MISSING',
        message: '未完成打印订单缺少目标终端，Order 镜像状态不可用于安全运营，需上线前人工处置',
        taskId: order.printTaskId ?? undefined,
        orderId: order.id,
        orderNo: order.orderNo,
        orderTaskStatus: order.taskStatus,
        taskStatus: order.printTask?.status,
        taskTerminalId: order.printTask?.terminalId ?? null,
        orderTerminalId: order.terminalId,
        createdAt: order.createdAt.toISOString(),
      })
    }

    if (
      order.printTask &&
      isUnfinishedStatus(order.printTask.status) &&
      order.terminalId &&
      order.printTask.terminalId &&
      order.terminalId !== order.printTask.terminalId
    ) {
      issues.push({
        code: 'PRINT_ORDER_TASK_TERMINAL_MISMATCH',
        message: '未完成打印订单与 PrintTask 的目标终端不一致，可能导致后台运营判断和 Agent claim 目标不一致',
        taskId: order.printTask.id,
        orderId: order.id,
        orderNo: order.orderNo,
        orderTaskStatus: order.taskStatus,
        taskStatus: order.printTask.status,
        taskTerminalId: order.printTask.terminalId,
        orderTerminalId: order.terminalId,
        createdAt: order.createdAt.toISOString(),
      })
    }
  }

  return issues
}

function printIssues(issues: PreflightIssue[]): void {
  for (const issue of issues) {
    console.error(`  FAIL ${issue.code}: ${issue.message}`)
    console.error(
      `       order=${issue.orderNo ?? issue.orderId ?? '-'} task=${issue.taskId ?? '-'} ` +
      `taskStatus=${issue.taskStatus ?? '-'} orderTaskStatus=${issue.orderTaskStatus ?? '-'} ` +
      `taskTerminal=${issue.taskTerminalId ?? '-'} orderTerminal=${issue.orderTerminalId ?? '-'} ` +
      `createdAt=${issue.createdAt ?? '-'}`,
    )
  }
}

async function runSelfTest(prisma: PrismaService): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    fail('--self-test refuses to run with NODE_ENV=production')
  }
  if (prisma.dbKind !== 'sqlite') {
    fail('--self-test must run against an isolated SQLite database')
  }

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const terminalA = `t_psp_a_${suffix}`
  const terminalB = `t_psp_b_${suffix}`
  const goodTask = `ptask_psp_good_${suffix}`
  const badTask = `ptask_psp_bad_${suffix}`
  const mismatchTask = `ptask_psp_mismatch_${suffix}`
  const goodOrder = `ord_psp_good_${suffix}`
  const badOrder = `ord_psp_bad_${suffix}`
  const mismatchOrder = `ord_psp_mismatch_${suffix}`

  async function cleanup(): Promise<void> {
    await prisma.order.deleteMany({ where: { id: { in: [goodOrder, badOrder, mismatchOrder] } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: [goodTask, badTask, mismatchTask] } } })
    await prisma.printTask.deleteMany({ where: { id: { in: [goodTask, badTask, mismatchTask] } } })
    await prisma.terminal.deleteMany({ where: { id: { in: [terminalA, terminalB] } } })
  }

  await cleanup()
  try {
    await prisma.terminal.createMany({
      data: [
        { id: terminalA, terminalCode: `PSP-A-${suffix}`, agentToken: `tok-a-${suffix}`, deviceFingerprint: 'preflight-self-test-a' },
        { id: terminalB, terminalCode: `PSP-B-${suffix}`, agentToken: `tok-b-${suffix}`, deviceFingerprint: 'preflight-self-test-b' },
      ],
    })
    await prisma.printTask.create({
      data: {
        id: goodTask,
        terminalId: terminalA,
        fileUrl: 'self-test://good',
        fileMd5: 'sha256-good',
        paramsJson: '{}',
        status: 'pending',
      },
    })
    await prisma.order.create({
      data: {
        id: goodOrder,
        orderNo: `ORD-PSP-GOOD-${suffix}`,
        type: 'print',
        printTaskId: goodTask,
        terminalId: terminalA,
        amountCents: 0,
        currency: 'CNY',
        payStatus: 'unpaid',
        taskStatus: 'pending',
      },
    })

    await prisma.printTask.create({
      data: {
        id: badTask,
        fileUrl: 'self-test://bad',
        fileMd5: 'sha256-bad',
        paramsJson: '{}',
        status: 'pending',
      },
    })
    await prisma.order.create({
      data: {
        id: badOrder,
        orderNo: `ORD-PSP-BAD-${suffix}`,
        type: 'print',
        printTaskId: badTask,
        amountCents: 0,
        currency: 'CNY',
        payStatus: 'unpaid',
        taskStatus: 'pending',
      },
    })

    await prisma.printTask.create({
      data: {
        id: mismatchTask,
        terminalId: terminalA,
        fileUrl: 'self-test://mismatch',
        fileMd5: 'sha256-mismatch',
        paramsJson: '{}',
        status: 'pending',
      },
    })
    await prisma.order.create({
      data: {
        id: mismatchOrder,
        orderNo: `ORD-PSP-MISMATCH-${suffix}`,
        type: 'print',
        printTaskId: mismatchTask,
        terminalId: terminalB,
        amountCents: 0,
        currency: 'CNY',
        payStatus: 'unpaid',
        taskStatus: 'pending',
      },
    })

    const issues = await collectPreflightIssues(prisma)
    const codes = new Set(issues.map((issue) => issue.code))
    if (
      codes.has('PRINT_TASK_TARGET_TERMINAL_MISSING') &&
      codes.has('PRINT_ORDER_TARGET_TERMINAL_MISSING') &&
      codes.has('PRINT_ORDER_TASK_TERMINAL_MISMATCH') &&
      !issues.some((issue) => issue.taskId === goodTask || issue.orderId === goodOrder)
    ) {
      pass('--self-test detects unbound unfinished task/order and terminal mismatch')
      return
    }
    printIssues(issues)
    fail('--self-test did not detect the expected preflight issues')
  } finally {
    await cleanup()
  }
}

async function main(): Promise<void> {
  console.log('\n=== print/scan production preflight verification ===')
  const isSelfTest = process.argv.includes('--self-test')
  if (!isSelfTest && process.argv.includes('--require-postgres')) {
    assertPostgresDatabaseUrl()
  }

  const prisma = new PrismaService()
  await prisma.onModuleInit()

  try {
    if (isSelfTest) {
      await runSelfTest(prisma)
      console.log('\nALL PASS: print/scan preflight self-test')
      return
    }

    const issues = await collectPreflightIssues(prisma)
    if (issues.length > 0) {
      printIssues(issues)
      fail(`print/scan preflight blocked by ${issues.length} historical data issue(s)`)
    }

    pass('no unfinished print tasks/orders are missing target terminal binding')
    pass('no unfinished print orders disagree with PrintTask target terminal')
    console.log('\nALL PASS: print/scan production preflight verification')
  } finally {
    await prisma.onModuleDestroy()
  }
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
