import type { AdminPrinterRecord } from '../../services/api/devices'

export type PrinterStatusGroup = 'needsService' | 'offline' | 'lowSupply' | 'normal'

// 终端只上报打印机总体状态（正常 / 离线 / 故障 / 纸张或墨粉偏低 / 未知），后端据此给出纸张「偏低」「空」两种报警，
// 从不给「纸张正常」，也没有墨粉余量。所以纸张、墨粉为空只表示驱动没报警，不能当成「没上报」；
// 状态未知或没上报的，后端已归为离线。

export function classifyPrinter(printer: AdminPrinterRecord): PrinterStatusGroup {
  if (printer.status === 'error' || printer.paperStatus === 'jam' || printer.paperStatus === 'empty') return 'needsService'
  if (printer.status === 'offline') return 'offline'
  if (printer.paperStatus === 'low' || (printer.tonerLevel !== null && printer.tonerLevel < 20)) return 'lowSupply'
  return 'normal'
}

export function summarizePrinters(printers: AdminPrinterRecord[]) {
  const counts = { needsService: 0, offline: 0, lowSupply: 0, normal: 0 }
  for (const printer of printers) counts[classifyPrinter(printer)] += 1
  return counts
}

export function printerIssueParts(counts: ReturnType<typeof summarizePrinters>): string[] {
  const parts: string[] = []
  if (counts.needsService) parts.push(`要现场处理 ${counts.needsService} 台（故障或缺纸）`)
  if (counts.offline) parts.push(`离线或未上报 ${counts.offline} 台`)
  if (counts.lowSupply) parts.push(`纸张或墨粉偏少 ${counts.lowSupply} 台（仍可打印）`)
  return parts
}
