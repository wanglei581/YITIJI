import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/useAuth'
import { addFavorite, getMyFavorites, removeFavorite } from '../services/api/memberFavorites'
import { FavoritesContext, type FavoriteToggleItem, type FavoritesContextValue } from './context'
import { readLocalJobFavorites, toggleLocalJobFavorite } from './localFavorites'

/**
 * 岗位收藏 Provider（Phase C-2C follow-up）。挂在 KioskRoot 布局内，覆盖岗位列表/详情。
 *
 * 登录态门控（不破坏匿名浏览）：
 * - 登录会员：以服务端 /me/favorites（type='job'）为 SSOT；登录后拉取一次，toggle 走
 *   addFavorite/removeFavorite（乐观更新，失败回滚 + 提示）。
 * - 未登录 / 匿名：沿用本机 localStorage 收藏（历史收藏不丢），toggle 写本机；新增收藏时
 *   提示「登录后可同步到账号」，引导但不强制登录。
 *
 * 合规：收藏只记录浏览 / 收藏行为，绝不记录投递结果 / 候选人数据。
 */
export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn, getToken } = useAuth()
  const [ids, setIds] = useState<Set<string>>(() => new Set(readLocalJobFavorites()))
  const [loading, setLoading] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  const source: 'local' | 'server' = isLoggedIn ? 'server' : 'local'

  // 登录态切换：登录→拉服务端收藏；登出/匿名→回本机收藏。
  useEffect(() => {
    if (!isLoggedIn) {
      setLoading(false)
      setIds(new Set(readLocalJobFavorites()))
      return
    }
    const token = getToken()
    if (!token) {
      setIds(new Set(readLocalJobFavorites()))
      return
    }
    let cancelled = false
    setLoading(true)
    getMyFavorites(token, 'job')
      .then((items) => {
        if (cancelled) return
        setIds(new Set(items.map((f) => f.targetId)))
      })
      .catch(() => {
        // 服务端不可达：登录态下不回退到本机（避免把他人/历史本机收藏误当本人资产），保持空集。
        if (!cancelled) setIds(new Set())
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isLoggedIn, getToken])

  // hint 自动消失。
  useEffect(() => {
    if (!hint) return
    const t = setTimeout(() => setHint(null), 3000)
    return () => clearTimeout(t)
  }, [hint])

  // 防并发抖动：同一 id 的写入进行中时忽略重复点击。
  const pending = useRef<Set<string>>(new Set())

  const toggle = useCallback(
    (item: FavoriteToggleItem) => {
      const id = item.id
      const has = ids.has(id)

      if (isLoggedIn) {
        const token = getToken()
        if (!token) return
        if (pending.current.has(id)) return
        pending.current.add(id)
        // 乐观更新
        setIds((prev) => {
          const next = new Set(prev)
          if (has) next.delete(id)
          else next.add(id)
          return next
        })
        const op = has
          ? removeFavorite(token, 'job', id)
          : addFavorite(token, { targetType: 'job', targetId: id, title: item.title })
        op
          .then(() => undefined)
          .catch(() => {
            // 回滚到操作前状态
            setIds((prev) => {
              const next = new Set(prev)
              if (has) next.add(id)
              else next.delete(id)
              return next
            })
            setHint('收藏同步失败，请稍后重试')
          })
          .finally(() => {
            pending.current.delete(id)
          })
        return
      }

      // 匿名 / 未登录：本机收藏，新增时提示可登录同步。
      const next = toggleLocalJobFavorite(id)
      setIds(new Set(next))
      if (!has) setHint('已收藏到本机，登录后可同步到账号')
    },
    [ids, isLoggedIn, getToken],
  )

  const value = useMemo<FavoritesContextValue>(
    () => ({
      ids,
      isFavorite: (id: string) => ids.has(id),
      toggle,
      loading,
      source,
    }),
    [ids, toggle, loading, source],
  )

  return (
    <FavoritesContext.Provider value={value}>
      {children}
      {hint && (
        <div
          role="status"
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-neutral-900/90 px-5 py-2.5 text-sm font-medium text-white shadow-lg"
        >
          {hint}
        </div>
      )}
    </FavoritesContext.Provider>
  )
}
