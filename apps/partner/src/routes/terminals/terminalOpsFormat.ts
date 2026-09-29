// 终端数据页的文案与格式化。所有数字都来自服务端，这里只决定怎么说。

import { buildCsv } from '../../lib/csv'
import type {
  PartnerTerminalOpsView,
  TerminalOpsOutput,
  TerminalOpsRow,
  TerminalOpsUnavailable,
} from '../../services/api/terminalOps'

const UNAVAILABLE_COPY: Record<string, string> = {
  ai_calls_not_attributed_to_terminal: 'AI 调用记录还没有标明是哪台终端发起的，暂不能按本机构终端统计；本页不拿全平台的数字代替。',
}

export function unavailableReason(item: TerminalOpsUnavailable): string {
  return UNAVAILABLE_COPY[item.reason] ?? '暂不能统计。'
}

/** 服务端对 1–4 的计数给 null（防止对上具体某一单），页面照实说「少于 5」。 */
export function countText(value: number | null): string {
  return value === null ? '少于 5' : value.toLocaleString('zh-CN')
}

export function rateText(output: TerminalOpsOutput): string {
  if (output.successRate !== null) return `${output.successRate.toFixed(1)}%`
  if (output.settled === 0) return '暂无出纸记录'
  return '样本不足 5 单'
}

export function minutesText(minutes: number | null): string {
  if (minutes === null) return '—'
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours < 48) return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
  return `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`
}

const SH_DATE_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const SH_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function shanghaiDateTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : SH_DATE_TIME.format(date)
}

export function shanghaiDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : SH_DATE.format(date)
}

export function windowText(data: PartnerTerminalOpsView): string {
  return `${shanghaiDateTime(data.window.from)} 至 ${shanghaiDateTime(data.window.to)}`
}

export function relativeTime(iso: string | null, nowMs: number = Date.now()): string {
  if (!iso) return '从未上报'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diffMin = Math.floor((nowMs - t) / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const hours = Math.floor(diffMin / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

export function terminalName(row: TerminalOpsRow): string {
  return row.displayName?.trim() || row.terminalCode
}

export type TerminalRunState = 'online' | 'offline' | 'silent'

export function runState(row: TerminalOpsRow): TerminalRunState {
  if (row.online) return 'online'
  return row.lastHeartbeatAt ? 'offline' : 'silent'
}

export const RUN_STATE_VIEW: Record<TerminalRunState, { label: string; status: 'success' | 'error' | 'default' }> = {
  online: { label: '在线', status: 'success' },
  offline: { label: '离线', status: 'error' },
  silent: { label: '从未上报', status: 'default' },
}

/** 每张指标卡下面那一行口径说明，页面与导出共用。 */
export const METRIC_NOTES = {
  visit: '服务人次 = 统计期内本机构终端的使用次数：从待机唤醒或上一位清场之后，第一次进入某项服务算一次，误触不算；按终端当时所属的机构统计。会话记录随 2026 年 9 月底的版本上线，此前的时段没有数。',
  service: '打印扫描服务次数 = 统计期内在本机构终端新建的打印任务与扫描任务数，按任务计，不等于人次。',
  output: '出纸成功率 = 出纸成功 ÷ 统计期内结束的打印任务；成功含工作人员现场核查「已出纸」的单，取消、作废与进行中的不计。',
  ai: 'AI 可用率需要按终端归属 AI 调用，目前记录里没有终端标识。',
  faults: '相邻两次心跳间隔超过 5 分钟记一次离线；打印机从报异常到重新报正常记一次故障；「未知」状态不算开始也不算恢复。',
  sample: '为避免对上具体某一单，1–4 次的计数不显示具体数字；已结束任务不足 5 单时不给出纸成功率。',
} as const

export function buildTerminalOpsCsv(data: PartnerTerminalOpsView): string {
  const header = [
    '终端编号', '终端名称', '摆放位置', '当前状态', '最后心跳（北京时间）',
    '服务人次', '打印扫描服务次数（按任务计）', '出纸成功', '已结束打印任务', '出纸成功率', '未确认出纸',
    '离线次数', '离线时长（分钟）', '打印机故障次数', '打印机故障时长（分钟）',
    '已恢复次数', '平均恢复（分钟）', '最长一次（分钟）', '当前未恢复', '统计期内有上报',
  ]
  const csvCount = (value: number | null) => (value === null ? '少于5（不显示具体数字）' : value)
  const csvRate = (output: TerminalOpsOutput) => (output.successRate === null ? rateText(output) : `${output.successRate.toFixed(1)}%`)
  const rows = data.terminals.map((row) => [
    row.terminalCode,
    terminalName(row),
    row.locationLabel ?? '',
    RUN_STATE_VIEW[runState(row)].label,
    shanghaiDateTime(row.lastHeartbeatAt),
    csvCount(row.visitCount),
    csvCount(row.serviceCount),
    csvCount(row.output.printed),
    csvCount(row.output.settled),
    csvRate(row.output),
    csvCount(row.output.unconfirmed),
    row.faults.offlineCount,
    row.faults.offlineMinutes,
    row.faults.printerFaultCount,
    row.faults.printerFaultMinutes,
    row.faults.recoveredCount,
    row.faults.avgRecoveryMinutes ?? '',
    row.faults.longestMinutes ?? '',
    row.faults.unrecovered ? '是' : '否',
    row.faults.reportedInWindow ? '是' : '否',
  ])
  const totals = data.totals
  const totalRow = [
    '合计', `${totals.terminalCount} 台`, '', `在线 ${totals.onlineTerminals} 台`, '',
    csvCount(totals.visitCount), csvCount(totals.serviceCount), csvCount(totals.output.printed), csvCount(totals.output.settled),
    csvRate(totals.output), csvCount(totals.output.unconfirmed),
    totals.faults.offlineCount, totals.faults.offlineMinutes, totals.faults.printerFaultCount, totals.faults.printerFaultMinutes,
    totals.faults.recoveredCount, totals.faults.avgRecoveryMinutes ?? '', totals.faults.longestMinutes ?? '',
    `${totals.unrecoveredTerminals} 台`, `${totals.terminalCount - totals.silentTerminals} 台`,
  ]
  return buildCsv([
    ['统计窗口', `${windowText(data)}（${data.timezone}）`],
    ['数据来源', data.dataMode === 'demo' ? '演示数据（mock 模式，不是任何终端的真实情况）' : '本机构终端的真实记录'],
    ['服务人次口径', METRIC_NOTES.visit],
    ['AI 可用率', `暂不能按本机构终端统计：${unavailableReason(data.aiAvailability)}`],
    ['口径', METRIC_NOTES.sample],
    [],
    header,
    ...rows,
    totalRow,
  ])
}

export function terminalOpsCsvName(orgName: string, data: PartnerTerminalOpsView): string {
  return `${orgName}-终端数据-${shanghaiDate(data.window.from)}至${shanghaiDate(data.window.to)}.csv`
}
