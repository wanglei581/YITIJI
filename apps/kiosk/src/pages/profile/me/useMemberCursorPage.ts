import { useCallback, useEffect, useRef, useState } from 'react'

interface CursorPage<T> { items: T[]; nextCursor: string | null; total?: number }
const itemId = (item: { id: string }) => item.id

/** 每个来源一份游标；刷新/筛选/换人作废旧请求，追加失败保留已读内容。 */
export function useMemberCursorPage<T, P extends CursorPage<T> = CursorPage<T>>({
  enabled, identityKey, reloadKey = 0, fetchPage, keyOf = itemId as (item: T) => string,
}: {
  enabled: boolean
  identityKey: string | null | undefined
  reloadKey?: number | string
  fetchPage: (cursor?: string) => Promise<P>
  keyOf?: (item: T) => string
}) {
  const [items, setItems] = useState<T[]>([])
  const [scope, setScope] = useState<{ identityKey: typeof identityKey; reloadKey: typeof reloadKey; fetchPage: typeof fetchPage } | null>(null)
  const [page, setPage] = useState<P | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  const generation = useRef(0)
  const pending = useRef(false)
  const currentIdentity = useRef(identityKey)
  currentIdentity.current = identityKey

  useEffect(() => {
    const run = ++generation.current
    const live = () => generation.current === run && currentIdentity.current === identityKey
    pending.current = false
    setScope({ identityKey, reloadKey, fetchPage })
    setItems([])
    setPage(null)
    setNextCursor(null)
    setLoadingMore(false)
    setLoadMoreError(false)
    setState(enabled ? 'loading' : 'ready')
    if (enabled) void fetchPage().then((result) => {
      if (!live()) return
      setItems(result.items)
      setPage(result)
      setNextCursor(result.nextCursor)
      setState('ready')
    }).catch(() => { if (live()) setState('error') })
    return () => { generation.current += 1 }
  }, [enabled, identityKey, reloadKey, fetchPage])

  const loadMore = useCallback(async () => {
    if (!enabled || !nextCursor || pending.current || state !== 'ready') return
    const run = generation.current
    const live = () => generation.current === run && currentIdentity.current === identityKey
    pending.current = true
    setLoadingMore(true)
    setLoadMoreError(false)
    try {
      const result = await fetchPage(nextCursor)
      if (!live()) return
      setItems((previous) => [...new Map([...previous, ...result.items].map((item) => [keyOf(item), item])).values()])
      setPage(result)
      setNextCursor(result.nextCursor)
    } catch {
      if (live()) setLoadMoreError(true)
    } finally {
      if (live()) { pending.current = false; setLoadingMore(false) }
    }
  }, [enabled, fetchPage, identityKey, keyOf, nextCursor, state])

  // 换人或切换筛选的第一帧就不展示旧列表，不等 effect 执行。
  const current = enabled && scope !== null && scope.identityKey === identityKey && scope.reloadKey === reloadKey && scope.fetchPage === fetchPage
  return { items: current ? items : [], setItems, page: current ? page : null,
    total: current ? page?.total ?? items.length : 0, state: !enabled ? 'ready' as const : current ? state : 'loading' as const,
    nextCursor: current ? nextCursor : null, loadingMore: current && loadingMore, loadMoreError: current && loadMoreError, loadMore }

}
