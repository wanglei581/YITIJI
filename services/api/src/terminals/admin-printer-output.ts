/**
 * 管理员打印机列表的「本系统出纸」。
 * 出纸判据与「计费页 × 份数」复用大屏 W-68：PRINTED_TASK_WHERE、pagesByPrintedTask。
 * 今天的落日复用 shanghaiDayStart。本月是上海自然月（无夏令时）。
 * 彩色、双面只看这条任务自己的 paramsJson（终端程序按它打）。
 * 一次按终端 id 列表查完再加总。行数超过上限时整批不给数。
 */
import { Injectable } from '@nestjs/common'
import { PRINTED_TASK_WHERE, pagesByPrintedTask } from '../console-screen/console-screen.printed-pages'
import { shanghaiDayStart } from '../console-screen/console-screen.metric'
import type { PrismaService } from '../prisma/prisma.service'

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
export const ADMIN_PRINTER_OUTPUT_ROW_CAP = 50_000

export interface AdminPrinterOutputSides {
  sides: number
  colorSides: number
  duplexSides: number
}

export interface AdminPrinterOutput {
  today: AdminPrinterOutputSides
  month: AdminPrinterOutputSides
  monthUnconfirmedTasks: number
}

export type AdminPrinterOutputResult =
  | { status: 'ok'; byTerminal: Map<string, AdminPrinterOutput> }
  | { status: 'capped' }

/** 上海自然月月初（该月 1 日 00:00 +08:00）。东八区无夏令时。 */
export function shanghaiMonthStart(now: Date): Date {
  const shifted = new Date(now.getTime() + TZ_OFFSET_MS)
  shifted.setUTCDate(1)
  shifted.setUTCHours(0, 0, 0, 0)
  return new Date(shifted.getTime() - TZ_OFFSET_MS)
}

function nextMonthStart(monthStart: Date): Date {
  const shifted = new Date(monthStart.getTime() + TZ_OFFSET_MS)
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 1) - TZ_OFFSET_MS)
}

function emptyOutput(): AdminPrinterOutput {
  return {
    today: { sides: 0, colorSides: 0, duplexSides: 0 },
    month: { sides: 0, colorSides: 0, duplexSides: 0 },
    monthUnconfirmedTasks: 0,
  }
}

function addSides(bucket: AdminPrinterOutputSides, sides: number, color: boolean, duplex: boolean): void {
  bucket.sides += sides
  if (color) bucket.colorSides += sides
  if (duplex) bucket.duplexSides += sides
}

/** 读不出 JSON、缺省、simplex、single 都按黑白单面。 */
export function taskPrintModes(paramsJson: string): { color: boolean; duplex: boolean } {
  let raw: unknown
  try {
    raw = JSON.parse(paramsJson)
  } catch {
    return { color: false, duplex: false }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { color: false, duplex: false }
  const record = raw as Record<string, unknown>
  return {
    color: record['colorMode'] === 'color',
    duplex: record['duplex'] === 'duplex_long_edge' || record['duplex'] === 'duplex_short_edge',
  }
}

@Injectable()
export class AdminPrinterOutputService {
  constructor(private readonly prisma: PrismaService) {}

  async summarize(
    terminalIds: string[],
    options?: { now?: Date; rowCap?: number },
  ): Promise<AdminPrinterOutputResult> {
    const ids = [...new Set(terminalIds.filter((id) => id.length > 0))]
    const byTerminal = new Map<string, AdminPrinterOutput>()
    for (const id of ids) byTerminal.set(id, emptyOutput())
    if (ids.length === 0) return { status: 'ok', byTerminal }

    const now = options?.now ?? new Date()
    const rowCap = options?.rowCap ?? ADMIN_PRINTER_OUTPUT_ROW_CAP
    const monthStart = shanghaiMonthStart(now)
    const monthEnd = nextMonthStart(monthStart)
    const dayStart = shanghaiDayStart(now)
    const dayEnd = new Date(dayStart.getTime() + DAY_MS)
    const completedAt = { gte: monthStart, lt: monthEnd }

    const printed = await this.prisma.printTask.findMany({
      where: {
        AND: [PRINTED_TASK_WHERE, { terminalId: { in: ids } }, { completedAt }],
      },
      select: {
        id: true,
        terminalId: true,
        paramsJson: true,
        completedAt: true,
        order: { select: { billablePages: true } },
      },
      take: rowCap + 1,
    })
    if (printed.length > rowCap) return { status: 'capped' }

    const unconfirmed = await this.prisma.printTask.findMany({
      where: {
        terminalId: { in: ids },
        status: 'failed',
        errorCode: 'PRINT_JOB_UNCONFIRMED',
        printOutcome: null,
        completedAt,
      },
      select: { terminalId: true, completedAt: true },
      take: rowCap + 1,
    })
    if (unconfirmed.length > rowCap) return { status: 'capped' }

    const pages = await pagesByPrintedTask(this.prisma, printed)
    for (const row of printed) {
      if (!row.terminalId) continue
      const bucket = byTerminal.get(row.terminalId)
      if (!bucket) continue
      const at = row.completedAt
      if (!(at instanceof Date) || at.getTime() < monthStart.getTime() || at.getTime() >= monthEnd.getTime()) continue
      const contributed = pages.get(row.id)
      if (contributed === undefined) continue
      const modes = taskPrintModes(row.paramsJson)
      addSides(bucket.month, contributed, modes.color, modes.duplex)
      if (at.getTime() >= dayStart.getTime() && at.getTime() < dayEnd.getTime()) {
        addSides(bucket.today, contributed, modes.color, modes.duplex)
      }
    }
    for (const row of unconfirmed) {
      if (!row.terminalId) continue
      const bucket = byTerminal.get(row.terminalId)
      if (!bucket) continue
      const at = row.completedAt
      if (!(at instanceof Date) || at.getTime() < monthStart.getTime() || at.getTime() >= monthEnd.getTime()) continue
      bucket.monthUnconfirmedTasks += 1
    }
    return { status: 'ok', byTerminal }
  }
}
