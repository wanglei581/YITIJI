// 我的收藏 — /me/favorites（本人）。收藏只记录本人收藏行为，不含投递 / 预约结果。
// 招聘内容托管（next-tasks 3.13）关闭时只剩政策收藏：不摆岗位、招聘会分类，也不给「去看岗位」的出口。

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { FavoriteTargetType, MemberFavoriteItem } from '@ai-job-print/shared'
import { getAllMyFavorites } from '../../../services/api/memberFavorites'
import { useAuth } from '../../../auth/useAuth'
import { useRecruitmentHosting } from '../../../hooks/useRecruitmentHosting'
import { formatTime } from '../assets/format'
import { QxMePage, recordsCtabar } from './qx/QxMeChrome'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock } from './qx/QxMeStateBits'
import { MeP, MeRows, MeSeg } from '../touch/MeKit'
import { MeEmptyPack, MeExitCard } from '../touch/MeStatePacks'
import './styles/member-records-qx.css'

const TYPE_LABEL: Record<FavoriteTargetType, string> = { job: '岗位', job_fair: '招聘会', policy: '政策' }

type FavoriteTab = FavoriteTargetType | 'all'
const TABS: { key: FavoriteTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'job', label: '岗位' },
  { key: 'job_fair', label: '招聘会' },
  { key: 'policy', label: '政策' },
]
const VALID_FAVORITE_TABS = new Set<FavoriteTab>(TABS.map((tab) => tab.key))

function getFavoriteTab(searchParams: URLSearchParams): FavoriteTab {
  const tab = searchParams.get('tab')
  return tab && VALID_FAVORITE_TABS.has(tab as FavoriteTab) ? (tab as FavoriteTab) : 'all'
}

function detailRoute(item: MemberFavoriteItem): string {
  if (item.targetType === 'job') return `/jobs/${item.targetId}`
  if (item.targetType === 'job_fair') return `/job-fairs/${item.targetId}`
  return `/renshi?policy=${encodeURIComponent(item.targetId)}`
}

type LoadState = 'loading' | 'error' | 'ready'

export function MyFavoritesPage() {
  // loginFrom="/me/favorites"
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoggedIn, getToken } = useAuth()
  const hostingOpen = useRecruitmentHosting().enabled
  const [loaded, setItems] = useState<MemberFavoriteItem[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const requestedTab = getFavoriteTab(searchParams)
  // 托管关闭时只有「全部」与「政策」两种视角，且两者内容相同：不摆分类条，旧链接里的岗位 / 招聘会分类回到全部。
  const tab: FavoriteTab = hostingOpen || requestedTab === 'policy' ? requestedTab : 'all'
  const setTab = (next: FavoriteTab) => {
    setSearchParams(next === 'all' ? {} : { tab: next }, { replace: true })
  }

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

  useEffect(() => { load() }, [load, reloadKey])

  // 服务端在托管关闭时已经不返回岗位与招聘会收藏；这里再挡一次，免得点进一个开不了的详情页。
  const items = useMemo(() => (hostingOpen ? loaded : loaded.filter((i) => i.targetType === 'policy')), [hostingOpen, loaded])
  const visible = useMemo(() => (tab === 'all' ? items : items.filter((i) => i.targetType === tab)), [items, tab])
  const counts = useMemo(() => ({
    all: items.length,
    job: items.filter((i) => i.targetType === 'job').length,
    job_fair: items.filter((i) => i.targetType === 'job_fair').length,
    policy: items.filter((i) => i.targetType === 'policy').length,
  }), [items])

  const uiState = !isLoggedIn ? 'login' : state === 'loading' ? 'loading' : state === 'error' ? 'error' : items.length === 0 ? 'empty' : 'ready'

  let body: ReactNode
  if (!isLoggedIn) {
    body = <QxMeLoginBlock title="登录后查看我的收藏" />
  } else if (state === 'loading') {
    body = <QxMeLoadingBlock title="正在加载我的收藏" />
  } else if (state === 'error') {
    body = <QxMeErrorBlock onRetry={() => setReloadKey((k) => k + 1)} />
  } else if (items.length === 0) {
    body = (
      <div className="me-state" data-testid="qx-me-fallback">
        <MeEmptyPack sentence="还没有收藏。收藏只是方便下次再找，不含投递结果。">
          {hostingOpen ? (
            <>
              <MeExitCard art="checklist" artWidth={160} tall title="查看岗位" desc="来源、更新时间与外部投递入口都在详情页" onClick={() => navigate('/jobs')} />
              <MeExitCard art="stack" artWidth={140} tall title="查看招聘会" desc="时间、地点与官方预约入口以详情页为准" onClick={() => navigate('/job-fairs')} />
            </>
          ) : (
            <>
              <MeExitCard art="checklist" artWidth={160} tall title="查看政策" desc="看本机构发布的就业政策" onClick={() => navigate('/policy-service')} />
              <MeExitCard art="phone" artWidth={140} tall title="去打印" desc="打印和扫描现在就能办" onClick={() => navigate('/print-scan')} />
            </>
          )}
        </MeEmptyPack>
      </div>
    )
  } else {
    body = (
      <>
        {hostingOpen ? (
          <MeSeg
            label="记录筛选"
            current={tab}
            items={TABS.map((t) => ({ id: t.key, label: `${t.label} ${counts[t.key]}`, testId: `member-records-fav-tab-${t.key}` }))}
            onPick={(id) => setTab(id as FavoriteTab)}
          />
        ) : null}
        {visible.length === 0 ? (
          <MeP>当前分类下没有收藏。</MeP>
        ) : (
          <MeRows few={visible.length < 7} testId="member-records-list" label="我的收藏">
            {visible.map((item) => (
              <button key={item.id} type="button" className="me-line" data-favorite-type={item.targetType} data-testid={`member-records-fav-${item.id}`} onClick={() => navigate(detailRoute(item))}>
                <b>{item.title ?? '未命名收藏'}</b>
                <small>{TYPE_LABEL[item.targetType]} · 收藏于 {formatTime(item.createdAt)}</small>
              </button>
            ))}
          </MeRows>
        )}
        {visible.length > 0 && visible.length < 7 ? (
          <div className="me-stack">
            <MeExitCard art="checklist" artWidth={110} title={hostingOpen ? '查看岗位' : '查看政策'} desc={hostingOpen ? '看看第三方来源的岗位' : '看本机构发布的就业政策'} onClick={() => navigate(hostingOpen ? '/jobs' : '/policy-service')} />
            <MeExitCard art="usb" artWidth={110} title="去打印" desc="打印和扫描现在就能办" onClick={() => navigate('/print-scan')} />
          </div>
        ) : null}
      </>
    )
  }

  return (
    <QxMePage
      title={items.length > 0 ? `你收藏的 ${tab === 'all' ? items.length : visible.length} 条${tab === 'policy' || !hostingOpen ? '政策' : ''}` : '还没有收藏'}
      view="favorites"
      screen="member-list"
      screenState={`favorites-${uiState}`}
      eyebrow="我的 · 收藏"
      sub={hostingOpen ? '岗位、招聘会、政策的收藏' : '只收藏政策'}
      fine={hostingOpen
        ? '点一条打开详情。投递与预约都在来源平台完成，本机不代收简历，也不记录结果。取消收藏在详情页里。离开 3 分钟没操作会自动退出。'
        : '点一条打开政策。取消收藏在政策页里。本机不代收简历，也不记录办理结果。离开 3 分钟没操作会自动退出。'}
      ctabar={hostingOpen
        ? recordsCtabar(uiState, navigate, () => setReloadKey((k) => k + 1), '/me/favorites', '查看岗位', () => navigate('/jobs'))
        : recordsCtabar(uiState, navigate, () => setReloadKey((k) => k + 1), '/me/favorites', '查看政策', () => navigate('/policy-service'))}
    >
      {body}
    </QxMePage>
  )
}
