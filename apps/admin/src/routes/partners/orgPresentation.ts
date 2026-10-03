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
export function contactPhoneText(phone: string | null | undefined): string {
  if (!phone?.trim()) return '—'
  // 已有掩码不可还原或减少星号。
  if (phone.includes('*')) return phone
  const digits = phone.replace(/\D/g, '')
  if (/^1[3-9]\d{9}$/.test(digits)) return `${digits.slice(0, 3)}${'*'.repeat(4)}${digits.slice(-4)}`
  if (digits.length >= 7) return `${digits.slice(0, 3)}${'*'.repeat(digits.length - 5)}${digits.slice(-2)}`
  return '已登记'
}
