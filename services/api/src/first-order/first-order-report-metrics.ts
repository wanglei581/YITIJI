import { BadRequestException } from '@nestjs/common'
import type { FirstOrderMetric } from '../../../../packages/shared/src/types/firstOrder.contract'

export function monthWindow(month: string, now = new Date()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < '2026-01') {
    throw new BadRequestException({ error: { code: 'FIRST_ORDER_MONTH_INVALID', message: '请选择2026年及以后的有效月份' } })
  }
  const [year, m] = month.split('-').map(Number)
  const from = new Date(Date.UTC(year, m - 1, 1) - 8 * 3600_000)
  const to = new Date(Date.UTC(year, m, 1) - 8 * 3600_000)
  if (from > now) throw new BadRequestException({ error: { code: 'FIRST_ORDER_MONTH_FUTURE', message: '不能查询尚未开始的月份' } })
  return { from, to, closed: to <= now }
}

/** Previous complete calendar month in Asia/Shanghai. The directory uses this when month is omitted. */
export function previousClosedMonth(now = new Date()) {
  const shifted = new Date(now.getTime() + 8 * 3600_000)
  const from = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() - 1, 1) - 8 * 3600_000)
  const to = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), 1) - 8 * 3600_000)
  const month = new Date(from.getTime() + 8 * 3600_000).toISOString().slice(0, 7)
  return { from, to, month }
}

/**
 * Directory month window. Unlike monthWindow, a current or future month is not an error:
 * the caller marks every row as preview-only instead of a missing report.
 */
export function reportDirectoryWindow(month: string, now = new Date()) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new BadRequestException({ error: { code: 'FIRST_ORDER_MONTH_INVALID', message: '请选择有效月份' } })
  }
  const [year, m] = month.split('-').map(Number)
  const from = new Date(Date.UTC(year, m - 1, 1) - 8 * 3600_000)
  const to = new Date(Date.UTC(year, m, 1) - 8 * 3600_000)
  return { from, to, closed: to <= now }
}

export function reportMetric(value: number | null, note: string, unavailable = 'not_recorded' as const): FirstOrderMetric {
  if (value === null) return { value: null, state: unavailable, note }
  if (value > 0 && value < 5) return { value: null, state: 'sample_suppressed', note: '样本不足5，不显示数值' }
  return { value, state: 'measured', note }
}

export function suppressPrintFamily(values: number[], notes: string[]): FirstOrderMetric[] {
  if (values.some((n) => n > 0 && n < 5)) {
    return values.map(() => ({ value: null, state: 'sample_suppressed', note: '打印关联指标按组隐藏，避免通过差值反推小样本' }))
  }
  return values.map((n, i) => reportMetric(n, notes[i]))
}

/** Prevent spreadsheet formula injection, including prefixed whitespace/control chars. */
export function csvCell(value: unknown): string {
  let s = String(value ?? '')
  const first = Array.from(s).find((c) => c.charCodeAt(0) > 31 && !/\s/u.test(c))
  if (first && '=+-@'.includes(first)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

export function reportCsv(snapshot: import('../../../../packages/shared/src/types/firstOrder.contract').FirstOrderReportSnapshot, evidence?: { id: string; checksum: string }): string {
  const names: Record<keyof typeof snapshot.metrics, string> = {
    sessions: '服务会话数', printedTasks: '已出纸任务数（软件结果/人工核查）', printedFaces: '系统记录印面数',
    unconfirmedPrints: '未确认出纸任务', failedPrints: '其他失败任务', completedScans: '扫描完成数', offlineMinutes: '推导离线分钟',
  }
  const rows: unknown[][] = [
    ['报告编号', evidence?.id ?? '临时预览'], ['报告版本', snapshot.schemaVersion], ['快照校验摘要（SHA-256）', evidence?.checksum ?? '未留存'],
    ['生成时间', snapshot.generatedAt], ['项目', snapshot.project.name], ['项目编号', snapshot.project.reference], ['月份', snapshot.month],
    ['服务开始', snapshot.project.serviceStartAt], ['服务结束', snapshot.project.serviceEndAt],
    ['免费服务与维保范围', snapshot.project.serviceScope], ['服务联系渠道', snapshot.project.supportContact],
    ['设备编号', '安装位置', '登记开始', '登记结束'],
    ...snapshot.deployments.map((d) => [d.terminalCode, d.locationLabel, d.startedAt, d.endedAt ?? '仍在登记期内']),
    ['本月新建工单（生成时状态）', '待处理', '处理中', '待机构确认', '已确认'],
    ['工单数', snapshot.incidents.open, snapshot.incidents.processing, snapshot.incidents.resolved, snapshot.incidents.closed],
    ['时区', snapshot.timezone], ['区间开始（含）', snapshot.window.from], ['区间结束（不含）', snapshot.window.to],
    ['报告状态', snapshot.complete ? '约定范围可统计' : '部分可统计，请查限制说明'],
    ['指标', '数值', '状态', '口径'],
    ...Object.entries(snapshot.metrics).map(([key, m]) => [names[key as keyof typeof names], m.value,
      { measured: '已统计', sample_suppressed: '样本不足，不显示', not_recorded: '暂无可用记录', unverified: '暂不能核验' }[m.state], m.note]),
    ...snapshot.limitations.map((note) => ['限制说明', note]),
  ]
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}
