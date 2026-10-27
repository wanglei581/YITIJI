import type { MemberFeedbackTicketDetail, MemberFeedbackTicketItem } from '../../../../services/api/memberFeedback'
import { formatTime } from '../../assets/format'
import { MeP, MeRows } from '../../touch/MeKit'
import { CATEGORY_META, STATUS_META } from './types'

/** 以前的处理进度：每条一行，点开读详情。还没有反馈时写一句话。 */
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
  if (items.length === 0) {
    return (
      <section className="me-static" aria-label="我的反馈">
        <b>还没有反馈记录</b>
        <small>提交反馈后，这里会显示处理状态与回复</small>
      </section>
    )
  }
  return (
    <section aria-label="我的反馈" className="me-hist">
      <MeP>我的反馈 · {totalLabel}。查看处理状态、服务回复和补充描述。</MeP>
      <MeRows few>
        {items.map((item) => (
          <FeedbackRow
            key={item.id}
            item={item}
            active={selected?.id === item.id || selectedId === item.id}
            loading={loading}
            onOpen={() => onOpen(item.id)}
          />
        ))}
      </MeRows>
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
      className="me-line"
      data-active={active ? 'true' : undefined}
    >
      <b>{item.title || item.content}</b>
      <small>
        {category.label} · {formatTime(item.updatedAt)} · {status.label}
      </small>
    </button>
  )
}
