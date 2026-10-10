import { ChevronRightIcon } from 'lucide-react'
import type { MemberFeedbackTicketDetail, MemberFeedbackTicketItem } from '../../../../services/api/memberFeedback'
import { MemberLoadMore } from '../MemberLoadMore'
import { formatTime } from '../../assets/format'
import { FeedbackMark } from './FeedbackMark'
import { CATEGORY_OPTIONS, CATEGORY_META, STATUS_META } from './types'

export function FeedbackListPanel({
  items,
  selected,
  selectedId,
  loading,
  onOpen,
  nextCursor,
  loadingMore,
  loadMoreError,
  loadMore,
}: {
  items: MemberFeedbackTicketItem[]
  selected: MemberFeedbackTicketDetail | null
  selectedId: string | null
  loading: boolean
  onOpen: (id: string) => void
  nextCursor: string | null
  loadingMore: boolean
  loadMoreError: boolean
  loadMore: () => void
}) {
  return (
    <section className="qx-me-list fb-list" aria-label={items.length === 0 ? '还没有反馈记录' : '我的反馈'}>
      {items.length === 0 ? (
        <>
          {CATEGORY_OPTIONS.map((option) => (
            <div key={option.value} className="qx-me-row" data-testid={`member-feedback-cat-slot-${option.value}`}>
              <FeedbackMark category={option.value} />
              <span className="qx-me-row-main">
                <span className="qx-me-row-title">{option.label}</span>
                <span className="qx-me-row-sub">{option.hint}</span>
              </span>
              <span className="qx-me-slot">暂无工单</span>
            </div>
          ))}
          <p className="qx-me-legal">
            <b>还没有反馈记录。</b>
            提交之后，工单会按上面的分类出现在这一页，可以查看状态、追加描述或关闭。
          </p>
        </>
      ) : (
        items.map((item) => (
          <FeedbackRow
            key={item.id}
            item={item}
            active={selected?.id === item.id || selectedId === item.id}
            loading={loading}
            onOpen={() => onOpen(item.id)}
          />
        ))
      )}
      <MemberLoadMore nextCursor={nextCursor} loadingMore={loadingMore} loadMoreError={loadMoreError} loadMore={loadMore} />
      {items.length > 0 ? (
        <p className="qx-me-legal">列表只显示本人工单；免登录提交的一体机问题反馈不会出现在这里，也无法在本页查看或追加。</p>
      ) : null}
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
  const tone = item.status === 'pending' ? 'wait' : item.status === 'processing' ? 'run' : undefined
  return (
    <button
      type="button"
      disabled={loading}
      onClick={onOpen}
      className="qx-me-row"
      data-flag={active ? 'true' : undefined}
      data-testid={`member-feedback-ticket-${item.id}`}
    >
      <FeedbackMark category={item.category} />
      <span className="qx-me-row-main">
        <span className="qx-me-row-title">{item.title || item.content}</span>
        <span className="qx-me-row-sub">{category.label} · {formatTime(item.updatedAt)}</span>
      </span>
      <span className="qx-me-st" data-tone={tone}>{status.label}</span>
      <span className="fb-row-chevron" aria-hidden="true"><ChevronRightIcon /></span>
    </button>
  )
}
