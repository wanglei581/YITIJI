import { API_BASE_URL } from '../../../services/api/client'

// fairs 路由内多个子组件与主页共享的展示常量与工具函数。
// 由 routes/fairs/index.tsx 抽出,行为与取值零变化。

// ─── 展示常量 ─────────────────────────────────────────────────────────────────

export const THEME_LABELS: Record<string, string> = {
  general: '综合招聘会',
  campus: '校园招聘会',
  campus_corp: '校企合作专场',
  industry: '行业专场',
}

export const MATERIAL_TYPE_LABELS: Record<string, string> = {
  schedule: '活动日程',
  venue_map: '展馆地图',
  company_list: '企业名册',
  position_list: '岗位汇总',
  brochure: '宣传手册',
  other: '其他资料',
}

export const ZONE_CATEGORY_LABELS: Record<string, string> = {
  innovation: '创新展区',
  service: '现场服务',
  campus_corp_topic: '校企合作主题',
}

export const REVIEW_BADGE: Record<string, { status: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  pending:   { status: 'warning', label: '待审核' },
  reviewing: { status: 'info',    label: '审核中' },
  approved:  { status: 'success', label: '已通过' },
  rejected:  { status: 'error',   label: '已拒绝' },
}

export const PUBLISH_BADGE: Record<string, { status: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  draft:       { status: 'default', label: '草稿' },
  published:   { status: 'success', label: '已发布' },
  unpublished: { status: 'warning', label: '已下架' },
  expired:     { status: 'default', label: '已过期' },
}

export type FairTimeStatus = 'upcoming' | 'ongoing' | 'ended'
export const TIME_STATUS_STYLES: Record<FairTimeStatus, string> = {
  upcoming: 'bg-info-bg text-info-fg',
  ongoing:  'bg-success-bg text-success-fg',
  ended:    'bg-neutral-100 text-neutral-400',
}
export const TIME_STATUS_LABELS: Record<FairTimeStatus, string> = { upcoming: '未开始', ongoing: '进行中', ended: '已结束' }

export function deriveTimeStatus(startAt: string, endAt: string): FairTimeStatus {
  const nowMs = Date.now()
  if (nowMs < new Date(startAt).getTime()) return 'upcoming'
  if (nowMs > new Date(endAt).getTime()) return 'ended'
  return 'ongoing'
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatSize(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`
}

/** 后端返回的 previewUrl 是 /api/v1/... 相对签名地址,Admin dev server 需拼到 API 源。 */
export function resolvePreviewUrl(previewUrl: string): string {
  if (/^(https?:|data:|blob:)/.test(previewUrl)) return previewUrl
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '')
  return previewUrl.startsWith('/') ? `${origin}${previewUrl}` : previewUrl
}

/** ISO ↔ <input type="datetime-local">(本地时区)。 */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
export function localInputToIso(value: string): string {
  return new Date(value).toISOString()
}

export const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

export function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') {
    return (e as Error).message
  }
  return '操作失败,请重试'
}
