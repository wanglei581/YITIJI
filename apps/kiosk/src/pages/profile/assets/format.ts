// ============================================================
// 账号资产展示格式化（Phase C-2D，从 ProfilePage 拆出）
// 纯展示工具：状态文案 / 时间 / 大小 / 收藏与权益元数据。不发请求、不持状态。
// ============================================================

import type {
  BenefitStatus,
  BenefitType,
  FavoriteTargetType,
  MemberAiRecordKind,
  MemberBenefitItem,
  MemberPrintOrderItem,
} from '@ai-job-print/shared'
import {
  BoxIcon,
  BriefcaseIcon,
  CalendarIcon,
  GiftIcon,
  LandmarkIcon,
  TicketIcon,
  type LucideIcon,
} from 'lucide-react'

export function formatTime(iso: string) {
  const d = new Date(iso)
  const M = d.getMonth() + 1
  const D = d.getDate()
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${M}月${D}日 ${h}:${m}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const AI_STATUS_LABEL: Record<string, string> = {
  pending: '处理中',
  processing: '处理中',
  completed: '已完成',
  failed: '未完成',
}

export function aiStatusLabel(s: string): string {
  return AI_STATUS_LABEL[s] ?? s
}

/** AI 服务记录种类文案：生成必须如实展示为「简历生成」，绝不冒充「简历解析」。 */
export const AI_KIND_LABEL: Record<MemberAiRecordKind, string> = {
  parse: '简历解析',
  optimize: '简历优化',
  generate: '简历生成',
}

// 打印订单状态文案（对齐后端 PrintTaskStatus：pending/claimed/printing/completed/failed/cancelled）。
const PRINT_ORDER_STATUS_LABEL: Record<string, string> = {
  pending: '排队中',
  claimed: '已认领',
  printing: '打印中',
  completed: '已完成',
  failed: '未完成',
  cancelled: '已取消',
}

export function printOrderStatusLabel(s: string): string {
  return PRINT_ORDER_STATUS_LABEL[s] ?? s
}

// 打印订单副文本：份数 + 黑白/彩色 + 幅面（仅展示后端确有的安全字段，缺省则跳过，不编造页数/金额）。
export function printOrderMetaText(o: MemberPrintOrderItem): string {
  const parts: string[] = [printOrderStatusLabel(o.status)]
  if (o.copies != null) parts.push(`${o.copies} 份`)
  if (o.colorMode) parts.push(o.colorMode === 'color' ? '彩色' : '黑白')
  if (o.paperSize) parts.push(o.paperSize)
  parts.push(formatTime(o.createdAt))
  return parts.join(' · ')
}

// 收藏对象按类型给图标 + 可选详情路由（job/job_fair 可跳既有详情页；policy 跳政策服务页）。
export const FAVORITE_META: Record<
  FavoriteTargetType,
  { icon: LucideIcon; iconBg: string; iconColor: string; label: string; route?: (id: string) => string }
> = {
  job: { icon: BriefcaseIcon, iconBg: 'bg-sky-50', iconColor: 'text-sky-600', label: '岗位', route: (id) => `/jobs/${id}` },
  job_fair: { icon: CalendarIcon, iconBg: 'bg-green-50', iconColor: 'text-green-600', label: '招聘会', route: (id) => `/job-fairs/${id}` },
  policy: { icon: LandmarkIcon, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', label: '政策', route: () => '/renshi?tab=policy' },
}

export const BENEFIT_META: Record<BenefitType, { icon: LucideIcon; iconBg: string; iconColor: string; label: string }> = {
  coupon: { icon: TicketIcon, iconBg: 'bg-rose-50', iconColor: 'text-rose-600', label: '优惠券' },
  free_quota: { icon: GiftIcon, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', label: '免费次数' },
  package_entitlement: { icon: BoxIcon, iconBg: 'bg-amber-50', iconColor: 'text-amber-600', label: '套餐额度' },
  subsidy_eligibility_hint: { icon: LandmarkIcon, iconBg: 'bg-blue-50', iconColor: 'text-blue-600', label: '补贴资格提示' },
}

const BENEFIT_STATUS_LABEL: Record<BenefitStatus, string> = {
  active: '可用',
  used_up: '已用完',
  expired: '已过期',
  revoked: '已失效',
}

// 权益副文本：状态 + 额度（仅额度类）+ 有效期；不出现任何「到账 / 已发放金额」承诺。
export function benefitMetaText(b: MemberBenefitItem): string {
  const parts: string[] = [BENEFIT_STATUS_LABEL[b.status] ?? b.status]
  if (b.quantityRemaining != null) {
    parts.push(b.quantityTotal != null ? `剩 ${b.quantityRemaining}/${b.quantityTotal} 次` : `剩 ${b.quantityRemaining} 次`)
  }
  if (b.validUntil) parts.push(`有效期至 ${formatTime(b.validUntil)}`)
  return parts.join(' · ')
}
