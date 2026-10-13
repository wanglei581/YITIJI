/**
 * 诊断报告只认职业规划这一处来源。
 * 别的 from 一律当没有，不接受任意路径，也不从地址栏回读。
 */
export const REPORT_FROM_WHITELIST = {
  'career-plan': { path: '/resume/career-plan', label: '继续做职业规划' },
} as const

export type ReportFromKey = keyof typeof REPORT_FROM_WHITELIST

export function readReportFrom(value: string | null | undefined): ReportFromKey | null {
  if (value == null || value === '') return null
  return Object.prototype.hasOwnProperty.call(REPORT_FROM_WHITELIST, value)
    ? (value as ReportFromKey)
    : null
}
