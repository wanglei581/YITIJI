// 管理员后台「终端 / 打印机」两页共用的打印机状态与磁盘口径。
//
// Agent 当前真实上报的 printerStatus（apps/terminal-agent/src/agent/types.ts）：
//   ready / offline / error / low_paper / unknown
// 另有队列闸门 queue_cleanup_failed / queue_pause_failed（Agent 已停领，不可出纸）。
// ok / idle 是历史心跳里的正常值；paper_empty / not_found 是早期约定、Agent 现在不发，
// 保留识别只为兼容存量心跳。正常值的判定统一走 printer-status.ts。

import { isHealthyPrinterStatus } from './printer-status'

export type AdminPrinterRunStatus = 'online' | 'offline' | 'error'
export type AdminPaperStatus = 'normal' | 'low' | 'empty' | 'jam' | 'unknown' | null

/**
 * 打印机页的三态。low_paper 是可打印的提醒（WMI 可恢复告警），不算故障；
 * 未上报或驱动返回 unknown 时无法确认可用，按离线显示。
 */
export function toAdminPrinterStatus(online: boolean, printerStatus: string | null): AdminPrinterRunStatus {
  if (!online) return 'offline'
  if (!printerStatus || printerStatus === 'unknown') return 'offline'
  if (isHealthyPrinterStatus(printerStatus) || printerStatus === 'low_paper') return 'online'
  // queue_cleanup_failed / queue_pause_failed 与其它故障一样归「不可出纸」（error），
  // 不是 low_paper 那种还能打的提醒。
  return 'error'
}

/** 故障 / 提醒说明；正常返回 null，页面据此不显示故障、不标红。 */
export function describePrinterFault(online: boolean, printerStatus: string | null): string | null {
  if (!online) return '终端离线，打印机状态未知'
  if (isHealthyPrinterStatus(printerStatus)) return null
  switch (printerStatus) {
    case 'low_paper': return '纸张或墨粉不足，可打印、需补充'
    case 'paper_empty': return '纸盒已空，请补充 A4 纸张'
    case 'offline': return '打印机离线'
    case 'not_found': return '未检测到配置的打印机'
    case 'error': return '打印机故障，需人工处理'
    case 'queue_cleanup_failed': return '开机清理打印队列失败，已暂停接单。请到现场清空打印队列后重启 Agent。'
    case 'queue_pause_failed': return '暂停打印队列失败，已暂停接单。请到现场检查打印队列后重启 Agent。'
    case 'unknown': return '打印机状态未知，驱动未返回可用状态'
    case null: return '打印机状态未上报'
    default: return '打印机报告了无法识别的状态，需人工核对'
  }
}

export function adminPaperStatus(printerStatus: string | null): AdminPaperStatus {
  if (printerStatus === 'paper_empty') return 'empty'
  if (printerStatus === 'low_paper') return 'low'
  return null
}

/** Agent 在取不到磁盘时上报 -1（macOS 开发机恒为 -1）；负数与非有限值一律视为未知。 */
export function normalizeDiskFreeGb(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return null
  return value
}
