import type { MemberPrintOrderItem } from '@ai-job-print/shared'

export const MEMBER_ORDERS_POLL_MS = 5000
export const MEMBER_ORDERS_POLL_MAX_MS = 60000

export const ACTIVE_PRINT_STATUSES = new Set<MemberPrintOrderItem['status']>([
  'pending',
  'claimed',
  'printing',
])

export function isActivePrintStatus(status: MemberPrintOrderItem['status']): boolean {
  return ACTIVE_PRINT_STATUSES.has(status)
}

export function hasActivePrintOrders(items: MemberPrintOrderItem[]): boolean {
  return items.some((item) => isActivePrintStatus(item.status))
}

export function nextPrintOrdersPollDelay(currentDelay: number): number {
  return Math.min(MEMBER_ORDERS_POLL_MAX_MS, currentDelay * 2)
}

export function mergePrintOrderRefresh(
  current: MemberPrintOrderItem[],
  freshFirstPage: MemberPrintOrderItem[],
): MemberPrintOrderItem[] {
  const freshById = new Map(freshFirstPage.map((item) => [item.id, item]))
  const existingIds = new Set(current.map((item) => item.id))
  const newItems = freshFirstPage.filter((item) => !existingIds.has(item.id))
  const mergedItems = current.map((item) => freshById.get(item.id) ?? item)

  return [...newItems, ...mergedItems]
}
