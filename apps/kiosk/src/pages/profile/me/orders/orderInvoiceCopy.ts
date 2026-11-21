// ============================================================
// 「我的订单」服务单展示、混排与自助开票屏文案（对照触屏稿 pay-1113.js:472-569）。
//
// 口径红线：
// - 金额一律整数分运算输出「X.XX 元」，不使用货币符号，绝不硬编码价格数字。
// - 全程无人值守自服务口吻；退款说明统一「已退回原付款账户，到账时间以支付渠道为准」。
// - 不修改被 W5 冻结的 printOrders/paymentCopy.ts。
// ============================================================

import type { MemberPrintOrderItem, MemberServiceOrderItem, MemberServiceOrderStatus } from '@ai-job-print/shared'
import { kioskEffectivePricesCharged } from '../../../../hooks/kioskHomeFreeBadgeReader'

export type OrdersFilterKey = 'all' | 'active' | 'completed' | 'failed' | 'cancelled'

export type MergedOrderEntry =
  | { kind: 'print'; sortAt: number; id: string; item: MemberPrintOrderItem }
  | { kind: 'service'; sortAt: number; id: string; item: MemberServiceOrderItem }

/** 整数分 → 「X.XX 元」，不使用货币符号，避免浮点除法误差。非正或非法返回「—」。 */
export function formatOrderYuan(amountCents: number): string {
  if (!Number.isInteger(amountCents) || amountCents < 0) return '—'
  const yuan = Math.floor(amountCents / 100)
  const fen = String(amountCents % 100).padStart(2, '0')
  return `${yuan}.${fen} 元`
}

/** 本机当前是否开启个人收费（任一有效价 > 0，且非公共就业点位/非机构承担/总开关未关）。 */
export function isTerminalConfigCharged(config: unknown): boolean {
  if (typeof config !== 'object' || config === null) return false
  const pricing = (config as { pricing?: unknown }).pricing
  if (typeof pricing !== 'object' || pricing === null) return false
  const record = pricing as {
    isPublicSite?: unknown
    personalChargeEnabled?: unknown
    userChargeMode?: unknown
  }
  if (record.isPublicSite === true) return false
  if (record.personalChargeEnabled === false) return false
  if (record.userChargeMode === 'org_pays') return false
  return kioskEffectivePricesCharged(config)
}

/** 会员名下是否存在实付 > 0 的打印单。 */
export function hasChargedPrintOrder(items: readonly MemberPrintOrderItem[]): boolean {
  return items.some((item) => typeof item.amountCents === 'number' && item.amountCents > 0)
}

/** 服务单行副文案，逐态对齐 pay-1113.js:525-529 与 P2c2 任务规范。 */
export function serviceOrderSubtitle(
  item: MemberServiceOrderItem,
  formatTimeLabel: (iso: string) => string,
): string {
  const money = formatOrderYuan(item.amountCents)
  const time = formatTimeLabel(item.refundedAt ?? item.paidAt ?? item.createdAt)
  if (item.invoiceStatus === 'issued') {
    return `发票已开 · ${money} · 电子发票已发到邮箱 · ${time}`
  }
  if (item.invoiceStatus === 'submitted') {
    return `已提交开票 · ${money} · 电子发票开好后发到邮箱 · ${time}`
  }
  if (item.status === 'refunded') {
    return `已退款 · ${money} · 已退回原付款账户，到账时间以支付渠道为准 · ${time}`
  }
  if (item.status === 'refunding' || item.status === 'refund_failed') {
    return `退款处理中 · ${money} · ${time}`
  }
  if (item.canInvoice && item.invoiceStatus === 'returned') {
    return `开票申请被退回 · ${money} · ${time}`
  }
  return `已付款 · ${money} · ${time}`
}

/** 实付 > 0 打印单的开票态补充提示（仅已提交/已开/退回时给出，不喧宾夺主）。 */
export function printOrderInvoiceHint(item: MemberPrintOrderItem): string | null {
  if (!(typeof item.amountCents === 'number' && item.amountCents > 0)) return null
  if (item.invoiceStatus === 'issued') return '发票已开 · 电子发票已发到邮箱'
  if (item.invoiceStatus === 'submitted') return '已提交开票'
  if (item.canInvoice && item.invoiceStatus === 'returned') return '开票申请被退回'
  return null
}

/** 打印单是否可直接展示「开发票」主按钮。 */
export function canShowPrintOrderInvoiceButton(item: MemberPrintOrderItem): boolean {
  return Boolean(
    item.canInvoice === true
    && item.orderId
    && typeof item.amountCents === 'number'
    && item.amountCents > 0,
  )
}

/** 服务单与顶部状态筛选条的诚实对应关系：不丢服务单，不把已退款算成已完成。 */
export function matchesServiceOrderFilter(status: MemberServiceOrderStatus, filterKey: OrdersFilterKey): boolean {
  if (filterKey === 'all') return true
  if (filterKey === 'active') return status === 'refunding' || status === 'refund_failed'
  if (filterKey === 'completed') return status === 'paid' || status === 'consumed'
  if (filterKey === 'cancelled') return status === 'refunded'
  return false
}

/** 打印单与服务单按创建时间从新到旧混排；同一毫秒服务单排在打印单前面。 */
export function mergeOrdersNewestFirst(
  printItems: readonly MemberPrintOrderItem[],
  serviceItems: readonly MemberServiceOrderItem[],
): MergedOrderEntry[] {
  const entries: MergedOrderEntry[] = [
    ...printItems.map((item): MergedOrderEntry => ({
      kind: 'print',
      sortAt: Date.parse(item.createdAt) || 0,
      id: item.id,
      item,
    })),
    ...serviceItems.map((item): MergedOrderEntry => ({
      kind: 'service',
      sortAt: Date.parse(item.createdAt) || 0,
      id: item.id,
      item,
    })),
  ]
  return entries.sort((left, right) => {
    const byTime = right.sortAt - left.sortAt
    if (byTime !== 0) return byTime
    if (left.kind !== right.kind) return left.kind === 'service' ? -1 : 1
    if (left.id === right.id) return 0
    return left.id > right.id ? -1 : 1
  })
}

export const INVOICE_SCREEN_EYEBROW = '我的 · 订单'
export const INVOICE_QR_TITLE = '用手机扫码填写开票信息'
export const INVOICE_FREE_TITLE = '这台机器免费，没有需要开发票的订单'
export const INVOICE_LIST_TITLE = '手机上要填的三项'
export const INVOICE_CHECKLIST_ITEMS = [
  '抬头。个人写姓名，单位写单位名称。',
  '税号。单位才要填。个人不用填税号。',
  '接收邮箱。电子发票发到这个邮箱。这台屏幕不保存税号。',
] as const
export const INVOICE_FINE_PRINT = '在手机上填写并提交。没付成或已退款的单，开不了发票。'
export const INVOICE_SUBMITTED_CONFIRM = '开票信息已提交。开好后，电子发票发到你填的邮箱。'
export const INVOICE_RATE_LIMIT_NOTE = '查询较频繁，稍后会自动继续查看。'
export const INVOICE_ASK_DRAFT = {
  label: '问小青：发票发到哪',
  draft: '电子发票发到哪里？',
} as const

export function invoiceQrSubtitle(amountCents: number | null | undefined): string {
  if (typeof amountCents === 'number' && Number.isInteger(amountCents) && amountCents > 0) {
    return `这一单 ${formatOrderYuan(amountCents)}。开好后，电子发票发到你填的邮箱。`
  }
  return '开好后，电子发票发到你填的邮箱。'
}

export function invoiceDetailPath(orderKind: 'print' | 'service', orderId: string): string {
  const params = new URLSearchParams({ kind: orderKind, id: orderId })
  return `/me/orders/invoice?${params.toString()}`
}
