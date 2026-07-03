// ============================================================
// 「我的打印订单」支付展示文案映射（C5 P0b）——诚实口径 SSOT。
//
// 合规硬约束（CLAUDE.md §12 / payment-domain-c5-plan §⓪）：
// - paymentSource 只可能是 offline / free / manual_confirmed（shared 类型层保证，
//   无 live 网关）；本文件绝不出现任何线上支付渠道文案。
// - unpaid → 「待现场确认」；关联 Order 缺失（payStatus 为 null）→ 「暂无支付信息」，
//   由页面分支处理，不在此编造默认值。
// - 金额一律整数「分」运算，不用浮点除法拼小数。
// ============================================================

import type { MemberPrintOrderItem } from '@ai-job-print/shared'

/** 支付来源 → 诚实中文文案（白名单；线上渠道未接入，不得出现）。 */
export const PAYMENT_SOURCE_LABEL: Record<NonNullable<MemberPrintOrderItem['paymentSource']>, string> = {
  offline: '线下收款',
  free: '免费',
  manual_confirmed: '人工确认',
}

/** 支付状态 → 文案与徽章样式（token 类，禁用默认灰蓝色阶）。 */
export const PAY_STATUS_META: Record<
  NonNullable<MemberPrintOrderItem['payStatus']>,
  { label: string; cls: string }
> = {
  unpaid: { label: '待现场确认', cls: 'bg-warning-bg text-warning-fg' },
  paid: { label: '已支付', cls: 'bg-success-bg text-success-fg' },
  refunded: { label: '已退款', cls: 'bg-neutral-100 text-neutral-500' },
  failed: { label: '支付异常', cls: 'bg-error-bg text-error-fg' },
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
