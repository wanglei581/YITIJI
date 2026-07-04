// ============================================================
// 我的收藏 — /me/favorites（本人）。按类型（岗位 / 招聘会 / 政策）分 Tab，
// 点击跳转对应来源详情。收藏只记录本人收藏行为，不含投递 / 预约结果。
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, EmptyState } from '@ai-job-print/ui'
import type { FavoriteTargetType, MemberFavoriteItem } from '@ai-job-print/shared'
import { ChevronRightIcon, HeartIcon } from 'lucide-react'
import { getAllMyFavorites } from '../../../services/api/memberFavorites'
import { useAuth } from '../../../auth/useAuth'
import { KIcon, type KioskIconName } from '../../../components/kiosk-icon'
import { useInkRipple } from '../../../hooks/useInkRipple'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'
import './me-detail-inkpaper.css'

const TYPE_META: Record<FavoriteTargetType, { label: string; icon: KioskIconName; tone: string }> = {
  job: { label: '岗位', icon: 'briefcase', tone: 'teal' },
  job_fair: { label: '招聘会', icon: 'fair', tone: 'wheat' },
  policy: { label: '政策', icon: 'policy', tone: 'slate' },
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
  useInkRipple('.me-inkdetail .me-ripple')

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
  const counts = useMemo(() => ({
    all: items.length,
    job: items.filter((i) => i.targetType === 'job').length,
    job_fair: items.filter((i) => i.targetType === 'job_fair').length,
    policy: items.filter((i) => i.targetType === 'policy').length,
  }), [items])

  return (
    <div className="me-inkdetail me-inkdetail-favorites h-full">
      <MeListShell
        title="我的收藏"
        subtitle="本人收藏的岗位 / 招聘会 / 政策（仅本人可见）"
        loginFrom="/me/favorites"
        isLoggedIn={isLoggedIn}
        state={state}
        onRetry={() => setReloadKey((k) => k + 1)}
      >
        <section className="me-detail-summary" aria-label="收藏概览">
          <span className="me-summary-icon me-tone-rose" aria-hidden="true">
            <KIcon name="heart" />
          </span>
          <div className="min-w-0 flex-1">
            <p>收藏夹</p>
            <strong>{counts.all}</strong>
            <span>只记录本人浏览兴趣，不含投递或预约结果</span>
          </div>
          <div className="me-summary-mini" aria-label="收藏分类数量">
            <span>岗位 {counts.job}</span>
            <span>招聘会 {counts.job_fair}</span>
            <span>政策 {counts.policy}</span>
          </div>
        </section>

        {/* Tab 切换 */}
        <div className="me-tabbar">
          {TABS.map((t) => {
            const count = counts[t.key]
            const active = tab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={['me-tab me-ripple', active ? 'is-active' : ''].join(' ')}
                aria-pressed={active}
              >
                {t.label}
                <span>{count}</span>
              </button>
            )
          })}
        </div>

        {visible.length === 0 ? (
          <Card className="me-empty-card">
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
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(detailRoute(item))}
                className="me-detail-row me-ripple"
              >
                <span className={['me-row-icon', `me-tone-${meta.tone}`].join(' ')}>
                  <KIcon name={meta.icon} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="me-row-title">{item.title ?? '未命名收藏'}</span>
                  <span className="me-row-meta">{meta.label} · 收藏于 {formatTime(item.createdAt)}</span>
                </span>
                <ChevronRightIcon className="me-row-arrow" aria-hidden="true" />
              </button>
            )
          })
        )}
      </MeListShell>
    </div>
  )
}
