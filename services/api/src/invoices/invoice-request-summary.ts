/**
 * 订单列表批量关联 InvoiceRequest 的纯摘要工具（零 PII：只读 id / orderId / status / createdAt）。
 *
 * 与 InvoiceRequestsService.latestRequests 保持同一优先级：
 * 同一订单优先取未退回申请（submitted / issued），否则取最近一条 returned。
 */
import type { InvoiceOpenStatus } from './invoice-eligibility'

export type MemberInvoiceStatus = 'none' | 'submitted' | 'issued' | 'returned'

export interface InvoiceRequestSummaryRow {
  id: string
  orderId: string
  status: string
  createdAt: Date
}

export interface PickedInvoiceRequest {
  id: string
  status: Exclude<MemberInvoiceStatus, 'none'>
}

function isKnownInvoiceStatus(status: string): status is Exclude<MemberInvoiceStatus, 'none'> {
  return status === 'submitted' || status === 'issued' || status === 'returned'
}

export function pickLatestInvoiceRequestByOrder(
  rows: readonly InvoiceRequestSummaryRow[],
): Map<string, PickedInvoiceRequest> {
  const ordered = [...rows].sort((left, right) => {
    const byTime = right.createdAt.getTime() - left.createdAt.getTime()
    if (byTime !== 0) return byTime
    if (left.id === right.id) return 0
    return left.id > right.id ? -1 : 1
  })
  const byOrder = new Map<string, PickedInvoiceRequest>()
  for (const row of ordered) {
    if (!isKnownInvoiceStatus(row.status)) continue
    const current = byOrder.get(row.orderId)
    if (!current || (current.status === 'returned' && row.status !== 'returned')) {
      byOrder.set(row.orderId, { id: row.id, status: row.status })
    }
  }
  return byOrder
}

export function toInvoiceOpenStatus(picked: PickedInvoiceRequest | undefined): InvoiceOpenStatus {
  if (!picked) return null
  if (picked.status === 'issued') return 'issued'
  if (picked.status === 'submitted') return 'submitted'
  return null
}
