interface Props {
  nextCursor: string | null
  loadingMore: boolean
  loadMoreError: boolean
  loadMore: () => void
  label?: string
}

export function MemberLoadMore({ nextCursor, loadingMore, loadMoreError, loadMore, label = '加载更多' }: Props) {
  if (!nextCursor) return null
  return (
    <div style={{ padding: '16px 0' }}>
      {loadMoreError ? <p role="alert">更多记录没有加载出来，已显示的记录仍可查看。</p> : null}
      <button type="button" className="qx-btn" style={{ minHeight: 56, width: '100%' }}
        disabled={loadingMore} onClick={loadMore}>
        {loadingMore ? '正在加载…' : loadMoreError ? `重试：${label}` : label}
      </button>
    </div>
  )
}
