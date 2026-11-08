import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { FavoriteTargetType } from '@ai-job-print/shared'
import { useAuth } from '../auth/useAuth'
import { addFavorite, getAllMyFavorites, removeFavorite } from '../services/api/memberFavorites'
import { FavoritesContext, type FavoriteToggleItem, type FavoritesContextValue } from './context'

type IdSets = Record<FavoriteTargetType, Set<string>>

function emptySets(): IdSets {
  return { job: new Set(), job_fair: new Set(), policy: new Set() }
}

function withId(prev: IdSets, type: FavoriteTargetType, id: string, on: boolean): IdSets {
  const next = { ...prev, [type]: new Set(prev[type]) }
  if (on) next[type].add(id)
  else next[type].delete(id)
  return next
}

/**
 * 收藏 Provider（岗位 / 招聘会 / 政策三类）。挂在 KioskRoot 布局内（RouterProvider 树里）。
 *
 * 收藏只存进本人账号（2026-11-05 政策最小闭环）：
 * - 登录会员：以服务端 /me/favorites 为准；登录后逐页拉全量 id 集合，toggle 走
 *   addFavorite/removeFavorite（乐观更新，失败回滚并提示）。
 * - 未登录：不再记本机收藏（localFavorites.ts 停放，源码保留；只有 kioskSensitiveSession
 *   还用它清掉改版前留在本机的旧收藏）。点收藏直接去登录，登录后回到原页再点。
 *
 * 合规：收藏只记录浏览 / 收藏行为，绝不记录投递结果 / 候选人数据。
 */
export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn, getToken } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [ids, setIds] = useState<IdSets>(emptySets)
  const [loading, setLoading] = useState(false)
  const [hint, setHint] = useState<string | null>(null)

  const source: 'local' | 'server' = isLoggedIn ? 'server' : 'local'

  // 登录态切换：登录→拉服务端收藏；登出/未登录→清空（本机不留任何人的收藏）。
  useEffect(() => {
    if (!isLoggedIn) {
      setLoading(false)
      setIds(emptySets())
      return
    }
    const token = getToken()
    if (!token) {
      setIds(emptySets())
      return
    }
    let cancelled = false
    setLoading(true)
    getAllMyFavorites(token)
      .then((items) => {
        if (cancelled) return
        const next = emptySets()
        for (const f of items) next[f.targetType]?.add(f.targetId)
        setIds(next)
      })
      .catch(() => {
        // 服务端不可达：保持空集，不拿本机或历史数据冒充本人收藏。
        if (!cancelled) setIds(emptySets())
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

  // 防并发抖动：同一 type:id 的写入进行中时忽略重复点击。
  const pending = useRef<Set<string>>(new Set())

  const toggle = useCallback(
    (item: FavoriteToggleItem) => {
      const { type, id } = item
      if (!isLoggedIn) {
        // 收藏只存进本人账号：先去登录，登录后回到这一页。
        navigate(`/login?from=${encodeURIComponent(`${location.pathname}${location.search}`)}`)
        return
      }
      const token = getToken()
      if (!token) return
      const key = `${type}:${id}`
      if (pending.current.has(key)) return
      pending.current.add(key)
      const has = ids[type].has(id)
      setIds((prev) => withId(prev, type, id, !has))
      const op = has
        ? removeFavorite(token, type, id)
        : addFavorite(token, { targetType: type, targetId: id, title: item.title })
      op
        .then(() => undefined)
        .catch(() => {
          setIds((prev) => withId(prev, type, id, has))
          setHint(has ? '这次没取消成功，收藏还在，请稍后再试' : '这次没收藏成功，请稍后再试')
        })
        .finally(() => {
          pending.current.delete(key)
        })
    },
    [ids, isLoggedIn, getToken, navigate, location.pathname, location.search],
  )

  /** 「我的收藏」里取消一条：成功返回 true；失败把心形放回去并返回 false，由页面说明原因。 */
  const unfavorite = useCallback(
    async (type: FavoriteTargetType, id: string): Promise<boolean> => {
      const token = getToken()
      if (!isLoggedIn || !token) return false
      const key = `${type}:${id}`
      if (pending.current.has(key)) return false
      pending.current.add(key)
      const had = ids[type].has(id)
      setIds((prev) => withId(prev, type, id, false))
      try {
        await removeFavorite(token, type, id)
        return true
      } catch {
        if (had) setIds((prev) => withId(prev, type, id, true))
        return false
      } finally {
        pending.current.delete(key)
      }
    },
    [ids, isLoggedIn, getToken],
  )

  const value = useMemo<FavoritesContextValue>(
    () => ({
      isFavorite: (type, id) => ids[type].has(id),
      idsOf: (type) => ids[type],
      toggle,
      unfavorite,
      loading,
      source,
    }),
    [ids, toggle, unfavorite, loading, source],
  )

  return (
    <FavoritesContext.Provider value={value}>
      {children}
      {hint && (
        <div
          role="status"
          className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-neutral-900/90 px-6 py-3 text-[20px] font-medium text-white shadow-lg"
        >
          {hint}
        </div>
      )}
    </FavoritesContext.Provider>
  )
}
