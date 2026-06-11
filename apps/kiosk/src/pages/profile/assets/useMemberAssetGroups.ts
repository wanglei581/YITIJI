// ============================================================
// 账号资产加载 hook（Phase C-2D）
//
// 每个资产组独立加载、独立失败、独立重试、独立翻页（游标 + 加载更多）——
// 不再用单个 Promise.all 把六个列表绑在一起（一个失败全员失败 / 最慢者阻塞全部）。
// 各组首次加载在登录后并行触发，互不等待（等价 Promise.allSettled 的分组语义）。
//
// total 来自服务端真实 count（头部统计用），removeLocal 在删除成功后本地摘行并减计数，
// 不整页重载。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  MemberAiRecordItem,
  MemberAssetPage,
  MemberBenefitItem,
  MemberDocumentItem,
  MemberFavoriteItem,
  MemberPrintOrderItem,
  MemberResumeItem,
} from '@ai-job-print/shared'
import { getMyAiRecords, getMyDocuments, getMyResumes } from '../../../services/api/memberAssets'
import { getMyBenefits, getMyFavorites } from '../../../services/api/memberFavorites'
import { getMyPrintOrders } from '../../../services/api/memberPrintOrders'

/** 每页条数（展示页较小步进，配合「加载更多」；服务端封顶 50）。 */
const PAGE_SIZE = 10

type PageResult<T> = Pick<MemberAssetPage<T>, 'items' | 'nextCursor'> & { total: number }

export interface AssetGroupHandle<T> {
  items: T[]
  /** 服务端真实总数；null = 尚未加载完成 */
  total: number | null
  loading: boolean
  loadingMore: boolean
  error: boolean
  nextCursor: string | null
  reload: () => void
  loadMore: () => void
  /** 删除成功后本地摘行（含 total 减一），不整页重载 */
  removeLocal: (id: string) => void
}

function useAssetGroup<T extends { id: string }>(
  enabled: boolean,
  fetchPage: (cursor: string | null) => Promise<PageResult<T>>,
): AssetGroupHandle<T> {
  const [items, setItems] = useState<T[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  // 请求代际：登出 / 重载后丢弃过期响应
  const gen = useRef(0)

  const reload = useCallback(() => {
    if (!enabled) return
    const g = ++gen.current
    setLoading(true)
    setError(false)
    fetchPage(null)
      .then((page) => {
        if (g !== gen.current) return
        setItems(page.items)
        setTotal(page.total)
        setNextCursor(page.nextCursor)
      })
      .catch(() => {
        if (g !== gen.current) return
        setError(true)
      })
      .finally(() => {
        if (g === gen.current) setLoading(false)
      })
  }, [enabled, fetchPage])

  const loadMore = useCallback(() => {
    if (!enabled || !nextCursor || loadingMore) return
    const g = gen.current
    setLoadingMore(true)
    fetchPage(nextCursor)
      .then((page) => {
        if (g !== gen.current) return
        setItems((prev) => [...prev, ...page.items])
        setTotal(page.total)
        setNextCursor(page.nextCursor)
      })
      .catch(() => {
        // 翻页失败不打断已展示内容；保留游标供再次点击重试
      })
      .finally(() => {
        if (g === gen.current) setLoadingMore(false)
      })
  }, [enabled, nextCursor, loadingMore, fetchPage])

  const removeLocal = useCallback((id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id))
    setTotal((prev) => (prev === null ? prev : Math.max(0, prev - 1)))
  }, [])

  // 登录 → 首次加载；登出 → 清空（公共设备不残留上一位会员的资产视图）
  useEffect(() => {
    if (enabled) {
      reload()
      return
    }
    gen.current += 1
    setItems([])
    setTotal(null)
    setError(false)
    setNextCursor(null)
    setLoading(false)
    setLoadingMore(false)
  }, [enabled, reload])

  return { items, total, loading, loadingMore, error, nextCursor, reload, loadMore, removeLocal }
}

export interface MemberAssetGroups {
  resumes: AssetGroupHandle<MemberResumeItem>
  documents: AssetGroupHandle<MemberDocumentItem>
  aiRecords: AssetGroupHandle<MemberAiRecordItem>
  printOrders: AssetGroupHandle<MemberPrintOrderItem>
  favorites: AssetGroupHandle<MemberFavoriteItem>
  benefits: AssetGroupHandle<MemberBenefitItem>
}

export function useMemberAssetGroups(
  isLoggedIn: boolean,
  getToken: () => string | null,
): MemberAssetGroups {
  const resumes = useAssetGroup(
    isLoggedIn,
    useCallback((cursor: string | null) => getMyResumes(getToken(), { cursor, pageSize: PAGE_SIZE }), [getToken]),
  )
  const documents = useAssetGroup(
    isLoggedIn,
    useCallback((cursor: string | null) => getMyDocuments(getToken(), { cursor, pageSize: PAGE_SIZE }), [getToken]),
  )
  const aiRecords = useAssetGroup(
    isLoggedIn,
    useCallback((cursor: string | null) => getMyAiRecords(getToken(), { cursor, pageSize: PAGE_SIZE }), [getToken]),
  )
  const printOrders = useAssetGroup(
    isLoggedIn,
    useCallback((cursor: string | null) => getMyPrintOrders(getToken(), { cursor, pageSize: PAGE_SIZE }), [getToken]),
  )
  const favorites = useAssetGroup(
    isLoggedIn,
    useCallback(
      (cursor: string | null) => getMyFavorites(getToken(), undefined, { cursor, pageSize: PAGE_SIZE }),
      [getToken],
    ),
  )
  const benefits = useAssetGroup(
    isLoggedIn,
    useCallback((cursor: string | null) => getMyBenefits(getToken(), { cursor, pageSize: PAGE_SIZE }), [getToken]),
  )
  return { resumes, documents, aiRecords, printOrders, favorites, benefits }
}
