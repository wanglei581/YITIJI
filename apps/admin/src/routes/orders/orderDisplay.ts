import { formatDateTime, formatYuan } from '@ai-job-print/shared'
import { pageRangeText as recordedPageRangeText } from './orderHonestyCopy'
import type { AdminOrderMarkPaidSource } from '../../services/api/adminOrdersReadonly'

// ─── Display maps ─────────────────────────────────────────────────────────────

export const STATUS_MAP: Record<string, { badge: 'success' | 'error' | 'warning' | 'info' | 'default'; label: string }> = {
  pending:   { badge: 'warning', label: '待领取' },
  claimed:   { badge: 'info',    label: '已领取' },
  printing:  { badge: 'info',    label: '打印中' },
  completed: { badge: 'success', label: '已完成' },
  failed:    { badge: 'error',   label: '失败' },
  cancelled: { badge: 'default', label: '已取消' },
  abandoned: { badge: 'default', label: '已废弃' },
  // 小程序订单详情同一套叫法：待到机 / 待现场支付。过期与取件状态用词一致。
  pending_release: { badge: 'warning', label: '待到机' },
  awaiting_payment: { badge: 'warning', label: '待现场支付' },
  expired: { badge: 'default', label: '已过期' },
}

export interface StatusView {
  badge: 'success' | 'error' | 'warning' | 'info' | 'default'
  label: string
  title?: string
}

function mappedStatus(
  status: string | null | undefined,
  table: Record<string, { badge: StatusView['badge']; label: string }>,
): StatusView {
  if (!status) return { badge: 'default', label: '—' }
  const known = table[status]
  if (known) return known
  return { badge: 'default', label: `未归类（${status}）`, title: status }
}

/** 列表、详情、状态流转共用。未知值保留原值，悬停可见。 */
export function taskStatusText(status: string | null | undefined): StatusView {
  return mappedStatus(status, STATUS_MAP)
}

export function payStatusText(status: string | null | undefined): StatusView {
  return mappedStatus(status, PAY_STATUS_MAP)
}

export const PAY_STATUS_MAP: Record<string, { badge: 'success' | 'error' | 'warning' | 'default'; label: string }> = {
  unpaid:           { badge: 'warning', label: '未支付' },
  paying:           { badge: 'warning', label: '支付中' },
  paid:             { badge: 'success', label: '已支付' },
  refunding:        { badge: 'warning', label: '退款中' },
  refunded:         { badge: 'default', label: '已退款' },
  // 产品只做整单退款，服务端不再写入 partial_refunded；万一出现即为异常，需人工核对。
  partial_refunded: { badge: 'warning', label: '退款异常·待核对' },
  failed:           { badge: 'error',   label: '支付失败' },
  closed:           { badge: 'default', label: '已关闭' },
}

export const STATUS_FILTERS = [
  { label: '全部', value: '' },
  { label: '待领取', value: 'pending' },
  { label: '已领取', value: 'claimed' },
  { label: '打印中', value: 'printing' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' },
  { label: '已取消', value: 'cancelled' },
  { label: '已废弃', value: 'abandoned' },
] as const

export const PAY_FILTERS = [
  { label: '全部支付状态', value: '' },
  { label: '未支付', value: 'unpaid' },
  { label: '支付中', value: 'paying' },
  { label: '已支付', value: 'paid' },
  { label: '退款中', value: 'refunding' },
  { label: '已退款', value: 'refunded' },
  { label: '支付失败', value: 'failed' },
  { label: '已关闭', value: 'closed' },
] as const

export const OWNER_LABELS: Record<string, string> = { member: '会员', anonymous: '游客' }

// 待退款信号的内部 refundReason 码 → 中文。两个码的唯一来源是
// services/api/src/payment/pending-refund-signal.ts；管理员发起退款时写入的是
// 人工填写的中文原因，因此未命中的值原样展示（不编造含义，也不吞掉真实文案）。
export const REFUND_REASON_LABELS: Record<string, string> = {
  PAID_UNFULFILLED_PENDING_REFUND: '已付款未出纸',
  ONLINE_PAID_PENDING_REFUND: '渠道已收款，但取件窗口已关、订单未转已支付',
}

// 收款入账来源：后端 AdminMarkPaidDto 只放行这两个（free 由 0 元建单自动产生，
// 线上通道各走各的回调路径），文案与「我的」订单侧的来源展示保持一致。
export const MARK_PAID_SOURCES: ReadonlyArray<{ value: AdminOrderMarkPaidSource; label: string; hint: string }> = [
  { value: 'offline', label: '线下收款', hint: '现场向用户实际收到现金' },
  { value: 'manual_confirmed', label: '人工确认', hint: '非现场现金，已另行核实到账后由管理员确认' },
]

export function markPaidSourceLabel(source: string | null): string {
  return MARK_PAID_SOURCES.find((s) => s.value === source)?.label ?? source ?? '未标注'
}

// 后端错误码 → 可读解释；原始码始终一并展示，便于现场上报排查。
export const MARK_PAID_ERROR_TEXT: Record<string, string> = {
  ORDER_ALREADY_PAID: '该订单已由其它来源入账，本次未重复记账',
  ORDER_INVALID_TRANSITION: '该订单当前支付状态不允许入账（已退款 / 已关闭 / 支付失败等）',
  ORDER_NOT_FOUND: '订单不存在',
  // 后端两道防线：ValidationPipe 先拒非法取值（VALIDATION_FAILED），
  // controller / service 再各有一层白名单（*_NOT_ADMIN_ALLOWED / *_INVALID）。
  VALIDATION_FAILED: '请求被后端校验拒绝（收款来源仅支持线下收款 / 人工确认）',
  PAYMENT_SOURCE_NOT_ADMIN_ALLOWED: '收款来源不被后端允许',
  PAYMENT_SOURCE_INVALID: '收款来源不被后端允许',
  PICKUP_CODE_UNAVAILABLE: '取件码生成失败，订单未入账，可稍后重试',
}

// M1：渠道展示。null = 存量单**无法可靠判定**（一体机与小程序建单写的字段相同），
// 必须显示「未标注」——不得按 terminalId 猜成一体机，那会污染统计。
export function channelText(channel: string | null): string {
  if (channel === 'kiosk') return '一体机现场'
  if (channel === 'miniapp_cloud') return '小程序云打印'
  return '未标注'
}

// M2：取件状态展示。一体机现场即时出纸，**业务上不存在取件环节**，显示「—」而非「无数据」。
export const PICKUP_LABELS: Record<string, string> = {
  pending: '待取件', claimed: '已亮码', used: '已取件',
  expired: '已过期', cancelled: '已取消',
}
export function pickupText(order: { pickupStatus: string; channel: string | null }): string {
  if (order.pickupStatus === 'none') return '—'
  return PICKUP_LABELS[order.pickupStatus] ?? `未归类（${order.pickupStatus}）`
}

export function pickupTitle(order: { pickupStatus: string }): string | undefined {
  if (order.pickupStatus === 'none' || PICKUP_LABELS[order.pickupStatus]) return undefined
  return order.pickupStatus
}

export function fmt(iso: string | null): string {
  return formatDateTime(iso)
}

export function amountText(amountCents: number, currency: string): string {
  // 0 元 ≠ 未计费。系统里存在合法的 0 元单：会员权益抵扣、0 元活动、
  // paymentSource === 'free' 的免费单 —— 它们是「已定价为 0」，不是「还没定价」。
  // 此前 `<= 0` 一律兜成「未计费」，把两件事说成一件，运营无法判断这单是免费
  // 还是计费流程出了问题。负值才是真异常，单独如实标出而不是伪装成未计费。
  if (amountCents === 0) return `${formatYuan(0)}（免费）`
  if (amountCents < 0) return `金额异常（${amountCents}）`
  return currency === 'CNY' ? formatYuan(amountCents / 100) : `${currency} ${(amountCents / 100).toFixed(2)}`
}


export function orderUserText(order: { ownerType: string; userLabel: string }): string {
  const identity = OWNER_LABELS[order.ownerType] ?? '身份未记录'
  const label = order.userLabel.trim().replace(/1[3-9]\d{9}/g, (phone) => `尾号${phone.slice(-4)}`)
  return !label || label === identity ? identity : `${identity} · ${label}`
}

/** Order.billablePages 原值：内容页数，不含份数；缺值不伪装成 0 页。 */
export function billablePagesText(pages: number | null | undefined): string | null {
  return typeof pages === 'number' ? `${pages} 页` : null
}

export function orderPagesText(pages: number | null | undefined, copies: number | null | undefined): string | null {
  const text = billablePagesText(pages)
  if (text === null) return null
  return typeof copies === 'number' && copies > 1 ? `${text} × ${copies} 份` : text
}

/**
 * 页范围。订单上没记页范围、但有计费页数时，写「未单独记录（见计费页数）」，页数交给「计费页数」一行说：
 * 单文件一体机单没记范围 = 全部页面，但小程序多文件（打包）单也没有订单级页范围、billablePages 是各文件所选页数之和；
 * 前端分不出这两种（printTaskId 在小程序单放行前也为空），所以不说「全部页面」，也不说「各文件合计」。
 */
export function pageRangeText(value: string | null | undefined, pages: number | null | undefined): string {
  if (typeof value === 'string' && value.trim()) return recordedPageRangeText(value)
  return billablePagesText(pages) === null ? '未记录' : '未单独记录（见计费页数）'
}
