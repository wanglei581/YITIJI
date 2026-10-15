import { payableCents } from '../payment/pending-refund-signal'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import { printOrderSideCount } from './verified-print-parameters'
import {
  FREE_PRINT_IN_FLIGHT_STATUSES,
  FREE_PRINT_UNCONFIRMED_ERROR_CODE,
  beijingDayBounds,
  freePrintQuotaNow,
} from './free-print-quota.policy'

export type FreePrintQuotaDb = PrismaService | PrismaTransactionClient

export interface FreePrintUsage {
  terminalUsed: number
  terminalInFlight: number
  memberUsed: number
  memberInFlight: number
}

interface TaskSlice {
  id: string
  terminalId: string | null
  endUserId: string | null
  status: string
  errorCode: string | null
  paramsJson: string
  orderId: string | null
}

interface OrderSlice {
  id: string
  printTaskId: string | null
  amountCents: number
  discountCents: number
  billablePages: number | null
  printParamsJson: string | null
}

interface ItemSlice {
  printTaskId: string | null
  billablePages: number
  copies: number
}

const TASK_SELECT = {
  id: true,
  terminalId: true,
  endUserId: true,
  status: true,
  errorCode: true,
  paramsJson: true,
  orderId: true,
} as const

/** 成功出纸才计入 used。反向变异：把 failed 加进这个列表，失败任务也会占额度。 */
const COUNTED_PAPER_STATUSES: readonly string[] = ['completed']

export function reprintRequestedSides(
  item: { billablePages: number; copies: number } | null,
  order: { billablePages: number | null; printParamsJson: string | null } | null,
  paramsJson: string | null,
): number {
  if (item) return item.billablePages * item.copies
  return printOrderSideCount([], {
    billablePages: order?.billablePages ?? null,
    printParamsJson: paramsJson || order?.printParamsJson || null,
  })
}

function isFreeOrder(order: OrderSlice | undefined): boolean {
  if (!order) return true
  return payableCents(order) <= 0
}

function sidesOf(task: TaskSlice, order: OrderSlice | undefined, item: ItemSlice | undefined): number {
  if (item) return item.billablePages * item.copies
  if (!order) return 0
  return printOrderSideCount([], {
    billablePages: order.billablePages,
    printParamsJson: task.paramsJson || order.printParamsJson,
  })
}

async function attachSides(
  db: FreePrintQuotaDb,
  tasks: TaskSlice[],
): Promise<Map<string, { free: boolean; sides: number }>> {
  const result = new Map<string, { free: boolean; sides: number }>()
  if (tasks.length === 0) return result
  // 终端列表门禁的内存桩有任务表、没有订单表。查不到订单就按 0 面，不把桩打成异常。
  if (typeof db.order?.findMany !== 'function' || typeof db.orderItem?.findMany !== 'function') return result
  const taskIds = tasks.map((task) => task.id)
  const orderIds = tasks.flatMap((task) => (task.orderId ? [task.orderId] : []))
  const [orders, items] = await Promise.all([
    db.order.findMany({
      where: {
        OR: [
          { printTaskId: { in: taskIds } },
          ...(orderIds.length > 0 ? [{ id: { in: orderIds } }] : []),
        ],
      },
      select: {
        id: true,
        printTaskId: true,
        amountCents: true,
        discountCents: true,
        billablePages: true,
        printParamsJson: true,
      },
    }),
    db.orderItem.findMany({
      where: { printTaskId: { in: taskIds } },
      select: { printTaskId: true, billablePages: true, copies: true },
    }),
  ])
  const orderByTask = new Map<string, OrderSlice>()
  const orderById = new Map<string, OrderSlice>()
  for (const order of orders) {
    orderById.set(order.id, order)
    if (order.printTaskId) orderByTask.set(order.printTaskId, order)
  }
  const itemByTask = new Map<string, ItemSlice>()
  for (const item of items) {
    if (item.printTaskId) itemByTask.set(item.printTaskId, item)
  }
  for (const task of tasks) {
    const order = orderByTask.get(task.id) ?? (task.orderId ? orderById.get(task.orderId) : undefined)
    result.set(task.id, { free: isFreeOrder(order), sides: sidesOf(task, order, itemByTask.get(task.id)) })
  }
  return result
}

async function loadUsageTasks(
  db: FreePrintQuotaDb,
  terminalId: string,
  endUserId: string | null,
  start: Date,
  end: Date,
): Promise<TaskSlice[]> {
  const window = { gte: start, lt: end }
  // errorCode 为空是正常成功单。SQL 的 NOT (errorCode = 未确认) 会把 NULL 行丢掉，必须显式留下。
  const completed = {
    status: { in: [...COUNTED_PAPER_STATUSES] },
    completedAt: window,
    OR: [
      { errorCode: null },
      { errorCode: { not: FREE_PRINT_UNCONFIRMED_ERROR_CODE } },
    ],
  }
  const inFlight = {
    status: { in: [...FREE_PRINT_IN_FLIGHT_STATUSES] },
    createdAt: window,
  }
  // 余量与预判都按本机过滤。反向变异：去掉 terminalId，别的机器的用量会算进这台。
  const scope = endUserId
    ? { OR: [{ terminalId }, { endUserId }] }
    : { terminalId }
  return db.printTask.findMany({
    where: { AND: [scope, { OR: [completed, inFlight] }] },
    select: TASK_SELECT,
  })
}

export async function loadFreePrintUsage(
  db: FreePrintQuotaDb,
  terminalId: string,
  endUserId: string | null,
  now: Date,
): Promise<FreePrintUsage> {
  const bounds = beijingDayBounds(now)
  const tasks = await loadUsageTasks(db, terminalId, endUserId, bounds.start, bounds.end)
  const sides = await attachSides(db, tasks)
  const usage: FreePrintUsage = { terminalUsed: 0, terminalInFlight: 0, memberUsed: 0, memberInFlight: 0 }
  for (const task of tasks) {
    const row = sides.get(task.id)
    if (!row?.free) continue
    const inFlight = (FREE_PRINT_IN_FLIGHT_STATUSES as readonly string[]).includes(task.status)
    const printed = COUNTED_PAPER_STATUSES.includes(task.status) && task.errorCode !== FREE_PRINT_UNCONFIRMED_ERROR_CODE
    if (task.terminalId === terminalId) {
      if (printed) usage.terminalUsed += row.sides
      // 在途计入预判。反向变异：删掉下面这个加法，两单在途时第三单会放行。
      if (inFlight) usage.terminalInFlight += row.sides
    }
    if (endUserId && task.endUserId === endUserId) {
      if (printed) usage.memberUsed += row.sides
      if (inFlight) usage.memberInFlight += row.sides
    }
  }
  return usage
}

/** 管理员终端列表：今天已出纸的免费面数。一次查出再按终端加总。 */
export async function todayFreePrintSidesByTerminal(
  db: FreePrintQuotaDb,
  terminalIds: string[],
  now: Date = freePrintQuotaNow(),
): Promise<Map<string, number>> {
  const totals = new Map<string, number>(terminalIds.map((id) => [id, 0]))
  if (terminalIds.length === 0) return totals
  // 终端列表门禁把 Prisma 收成只含 terminal 的桩。没有任务表就全部记 0。
  if (typeof db.printTask?.findMany !== 'function') return totals
  const bounds = beijingDayBounds(now)
  const tasks = await db.printTask.findMany({
    where: {
      terminalId: { in: terminalIds },
      status: { in: [...COUNTED_PAPER_STATUSES] },
      completedAt: { gte: bounds.start, lt: bounds.end },
      OR: [
        { errorCode: null },
        { errorCode: { not: FREE_PRINT_UNCONFIRMED_ERROR_CODE } },
      ],
    },
    select: TASK_SELECT,
  })
  const sides = await attachSides(db, tasks)
  for (const task of tasks) {
    if (!task.terminalId || task.errorCode === FREE_PRINT_UNCONFIRMED_ERROR_CODE) continue
    const row = sides.get(task.id)
    if (!row?.free) continue
    totals.set(task.terminalId, (totals.get(task.terminalId) ?? 0) + row.sides)
  }
  return totals
}
