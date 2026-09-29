/**
 * 大屏打印页数：累计、近 14 天趋势、单台「今日打印页数」共用同一套出纸页数。
 *
 * 为什么单独一个文件：console-screen.queries.ts 已约 460 行，趋势若留在那里会继续堆功能；
 * console-screen.types.ts 已约 510 行，只放契约。单台孪生若再写一遍页数公式，两处会分叉。
 *
 * 口径（累计走查 W-68；趋势与单台今日与累计对齐，2026-09-29）：
 *   - 只计真正出纸的任务，判据 PRINTED_TASK_WHERE。
 *   - 页数 = 计费页 × 份数。计费页优先材料包行（OrderItem.printTaskId），否则单文件订单
 *     （Order.printTaskId）；都没有则不计，不采信任务参数里的 pages / billablePages。
 *   - 份数取任务参数 copies（Agent 按它打），缺失或非法按 1，上限 99。
 *   - 这是印面数：双面时用纸更少。退款不扣，纸已经出了。
 *
 * 落日用 PrintTask.completedAt，按上海自然日。东八区无夏令时，与北京时间是同一天；
 * 复用 console-screen.metric 的 shanghaiDayStart / shanghaiDayKey，不另起时区。
 *   - Agent 进入终态时写入 completedAt（patchTaskStatus：completed / failed / cancelled）。
 *   - 超时关单（resetExpiredClaims）标 failed + PRINT_JOB_UNCONFIRMED，同时写入 completedAt。
 *   - 管理员事后核查只写 printOutcome，不改 completedAt。updatedAt 会被这次写入抬高，
 *     所以核查为 printed 的任务落在关单那天，不落在点击核查那天。
 *   - 不用订单支付时间：付款经常早于出纸，跨过零点会记错天。
 *   - 不用 createdAt：任务创建时还没出纸。
 *   - 不用 updatedAt：核查和任何后写都会改它。服务调用里「已出纸笔数」对没有完成时间的
 *     核查任务才回退 updatedAt，那是笔数不是页数，这里不跟着回退。
 *   - completedAt 为空的出纸任务仍计入累计，但不放进任何一天。
 *
 * PrintTask 没有 completedAt 索引。本文件不新增迁移。14 天查询有行数上限，超了如实不给数。
 * 单台一日不另设上限：返回值是数字，设上限就会把没算完的数当成全天。
 */
import type { PrismaService } from '../prisma/prisma.service'
import type { ScreenPrintTrendValue } from './console-screen.types'
import {
  PRINT_TREND_DAY_COUNT,
  PRINT_TREND_ROW_CAP,
  daysAgoStart,
  shanghaiDayKey,
  shanghaiDayStart,
} from './console-screen.metric'

/** 出纸判据。printOutcome=not_printed 的 completed 任务按未出纸处理（显式写 null，避免 NOT 对空值失效）。 */
export const PRINTED_TASK_WHERE = {
  OR: [
    { status: 'completed', printOutcome: null },
    { printOutcome: 'printed' },
  ],
}

/** 累计扫描的任务行上限。超过就不给数（按「行数超上限」如实未计算），不给算少了的累计。 */
export const PRINTED_PAGES_ROW_CAP = 200_000
const PRINTED_PAGES_BATCH = 1_000
const MAX_COPIES = 99
const DAY_MS = 24 * 60 * 60 * 1000

/** 累计打印页数的来源说明。与改口径之前的字符串保持一致。 */
export const PRINTED_PAGES_SOURCE =
  'PrintTask(completed|printOutcome=printed) × copies; OrderItem/Order.billablePages'

/** 近 14 天趋势的来源说明。单台今日页数没有单独的 source 字段，算法与这条相同，窗口是当天。 */
export const PRINTED_PAGES_BY_COMPLETION_SOURCE =
  'PrintTask.completedAt(completed|printOutcome=printed) × copies; OrderItem/Order.billablePages'

const PRINTED_TASK_PAGE_SELECT = {
  id: true,
  paramsJson: true,
  completedAt: true,
  order: { select: { billablePages: true } },
} as const

/** Agent 实际执行的份数：正整数取原值（上限 99，与下单校验一致），其余按 1。 */
export function taskCopies(paramsJson: string): number {
  let raw: unknown
  try {
    raw = JSON.parse(paramsJson)
  } catch {
    return 1
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 1
  const copies = (raw as Record<string, unknown>)['copies']
  if (typeof copies !== 'number' || !Number.isInteger(copies) || copies < 1) return 1
  return Math.min(copies, MAX_COPIES)
}

function validPages(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

type PageSourceRow = {
  id: string
  paramsJson: string
  order: { billablePages: number | null } | null
}

/** 每个出纸任务贡献的页数（计费页 × 份数）。没有可信页数的任务不在结果里。 */
async function pagesByPrintedTask(
  prisma: Pick<PrismaService, 'orderItem'>,
  rows: PageSourceRow[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let offset = 0; offset < rows.length; offset += PRINTED_PAGES_BATCH) {
    const chunk = rows.slice(offset, offset + PRINTED_PAGES_BATCH)
    const items = await prisma.orderItem.findMany({
      where: { printTaskId: { in: chunk.map((row) => row.id) } },
      select: { printTaskId: true, billablePages: true },
    })
    const itemPages = new Map<string, number>()
    for (const item of items) {
      const pages = validPages(item.billablePages)
      if (item.printTaskId && pages !== null) itemPages.set(item.printTaskId, pages)
    }
    for (const row of chunk) {
      const pages = itemPages.get(row.id) ?? validPages(row.order?.billablePages)
      if (pages === null) continue
      out.set(row.id, pages * taskCopies(row.paramsJson))
    }
  }
  return out
}

/** 出纸日窗口。to 是开区间右端（下一个上海零点，或趋势窗口的下一天零点），不是 now。 */
function completionWhere(from: Date, to: Date): { completedAt: { gte: Date; lt: Date } } {
  return { completedAt: { gte: from, lt: to } }
}

/** 落日时刻。只认 completedAt；为空则调用方不得把它放进任何一天。 */
function completionInstant(row: { completedAt: Date | null }): Date | null {
  return row.completedAt instanceof Date ? row.completedAt : null
}

function printedInWindow(from: Date, to: Date, terminalId?: string) {
  return {
    ...PRINTED_TASK_WHERE,
    ...completionWhere(from, to),
    ...(terminalId === undefined ? {} : { terminalId }),
  }
}

/**
 * 累计出纸页数。返回 'capped' 表示任务行超过上限、本次不给数。
 * rowCap / batchSize 只供门禁注入。
 */
export async function loadPrintedPagesTotal(
  prisma: Pick<PrismaService, 'printTask' | 'orderItem'>,
  options?: { rowCap?: number; batchSize?: number },
): Promise<number | 'capped'> {
  const rowCap = options?.rowCap ?? PRINTED_PAGES_ROW_CAP
  const batchSize = options?.batchSize ?? PRINTED_PAGES_BATCH
  let total = 0
  let seen = 0
  let cursor: string | null = null
  for (;;) {
    const rows: PageSourceRow[] = await prisma.printTask.findMany({
      where: PRINTED_TASK_WHERE,
      select: { id: true, paramsJson: true, order: { select: { billablePages: true } } },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    })
    if (rows.length === 0) break
    seen += rows.length
    if (seen > rowCap) return 'capped'
    const pages = await pagesByPrintedTask(prisma, rows)
    for (const value of pages.values()) total += value
    const last = rows[rows.length - 1]
    if (rows.length < batchSize || !last) break
    cursor = last.id
  }
  return total
}

function bucketPrintedPages(
  rows: Array<{ id: string; completedAt: Date | null }>,
  pages: Map<string, number>,
  from: Date,
): ScreenPrintTrendValue {
  const buckets = new Map<string, number>()
  for (let index = 0; index < PRINT_TREND_DAY_COUNT; index += 1) {
    buckets.set(shanghaiDayKey(new Date(from.getTime() + index * DAY_MS)), 0)
  }
  for (const row of rows) {
    const at = completionInstant(row)
    if (!at) continue
    const key = shanghaiDayKey(at)
    const current = buckets.get(key)
    if (current === undefined) continue
    const contributed = pages.get(row.id)
    if (contributed === undefined) continue
    buckets.set(key, current + contributed)
  }
  const days = Array.from(buckets.entries()).map(([date, pageCount]) => ({ date, pages: pageCount }))
  const peak = days.reduce<ScreenPrintTrendValue['peak']>((best, item) => {
    if (!best || item.pages > best.pages) return item
    return best
  }, null)
  return { days, peak: peak && peak.pages > 0 ? peak : null }
}

/**
 * 近 14 个上海自然日的出纸页数。窗口右端是明天零点，不是 now，所以今天晚些时候完成的也算今天。
 * 返回 'capped' 表示窗口内任务行超过上限。rowCap 只供门禁注入。
 */
export async function loadPrintedPagesTrend(
  prisma: Pick<PrismaService, 'printTask' | 'orderItem'>,
  now: Date,
  options?: { rowCap?: number },
): Promise<ScreenPrintTrendValue | 'capped'> {
  const rowCap = options?.rowCap ?? PRINT_TREND_ROW_CAP
  const from = daysAgoStart(now, PRINT_TREND_DAY_COUNT)
  const to = new Date(shanghaiDayStart(now).getTime() + DAY_MS)
  const rows = await prisma.printTask.findMany({
    where: printedInWindow(from, to),
    select: PRINTED_TASK_PAGE_SELECT,
    orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
    take: rowCap + 1,
  })
  if (rows.length > rowCap) return 'capped'
  const pages = await pagesByPrintedTask(prisma, rows)
  return bucketPrintedPages(rows, pages, from)
}

/**
 * 一台终端在 now 所在上海自然日的出纸页数（未做「少于 5」隐藏，隐藏由孪生调用方做）。
 * 再按完成时刻滤一次：查询条件被改成别的时间字段时，不会把窗口外的任务加进今天。
 */
export async function loadTerminalPrintedPagesToday(
  prisma: Pick<PrismaService, 'printTask' | 'orderItem'>,
  terminalId: string,
  now: Date,
): Promise<number> {
  const from = shanghaiDayStart(now)
  const to = new Date(from.getTime() + DAY_MS)
  const rows = await prisma.printTask.findMany({
    where: printedInWindow(from, to, terminalId),
    select: PRINTED_TASK_PAGE_SELECT,
  })
  const pages = await pagesByPrintedTask(prisma, rows)
  let total = 0
  for (const row of rows) {
    const at = completionInstant(row)
    if (at === null || at.getTime() < from.getTime() || at.getTime() >= to.getTime()) continue
    total += pages.get(row.id) ?? 0
  }
  return total
}
