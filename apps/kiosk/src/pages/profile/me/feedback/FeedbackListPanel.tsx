import { Card, EmptyState } from '@ai-job-print/ui'
import { MessageSquareIcon } from 'lucide-react'
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
    <Card className="me-benefit-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="me-section-copy">
          <h2>我的反馈</h2>
          <p>查看处理状态、服务回复和补充描述</p>
        </div>
        <span className="me-chip">{totalLabel}</span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={MessageSquareIcon}
          title="还没有反馈记录"
          description="提交反馈后，这里会显示处理状态与回复"
          className="py-12"
        />
      ) : (
        <div className="grid gap-3">
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
    </Card>
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
      className={['me-ripple me-detail-row', active ? 'border-[rgba(36,101,86,0.38)] bg-[rgba(220,238,230,0.72)]' : ''].join(' ')}
    >
      <span className={['me-row-icon', `me-tone-${category.tone}`].join(' ')} aria-hidden="true">
        <KIcon name={category.icon} />
      </span>
      <div className="min-w-0 flex-1">
        <span className="me-row-title">{item.title || item.content}</span>
        <span className="me-row-meta">
          {category.label} · {formatTime(item.updatedAt)}
        </span>
      </div>
      <span className={['me-status', status.cls].join(' ')}>{status.label}</span>
      <KIcon name="arrow" className="me-row-arrow" />
    </button>
  )
}
