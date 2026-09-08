import { KIcon } from '../../../../components/kiosk-icon'
import type { MemberFeedbackTicketDetail, MemberFeedbackTicketItem } from '../../../../services/api/memberFeedback'
import { formatTime } from '../../assets/format'
import { CATEGORY_META, STATUS_META } from './types'

export function FeedbackListPanel({
  items,
  selected,
  selectedId,
  loading,
  totalLabel,
  onOpen,
}: {
  items: MemberFeedbackTicketItem[]
  selected: MemberFeedbackTicketDetail | null
  selectedId: string | null
  loading: boolean
  totalLabel: string
  onOpen: (id: string) => void
}) {
  return (
    <section className="qx-card" aria-label="我的反馈">
      <div className="qx-sec-h">
        <h2 className="t">我的反馈</h2>
        <span className="hint">{totalLabel}</span>
      </div>
      <p className="qx-row-d" style={{ marginBottom: 12 }}>查看处理状态、服务回复和补充描述</p>

      {items.length === 0 ? (
        <div className="qx-state" data-tone="empty">
          <span className="qx-state-ic" />
          <span>
            <div className="qx-state-t">还没有反馈记录</div>
            <p className="qx-state-d">提交反馈后，这里会显示处理状态与回复</p>
          </span>
        </div>
      ) : (
        <div className="qx-rows">
          {items.map((item) => (
            <FeedbackRow
              key={item.id}
              item={item}
              active={selected?.id === item.id || selectedId === item.id}
              loading={loading}
              onOpen={() => onOpen(item.id)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function FeedbackRow({
  item,
  active,
  loading,
  onOpen,
}: {
  item: MemberFeedbackTicketItem
  active: boolean
  loading: boolean
  onOpen: () => void
}) {
  const category = CATEGORY_META[item.category]
  const status = STATUS_META[item.status]
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onOpen}
      className="qx-row"
      data-active={active ? 'true' : undefined}
    >
      <span className="qx-row-ic" aria-hidden="true">
        <KIcon name={category.icon} />
      </span>
      <span className="qx-row-tx">
        <span className="qx-row-t">{item.title || item.content}</span>
        <span className="qx-row-d">
          {category.label} · {formatTime(item.updatedAt)}
        </span>
      </span>
      <span className="fb-st">{status.label}</span>
    </button>
  )
}
