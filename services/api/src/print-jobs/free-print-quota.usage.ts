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

/**
 * 屏上复印与打印共用这三条免费额度，按计费面数（billableSides）计。
 * 出纸成功（handed）才计入 used；unconfirmed、failed、cancelled、expired 与确认前的状态都不计。
 */
const COPY_COUNTED_STATES: readonly string[] = ['handed']
/** 复印在途：已确认、已派发、已进打印队列，还可能出纸。 */
const COPY_IN_FLIGHT_STATES: readonly string[] = ['confirmed', 'dispatching', 'spooled']

interface CopySlice {
  terminalId: string
  endUserId: string | null
  state: string
  billableSides: number
  expiresAt: Date
  orderId: string | null
}

const COPY_SELECT = {
  terminalId: true,
  endUserId: true,
  state: true,
  billableSides: true,
  expiresAt: true,
  orderId: true,
} as const

/** handed 是终态，updatedAt 即出纸回报时刻，对齐打印按 completedAt 落到北京自然日。 */
function copyHandedWithin(start: Date, end: Date) {
  return {
    state: { in: [...COPY_COUNTED_STATES] },
    updatedAt: { gte: start, lt: end },
    // 会员注销清洗会改老单的 updatedAt。复印单建好十分钟内必须派发，只看昨天 0 点以后建的单，老单不挤占当天额度。
    createdAt: { gte: new Date(start.getTime() - 24 * 3600_000) },
  }
}

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

function isFreeOrder(order: { amountCents: number; discountCents: number } | undefined): boolean {
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
    // 续打和状态变更会刷新 updatedAt；长期无更新的旧任务不再永久占用额度。
    OR: [{ createdAt: window }, { updatedAt: window }],
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

/** 复印的已用与在途，范围与窗口取法同打印：终端按 terminalId、会员按 endUserId，在途看当天创建或当天有更新。 */
async function loadUsageCopies(
  db: FreePrintQuotaDb,
  terminalId: string,
  endUserId: string | null,
  start: Date,
  end: Date,
): Promise<CopySlice[]> {
  // 只有打印表的门禁桩没有复印表，按没有复印处理。
  if (typeof db.copyJob?.findMany !== 'function') return []
  const inFlight = {
    state: { in: [...COPY_IN_FLIGHT_STATES] },
    OR: [{ createdAt: { gte: start, lt: end } }, { updatedAt: { gte: start, lt: end } }],
  }
  const scope = endUserId ? { OR: [{ terminalId }, { endUserId }] } : { terminalId }
  return db.copyJob.findMany({
    where: { AND: [scope, { OR: [copyHandedWithin(start, end), inFlight] }] },
    select: COPY_SELECT,
  })
}

/** 只算 0 元单，与打印 isFreeOrder 同口径（看关联订单）。printed = 出纸成功，否则是在途。 */
async function countableCopies(
  db: FreePrintQuotaDb,
  copies: CopySlice[],
  now: Date,
): Promise<Array<CopySlice & { printed: boolean }>> {
  if (copies.length === 0 || typeof db.order?.findMany !== 'function') return []
  const orderIds = copies.flatMap((job) => (job.orderId ? [job.orderId] : []))
  const orders = orderIds.length === 0 ? [] : await db.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, amountCents: true, discountCents: true },
  })
  const orderById = new Map(orders.map((order) => [order.id, order]))
  return copies.flatMap((job) => {
    if (!isFreeOrder(job.orderId ? orderById.get(job.orderId) : undefined)) return []
    const printed = COPY_COUNTED_STATES.includes(job.state)
    // 已确认但过了有效期的单拿不到打印许可，不会再出纸，不占在途；已派发的照打印在途算到当天结束。
    if (!printed && job.state === 'confirmed' && job.expiresAt.getTime() <= now.getTime()) return []
    return [{ ...job, printed }]
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
  const copies = await loadUsageCopies(db, terminalId, endUserId, bounds.start, bounds.end)
  for (const job of await countableCopies(db, copies, now)) {
    if (job.terminalId === terminalId) {
      if (job.printed) usage.terminalUsed += job.billableSides
      else usage.terminalInFlight += job.billableSides
    }
    if (endUserId && job.endUserId === endUserId) {
      if (job.printed) usage.memberUsed += job.billableSides
      else usage.memberInFlight += job.billableSides
    }
  }
  return usage
}

/** 管理员终端列表与 80% 告警：今天已出纸的免费面数（打印加复印，额度共用）。一次查出再按终端加总。 */
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
  const copies = typeof db.copyJob?.findMany === 'function'
    ? await db.copyJob.findMany({
        where: { terminalId: { in: terminalIds }, ...copyHandedWithin(bounds.start, bounds.end) },
        select: COPY_SELECT,
      })
    : []
  for (const job of await countableCopies(db, copies, now)) {
    if (job.printed) totals.set(job.terminalId, (totals.get(job.terminalId) ?? 0) + job.billableSides)
  }
  return totals
}
