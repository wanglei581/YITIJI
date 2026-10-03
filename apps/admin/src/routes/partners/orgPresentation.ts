import { MODULE_LABELS } from '@ai-job-print/shared'

export const STATUS_FILTERS = ['全部', '合作中', '已停用'] as const
// 托管闸门停放的招聘类模块；仅影响标签，不影响保存值与复选框行为。
export function isParkedModule(key: string): boolean {
  return ['job_info', 'job_fair', 'external_apply_redirect'].includes(key)
}
export function moduleLabel(key: string, showRecruitment: boolean): string {
  const label = MODULE_LABELS[key as keyof typeof MODULE_LABELS] ?? key
  return !showRecruitment && isParkedModule(key) ? `${label}（暂不开放）` : label
}
export function contactPhoneText(phone: string | null): string {
  return phone?.replace(/^(1\d{2})\d{4}(\d{4})$/, '$1' + '*'.repeat(4) + '$2') ?? '—'
}

