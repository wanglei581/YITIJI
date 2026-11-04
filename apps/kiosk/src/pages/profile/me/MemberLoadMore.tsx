import { MeBtn } from '../touch/MeKit'

interface Props {
  nextCursor: string | null
  loadingMore: boolean
  loadMoreError: boolean
  loadMore: () => void
  label?: string
  /** 读屏念的整句（例如带已加载条数）。不传时就是按钮上的字。 */
  ariaLabel?: string
}

/** 稿 moreBtn：加载更多 / 正在加载更多… / 还有记录这次没载入 + 再加载一次。 */
export function MemberLoadMore({ nextCursor, loadingMore, loadMoreError, loadMore, label = '加载更多', ariaLabel }: Props) {
  if (!nextCursor) return null
  const text = loadingMore ? '正在加载更多…' : loadMoreError ? '再加载一次' : label
  return (
    <div className="me-more">
      {loadMoreError ? <p role="alert" className="me-reason">还有记录这次没载入。已显示的记录仍可查看。</p> : null}
      <MeBtn v="sec" className="me-wide" disabled={loadingMore} aria-label={loadingMore || loadMoreError ? undefined : ariaLabel} onClick={loadMore}>
        {text}
      </MeBtn>
    </div>
  )
}
