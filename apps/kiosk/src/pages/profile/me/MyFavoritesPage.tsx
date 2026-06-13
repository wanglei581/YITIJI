// ============================================================
// 我的收藏 — /me/favorites（本人）。按类型（岗位 / 招聘会 / 政策）分 Tab，
// 点击跳转对应来源详情。收藏只记录本人收藏行为，不含投递 / 预约结果。
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, EmptyState } from '@ai-job-print/ui'
import type { FavoriteTargetType, MemberFavoriteItem } from '@ai-job-print/shared'
import { BriefcaseIcon, CalendarIcon, ChevronRightIcon, HeartIcon, LandmarkIcon, type LucideIcon } from 'lucide-react'
import { getAllMyFavorites } from '../../../services/api/memberFavorites'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'

const TYPE_META: Record<FavoriteTargetType, { label: string; icon: LucideIcon; bg: string; color: string }> = {
  job: { label: '岗位', icon: BriefcaseIcon, bg: 'bg-sky-50', color: 'text-sky-600' },
  job_fair: { label: '招聘会', icon: CalendarIcon, bg: 'bg-green-50', color: 'text-green-600' },
  policy: { label: '政策', icon: LandmarkIcon, bg: 'bg-emerald-50', color: 'text-emerald-600' },
}

const TABS: { key: FavoriteTargetType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'job', label: '岗位' },
  { key: 'job_fair', label: '招聘会' },
  { key: 'policy', label: '政策' },
]

function detailRoute(item: MemberFavoriteItem): string {
  if (item.targetType === 'job') return `/jobs/${item.targetId}`
  if (item.targetType === 'job_fair') return `/job-fairs/${item.targetId}`
  return '/renshi'
}

export function MyFavoritesPage() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberFavoriteItem[]>([])
  const [state, setState] = useState<MeListState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [tab, setTab] = useState<FavoriteTargetType | 'all'>('all')

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setState('ready')
      return
    }
    setState('loading')
    getAllMyFavorites(getToken())
      .then((all) => {
        setItems(all)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [isLoggedIn, getToken])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const visible = useMemo(() => (tab === 'all' ? items : items.filter((i) => i.targetType === tab)), [items, tab])

  return (
    <MeListShell
      title="我的收藏"
      subtitle="本人收藏的岗位 / 招聘会 / 政策（仅本人可见）"
      loginFrom="/me/favorites"
      isLoggedIn={isLoggedIn}
      state={state}
      onRetry={() => setReloadKey((k) => k + 1)}
    >
      {/* Tab 切换 */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => {
          const count = t.key === 'all' ? items.length : items.filter((i) => i.targetType === t.key).length
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={[
                'shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors',
                active ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200',
              ].join(' ')}
            >
              {t.label}
              <span className={active ? 'ml-1 text-white/80' : 'ml-1 text-gray-400'}>{count}</span>
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <Card className="p-4">
          <EmptyState
            icon={HeartIcon}
            title="还没有收藏"
            description="在岗位 / 招聘会 / 政策详情页点收藏，这里会显示你的收藏"
            className="py-12"
          />
        </Card>
      ) : (
        visible.map((item) => {
          const meta = TYPE_META[item.targetType]
          const Icon = meta.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(detailRoute(item))}
              className="flex w-full items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition-colors hover:bg-gray-50 active:bg-gray-100"
            >
              <div className={['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', meta.bg].join(' ')}>
                <Icon className={['h-6 w-6', meta.color].join(' ')} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{item.title ?? '未命名收藏'}</p>
                <p className="mt-0.5 truncate text-xs text-gray-400">{meta.label} · 收藏于 {formatTime(item.createdAt)}</p>
              </div>
              <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-300" aria-hidden="true" />
            </button>
          )
        })
      )}
    </MeListShell>
  )
}
