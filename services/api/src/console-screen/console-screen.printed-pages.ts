/**
 * 大屏「累计打印页数」= 真正出纸的打印任务 × 份数。
 *
 * 为什么单独一个文件：旧口径是「已支付订单的内容页之和」，一条 order.aggregate 就够，
 * 放在 console-screen.queries.ts 里。新口径要逐任务解析页数来源（材料包行 / 单文件订单）
 * 与 Agent 实际执行的份数，还要分批读、设行数上限，逻辑与 queries.ts 其它切片无关，
 * 塞进去会把那个文件推到 500 行以上。
 *
 * 口径（走查 W-68，9/29）：
 *   - 只计出纸完成的任务：status=completed 且没有被核查为未出纸，或「未确认出纸」的失败任务
 *     经管理员现场核查为 printed。失败 / 取消 / 未派发 / 进行中都不算。与服务调用里「已出纸」同一判据。
 *   - 每个任务的页数 = 计费页数（后端识别的文档页数 ∩ pageRange 选中页，即 Agent 实际送打的页）× 份数。
 *     计费页数优先取材料包行（OrderItem.printTaskId=本任务），其次取单文件订单（Order.printTaskId=本任务）；
 *     两者都没有的任务（例如开发环境自检任务）没有可信页数，不计，也不拿前端报的 pages 顶。
 *   - 份数取任务参数里的 copies（Agent 按它打印），缺失或非法按 1 份（Agent 同样按 1 份）。
 *   - 这是「印面数」：双面打印时纸张数少于页数；N 合 1 目前被下单校验锁成 1，不需要折算。
 *   - 不看订单是否仍为已支付：纸已经出了，退款与否不改变出纸量。
 */
import type { PrismaService } from '../prisma/prisma.service'

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
    const rows: Array<{ id: string; paramsJson: string; order: { billablePages: number | null } | null }> =
      await prisma.printTask.findMany({
        where: PRINTED_TASK_WHERE,
        select: { id: true, paramsJson: true, order: { select: { billablePages: true } } },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
    if (rows.length === 0) break
    seen += rows.length
    if (seen > rowCap) return 'capped'
    const items = await prisma.orderItem.findMany({
      where: { printTaskId: { in: rows.map((row) => row.id) } },
      select: { printTaskId: true, billablePages: true },
    })
    const itemPages = new Map<string, number>()
    for (const item of items) {
      const pages = validPages(item.billablePages)
      if (item.printTaskId && pages !== null) itemPages.set(item.printTaskId, pages)
    }
    for (const row of rows) {
      const pages = itemPages.get(row.id) ?? validPages(row.order?.billablePages)
      if (pages === null) continue
      total += pages * taskCopies(row.paramsJson)
    }
    const last = rows[rows.length - 1]
    if (rows.length < batchSize || !last) break
    cursor = last.id
  }
  return total
}
