import type { FeedbackCategory, FeedbackStatus } from '../../../../services/api/memberFeedback'
import type { KioskIconName } from '../../../../components/kiosk-icon'

export const CATEGORY_OPTIONS: { value: FeedbackCategory; label: string; hint: string }[] = [
  { value: 'device', label: '设备使用', hint: '屏幕、扫码、外设等设备问题' },
  { value: 'print', label: '打印服务', hint: '打印、取件、纸张等问题' },
  { value: 'file_process', label: '文件处理', hint: '上传、预览、扫描文件处理' },
  { value: 'general', label: '一般建议', hint: '页面体验或服务建议' },
]

export const CATEGORY_META: Record<FeedbackCategory, { label: string; tone: string; icon: KioskIconName }> = {
  device: { label: '设备使用', tone: 'slate', icon: 'feedback' },
  print: { label: '打印服务', tone: 'wheat', icon: 'printer' },
  file_process: { label: '文件处理', tone: 'teal', icon: 'files' },
  general: { label: '一般建议', tone: 'rose', icon: 'chat' },
}

export const STATUS_META: Record<FeedbackStatus, { label: string; cls: string }> = {
  pending: { label: '已提交', cls: 'is-warning' },
  processing: { label: '处理中', cls: 'is-muted' },
  replied: { label: '已回复', cls: 'is-active' },
  closed: { label: '已关闭', cls: 'is-muted' },
}

export const feedbackInputClass =
  'w-full rounded-2xl border border-[rgba(16,48,43,0.14)] bg-[rgba(255,253,248,0.82)] px-4 py-3 text-sm text-[color:var(--ink)] outline-none transition-colors placeholder:text-[color:var(--muted)] focus:border-[rgba(36,101,86,0.48)] focus:ring-2 focus:ring-[rgba(36,101,86,0.12)] disabled:cursor-not-allowed disabled:bg-[rgba(16,48,43,0.04)] disabled:text-[color:var(--muted)]'

export interface FeedbackFormState {
  category: FeedbackCategory
  title: string
  content: string
  contactPhone: string
}

export const emptyFeedbackForm: FeedbackFormState = {
  category: 'print',
  title: '',
  content: '',
  contactPhone: '',
}

export function parseFeedbackCategory(value: string | null): FeedbackCategory | null {
  if (!value) return null
  return CATEGORY_OPTIONS.some((option) => option.value === value) ? (value as FeedbackCategory) : null
}
