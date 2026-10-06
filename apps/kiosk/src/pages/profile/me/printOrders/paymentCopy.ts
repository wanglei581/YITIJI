// ============================================================
// 「我的打印订单」支付展示文案映射（C5 P0b）——诚实口径 SSOT。
//
// 合规硬约束（CLAUDE.md §12 / payment-domain-c5-plan §⓪）：
// - P0b 只显式展示线下/免费/人工确认口径：paymentSource 白名单只 offline / free /
//   manual_confirmed，本文件绝不出现任何线上支付渠道文案。
// - 类型层已被 C5-2 扩展（PaymentSource +sandbox；OrderPayStatus +paying/closed）。
//   P0b 不替 C5-2 做线上态展示决策：映射用 Partial，未识别状态经 helper 容错回退到
//   中性诚实文案（payStatus → 「处理中」；sandbox 来源 → 不显来源提示），不伪装已支付/失败、
//   不把测试用 sandbox 渠道对用户展示。线上态完整收银展示留 C5-3。
// - unpaid → 「待现场确认」；关联 Order 缺失（payStatus 为 null）→ 「暂无支付信息」，
//   由页面分支处理，不在此编造默认值。
// - 金额一律整数「分」运算，不用浮点除法拼小数。
// ============================================================

import type { MemberPrintOrderItem } from '@ai-job-print/shared'

/** 支付来源 → 诚实中文文案（P0b 白名单；线上/沙箱渠道不在此，未命中不显来源提示）。 */
export const PAYMENT_SOURCE_LABEL: Partial<Record<NonNullable<MemberPrintOrderItem['paymentSource']>, string>> = {
  offline: '线下收款',
  free: '免费',
  manual_confirmed: '人工确认',
}

/** 支付状态 → 文案与徽章样式（token 类，禁用默认灰蓝色阶；未列出的态走 FALLBACK）。 */
export const PAY_STATUS_META: Partial<
  Record<NonNullable<MemberPrintOrderItem['payStatus']>, { label: string; cls: string }>
> = {
  unpaid: { label: '待现场确认', cls: 'bg-warning-bg text-warning-fg' },
  paid: { label: '已支付', cls: 'bg-success-bg text-success-fg' },
  refunding: { label: '退款中', cls: 'bg-warning-bg text-warning-fg' },
  refunded: { label: '已退款', cls: 'bg-neutral-100 text-neutral-500' },
  failed: { label: '支付异常', cls: 'bg-error-bg text-error-fg' },
}

/** P0b 未显式处理的支付状态（如 C5-2 线上态 paying/closed）→ 中性诚实回退，不伪装已支付/失败。 */
export const PAY_STATUS_FALLBACK = { label: '处理中', cls: 'bg-neutral-100 text-neutral-500' }

/** 取支付状态展示（未识别状态回退中性文案，避免穷举 C5-2 线上态）。 */
export function payStatusMeta(status: NonNullable<MemberPrintOrderItem['payStatus']>): {
  label: string
  cls: string
} {
  return PAY_STATUS_META[status] ?? PAY_STATUS_FALLBACK
}

/** 取支付来源展示文案（未识别来源如 sandbox → undefined，不显来源提示）。 */
export function paymentSourceLabel(
  source: NonNullable<MemberPrintOrderItem['paymentSource']>,
): string | undefined {
  return PAYMENT_SOURCE_LABEL[source]
}

/** 计费页数来源 → 说明文案（后端识别，非前端上报）。 */
export const BILLING_PAGE_SOURCE_LABEL: Record<NonNullable<MemberPrintOrderItem['billingPageSource']>, string> = {
  pdf_lightweight_scan: '系统识别 PDF 页数',
  image_single_page: '图片按 1 页计',
}

/**
 * 金额（整数分）→ 展示串。0 分显示「免费」；其余按整数分拆元/分拼接，
 * 不做浮点除法（避免精度问题）。非整数 / 负数为非法输入（后端保证为 >= 0 的整数），
 * 返回「—」而非输出异常格式（不编造金额）。
 */
export function formatAmountCents(amountCents: number): string {
  if (!Number.isInteger(amountCents) || amountCents < 0) return '—'
  if (amountCents === 0) return '免费'
  const yuan = Math.floor(amountCents / 100)
  const fen = String(amountCents % 100).padStart(2, '0')
  return `¥${yuan}.${fen}`
}

const UNRECORDED = '未记录'

const DUPLEX_LABEL: Record<NonNullable<MemberPrintOrderItem['duplex']>, string> = {
  simplex: '单面',
  duplex_long_edge: '双面（长边）',
  duplex_short_edge: '双面（短边）',
}

/** 列表摘要用：缺失不占位，避免把「未记录」铺进每一行。 */
export function duplexShortLabel(duplex: MemberPrintOrderItem['duplex'] | undefined): string | undefined {
  if (duplex == null) return undefined
  return DUPLEX_LABEL[duplex]
}

export function duplexDisplay(duplex: MemberPrintOrderItem['duplex'] | undefined): string {
  return duplexShortLabel(duplex) ?? UNRECORDED
}

export function colorModeDisplay(colorMode: MemberPrintOrderItem['colorMode'] | undefined): string {
  if (colorMode === 'color') return '彩色'
  if (colorMode === 'black_white') return '黑白'
  return UNRECORDED
}

export function copiesDisplay(copies: MemberPrintOrderItem['copies'] | undefined): string {
  if (typeof copies === 'number' && Number.isInteger(copies) && copies >= 1) return `${copies} 份`
  return UNRECORDED
}

export function pageRangeDisplay(pageRange: MemberPrintOrderItem['pageRange'] | undefined): string {
  if (typeof pageRange !== 'string' || pageRange.trim().length === 0) return '全部页'
  const trimmed = pageRange.trim()
  return trimmed.toLowerCase() === 'all' ? '全部页' : trimmed
}

/** 给用户看的订单号只认 ORD-。任务 id 和空值都不显示。 */
export function publicOrderNo(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^ORD-[A-Za-z0-9-]+$/.test(trimmed) ? trimmed : null
}

/**
 * 实付：0 元是记下的真实金额，写成「0 元（免费试运营）」。
 * 其余没有单独的实付字段，仍标未记录，不用应付减优惠来推算。
 */
export function netPaidDisplay(item: {
  amountCents?: number | null
  paymentSource?: string | null
}): { value: string; hint?: string } {
  if (item.amountCents === 0 || item.paymentSource === 'free') {
    return { value: '0 元（免费试运营）' }
  }
  return { value: NET_PAID_UNRECORDED, hint: NET_PAID_UNRECORDED_HINT }
}

/**
 * 抵扣 / 已退款等「记录值」：0 分也按整数分格式化，不说「免费」。
 * 非法输入返回「未记录」，不编造金额。
 */
export function formatRecordedCents(amountCents: number): string {
  if (!Number.isInteger(amountCents) || amountCents < 0) return UNRECORDED
  const yuan = Math.floor(amountCents / 100)
  const fen = String(amountCents % 100).padStart(2, '0')
  return `¥${yuan}.${fen}`
}

export function recordedAmountDisplay(amountCents: number | null | undefined): string {
  if (typeof amountCents !== 'number') return UNRECORDED
  return formatRecordedCents(amountCents)
}

/** 实付无独立真源字段，禁止用应付减优惠推算。 */
export const NET_PAID_UNRECORDED = '未记录'
export const NET_PAID_UNRECORDED_HINT = '没有单独记下实付，不按应付减优惠来推算'

/** API-20：已付款未出纸的待退款标签。说明句用标准句 5，且只在金额 > 0 时由详单渲染。 */
export const PENDING_REFUND_LABEL = '待退款'

/** 0 元或免费来源不算付过钱。这些单不出现「退款」。 */
export function orderAmountPaid(item: { amountCents?: number | null; paymentSource?: string | null }): boolean {
  if (item.paymentSource === 'free') return false
  return typeof item.amountCents === 'number' && item.amountCents > 0
}

/**
 * 列表/详单支付状态：付过钱时，待退款信号优先于「已支付」。
 * 免费单即使带了退款状态，也只写「免费」，不出现「退款」。
 * 金额仍只格式化服务端字段。
 */
export function memberPayStatusLabel(
  item: Pick<MemberPrintOrderItem, 'payStatus' | 'refundRequired' | 'amountCents' | 'paymentSource'>,
): { label: string; cls: string } {
  if (!orderAmountPaid(item)) {
    if (item.payStatus == null) {
      return { label: '暂无支付信息', cls: 'bg-neutral-100 text-neutral-500' }
    }
    if (item.refundRequired === true || item.payStatus === 'refunded' || item.payStatus === 'refunding') {
      return { label: '免费', cls: 'bg-neutral-100 text-neutral-500' }
    }
    return payStatusMeta(item.payStatus)
  }
  if (item.refundRequired === true) {
    return { label: PENDING_REFUND_LABEL, cls: 'bg-warning-bg text-warning-fg' }
  }
  if (item.payStatus == null) {
    return { label: '暂无支付信息', cls: 'bg-neutral-100 text-neutral-500' }
  }
  return payStatusMeta(item.payStatus)
}
