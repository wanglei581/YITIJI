import type { MemberPrintOrderItem, MemberServiceOrderItem } from '@ai-job-print/shared'
import { formatTime } from '../../assets/format'
import { MeBtn } from '../../touch/MeKit'
import { canShowPrintOrderInvoiceButton, serviceOrderSubtitle } from './orderInvoiceCopy'

export function ServiceOrderRow({
  item,
  onInvoice,
}: {
  item: MemberServiceOrderItem
  onInvoice: (item: MemberServiceOrderItem) => void
}) {
  const subtitle = serviceOrderSubtitle(item, formatTime)
  return (
    <div
      className="me-line me-bill-row"
      data-testid="member-service-order"
      data-server-slot="service-order"
      data-service-key={item.serviceKey}
      data-order-status={item.status}
      data-invoice-status={item.invoiceStatus}
    >
      <div className="me-bill-tx">
        <b>{item.serviceName}</b>
        <small>{subtitle}</small>
      </div>
      {item.canInvoice ? (
        <MeBtn
          v="pri"
          className="me-bill-btn"
          data-testid={`service-order-invoice-${item.id}`}
          aria-label={`为 ${item.serviceName} 开发票`}
          onClick={() => onInvoice(item)}
        >
          开发票
        </MeBtn>
      ) : null}
    </div>
  )
}

export function PrintOrderInvoiceAction({
  item,
  name,
  onInvoice,
}: {
  item: MemberPrintOrderItem
  name: string
  onInvoice: (item: MemberPrintOrderItem) => void
}) {
  if (!canShowPrintOrderInvoiceButton(item)) return null
  return (
    <MeBtn
      v="pri"
      className="me-bill-btn"
      data-testid={`print-order-invoice-${item.id}`}
      aria-label={`为 ${name} 开发票`}
      onClick={() => onInvoice(item)}
    >
      开发票
    </MeBtn>
  )
}

export function ServiceOrdersMoreAction({
  hasMore,
  loading,
  onMore,
}: {
  hasMore: boolean
  loading: boolean
  onMore: () => void
}) {
  if (!hasMore) return null
  return (
    <div className="me-more">
      <MeBtn v="sec" className="me-wide" onClick={onMore} disabled={loading}>
        {loading ? '正在加载更多服务单…' : '加载更多服务单'}
      </MeBtn>
    </div>
  )
}
