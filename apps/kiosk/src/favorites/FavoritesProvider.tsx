import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FavoriteTargetType } from '@ai-job-print/shared'
import { useAuth } from '../auth/useAuth'
import { addFavorite, getAllMyFavorites, removeFavorite } from '../services/api/memberFavorites'
import { FavoritesContext, type FavoriteToggleItem, type FavoritesContextValue } from './context'
import {
  readAllLocalFavorites,
  readLocalFavorites,
  removeLocalFavorites,
  toggleLocalFavorite,
} from './localFavorites'

type IdSets = Record<FavoriteTargetType, Set<string>>

function readLocalSets(): IdSets {
  return {
    job: new Set(readLocalFavorites('job')),
    job_fair: new Set(readLocalFavorites('job_fair')),
    policy: new Set(readLocalFavorites('policy')),
  }
}

function emptySets(): IdSets {
  return { job: new Set(), job_fair: new Set(), policy: new Set() }
}

/**
 * 收藏 Provider（Phase C-2C job → C-2D 三类：岗位 / 招聘会 / 政策）。挂在 KioskRoot 布局内。
 *
 * 登录态门控（不破坏匿名浏览）：
 * - 登录会员：以服务端 /me/favorites 为 SSOT；登录后逐页拉全量 id 集合，toggle 走
 *   addFavorite/removeFavorite（乐观更新，失败回滚 + 提示）。
 * - 未登录 / 匿名：沿用本机 localStorage 收藏（历史收藏不丢），toggle 写本机；新增收藏时
 *   提示「登录后可同步到账号」，引导但不强制登录。
 * - 合并：登录后用户在「我的收藏」显式触发 mergeLocalToAccount（服务端 upsert 幂等去重，
 *   不覆盖服务端收藏；成功合并的本机记录清除，失败的保留下次再试）。
 *
 * 合规：收藏只记录浏览 / 收藏行为，绝不记录投递结果 / 候选人数据。
 */
export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { isLoggedIn, getToken } = useAuth()
  const [ids, setIds] = useState<IdSets>(readLocalSets)
  const [loading, setLoading] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  // 本机待合并条数（登录态展示「合并到账号」入口；匿名态无意义记 0）。
  const [localPendingCount, setLocalPendingCount] = useState(0)

  const source: 'local' | 'server' = isLoggedIn ? 'server' : 'local'

  // 登录态切换：登录→拉服务端收藏；登出/匿名→回本机收藏。
  useEffect(() => {
    if (!isLoggedIn) {
      setLoading(false)
      setIds(readLocalSets())
      setLocalPendingCount(0)
      return
    }
    const token = getToken()
    if (!token) {
      setIds(readLocalSets())
      return
    }
    let cancelled = false
    setLoading(true)
    setLocalPendingCount(readAllLocalFavorites().length)
    getAllMyFavorites(token)
      .then((items) => {
        if (cancelled) return
        const next = emptySets()
        for (const f of items) next[f.targetType]?.add(f.targetId)
        setIds(next)
      })
      .catch(() => {
        // 服务端不可达：登录态下不回退到本机（避免把他人/历史本机收藏误当本人资产），保持空集。
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
      const key = `${type}:${id}`
      const has = ids[type].has(id)

      if (isLoggedIn) {
        const token = getToken()
        if (!token) return
        if (pending.current.has(key)) return
        pending.current.add(key)
        // 乐观更新
        setIds((prev) => {
          const next = { ...prev, [type]: new Set(prev[type]) }
          if (has) next[type].delete(id)
          else next[type].add(id)
          return next
        })
        const op = has
          ? removeFavorite(token, type, id)
          : addFavorite(token, { targetType: type, targetId: id, title: item.title })
        op
          .then(() => undefined)
          .catch(() => {
            // 回滚到操作前状态
            setIds((prev) => {
              const next = { ...prev, [type]: new Set(prev[type]) }
              if (has) next[type].add(id)
              else next[type].delete(id)
              return next
            })
            setHint('收藏同步失败，请稍后重试')
          })
          .finally(() => {
            pending.current.delete(key)
          })
        return
      }

      // 匿名 / 未登录：本机收藏，新增时提示可登录同步。
      const next = toggleLocalFavorite(type, id)
      setIds((prev) => ({ ...prev, [type]: new Set(next) }))
      if (!has) setHint('已收藏到本机，登录后可同步到账号')
    },
    [ids, isLoggedIn, getToken],
  )

  /**
   * 显式合并本机收藏到账号（C-2D）：逐条 addFavorite——服务端 (endUserId,type,id) 唯一键
   * upsert 幂等；不传 title → 已存在的服务端收藏标题不被覆盖。成功合并的本机记录清除。
   */
  const mergeLocalToAccount = useCallback(async (): Promise<{ merged: number; failed: number }> => {
    const token = getToken()
    if (!isLoggedIn || !token) return { merged: 0, failed: 0 }
    const locals = readAllLocalFavorites()
    if (locals.length === 0) return { merged: 0, failed: 0 }
    const merged: Array<{ type: FavoriteTargetType; id: string }> = []
    let failed = 0
    for (const item of locals) {
      try {
        await addFavorite(token, { targetType: item.type, targetId: item.id })
        merged.push(item)
      } catch {
        failed += 1
      }
    }
    removeLocalFavorites(merged)
    setLocalPendingCount(readAllLocalFavorites().length)
    if (merged.length > 0) {
      setIds((prev) => {
        const next: IdSets = {
          job: new Set(prev.job),
          job_fair: new Set(prev.job_fair),
          policy: new Set(prev.policy),
        }
        for (const m of merged) next[m.type].add(m.id)
        return next
      })
    }
    return { merged: merged.length, failed }
  }, [isLoggedIn, getToken])

  const value = useMemo<FavoritesContextValue>(
    () => ({
      isFavorite: (type, id) => ids[type].has(id),
      idsOf: (type) => ids[type],
      toggle,
      loading,
      source,
      localPendingCount,
      mergeLocalToAccount,
    }),
    [ids, toggle, loading, source, localPendingCount, mergeLocalToAccount],
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
