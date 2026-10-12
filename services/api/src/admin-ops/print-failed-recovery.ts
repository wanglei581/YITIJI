import type { Prisma } from '../generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import { PRINTED_TASK_WHERE } from '../console-screen/console-screen.printed-pages'

/**
 * 打印机状态类失败码。这几种是机器当时的状态：同一台之后又能打出来，就可以当作误报或已经恢复。
 * 不在这里的照旧挂着等人看：PRINT_JOB_UNCONFIRMED、PARTIAL_OUTPUT、PRINT_TIMEOUT 出纸盘里可能有纸，要人核实；
 * DOWNLOAD_HASH_MISMATCH、UNSUPPORTED_FILE_TYPE、FILE_NOT_FOUND 是文件问题，机器恢复了也说明不了那一单；
 * 没登记的码、errorCode 为空，同样不自动消失。
 */
export const PRINTER_STATE_FAILURE_CODES = [
  'PRINTER_ERROR',
  'PRINTER_OFFLINE',
  'PAPER_EMPTY',
  'PRINTER_NOT_FOUND',
  'PRINT_COMMAND_FAILED',
] as const

/**
 * 没有钱要退。
 * 单文件订单挂在 Order.printTaskId（关系名 order）上，PrintTask.orderId 只在材料包明细释放时才写。
 * 不能把 orderId 为空单独当成「没有订单」，否则收过钱的单文件失败会在机器恢复后被清掉。
 * 算没有钱要退的两种：根本没有关联订单；或者关联订单 amountCents 为 0。
 */
const NO_MONEY_TO_REFUND_OR: Prisma.PrintTaskWhereInput[] = [
  { orderId: null, order: { is: null } },
  { order: { amountCents: 0 } },
]

const NO_MONEY_TO_REFUND: Prisma.PrintTaskWhereInput = { OR: NO_MONEY_TO_REFUND_OR }

/** 与 failedTaskWhere 里「未核查」同一句，候选终端只从还可能告警的失败里挑。 */
const NOT_YET_VERIFIED: Prisma.PrintTaskWhereInput = {
  OR: [
    { printOutcome: null },
    { printOutcome: { notIn: ['printed', 'not_printed'] } },
  ],
}

/**
 * 拼进失败告警 where 的排除条件。三条同时成立才排除：状态类失败码、没有钱要退、
 * 同一台终端在这条失败的 updatedAt 之后出过纸（出纸判据复用 PRINTED_TASK_WHERE，且 completedAt 晚于失败）。
 * 先只取有资格排除的失败涉及的终端，再按终端取回看窗口内最晚的出纸完成时间，最后交给数据库过滤。
 * 没有这样的终端时返回 null，调用方不加这段。
 */
export async function printerRecoveredExclusion(
  prisma: PrismaService,
  lookbackStart: Date,
): Promise<Prisma.PrintTaskWhereInput | null> {
  const eligible = await prisma.printTask.findMany({
    where: {
      status: 'failed',
      updatedAt: { gte: lookbackStart },
      terminalId: { not: null },
      errorCode: { in: [...PRINTER_STATE_FAILURE_CODES] },
      AND: [
        NOT_YET_VERIFIED,
        { NOT: { order: { payStatus: 'refunded' } } },
        NO_MONEY_TO_REFUND,
      ],
    },
    select: { terminalId: true },
    distinct: ['terminalId'],
    orderBy: { terminalId: 'asc' },
  })
  const terminalIds = eligible.flatMap((row) => (row.terminalId ? [row.terminalId] : []))
  if (terminalIds.length === 0) return null

  const grouped = await prisma.printTask.groupBy({
    by: ['terminalId'],
    where: {
      terminalId: { in: terminalIds },
      completedAt: { gte: lookbackStart },
      ...PRINTED_TASK_WHERE,
    },
    _max: { completedAt: true },
  })

  const clauses = grouped.flatMap((row) => {
    const recoveredAt = row._max.completedAt
    if (!row.terminalId || !recoveredAt) return []
    return [{
      terminalId: row.terminalId,
      updatedAt: { lt: recoveredAt },
      errorCode: { in: [...PRINTER_STATE_FAILURE_CODES] },
      OR: NO_MONEY_TO_REFUND_OR,
    }]
  })
  if (clauses.length === 0) return null
  return { NOT: { OR: clauses } }
}
