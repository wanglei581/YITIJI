// Runtime labels; the shared declaration contract is also consumed by the CommonJS API.
import type { FirstOrderIssue } from './firstOrder.contract'
export type * from './firstOrder.contract'

export const FIRST_ORDER_ISSUES = ['offline', 'paper', 'jam', 'quality', 'scan', 'other'] as const
export const FIRST_ORDER_ISSUE_LABELS: Record<FirstOrderIssue, string> = {
  offline: '设备离线', paper: '缺纸', jam: '卡纸', quality: '打印质量', scan: '扫描故障', other: '其他设备问题',
}
