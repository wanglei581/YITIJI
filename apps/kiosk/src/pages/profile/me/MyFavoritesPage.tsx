// 我的收藏 — /me/favorites（本人）。收藏只记录本人收藏行为，不含投递 / 预约结果。

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { FavoriteTargetType, MemberFavoriteItem } from '@ai-job-print/shared'
import {
  BriefcaseIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  FileTextIcon,
  HeartIcon,
  SparklesIcon,
} from 'lucide-react'
import { getAllMyFavorites } from '../../../services/api/memberFavorites'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { QxMeGuide, QxMePage, QxMeSummary, recordsCtabar } from './qx/QxMeChrome'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock, QxMeStartRow, QxMeStructRow } from './qx/QxMeStateBits'
import './styles/member-records-qx.css'

const TYPE_META: Record<FavoriteTargetType, { label: string; icon: typeof BriefcaseIcon; tone?: 'wheat' | 'slate' }> = {
  job: { label: '岗位', icon: BriefcaseIcon },
  job_fair: { label: '招聘会', icon: CalendarDaysIcon, tone: 'wheat' },
  policy: { label: '政策', icon: FileTextIcon, tone: 'slate' },
}

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
  return '/renshi?tab=policy'
}

type LoadState = 'loading' | 'error' | 'ready'

export function MyFavoritesPage() {
  // loginFrom="/me/favorites"
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberFavoriteItem[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const tab = getFavoriteTab(searchParams)
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

  const visible = useMemo(() => (tab === 'all' ? items : items.filter((i) => i.targetType === tab)), [items, tab])
  const counts = useMemo(() => ({
    all: items.length,
    job: items.filter((i) => i.targetType === 'job').length,
    job_fair: items.filter((i) => i.targetType === 'job_fair').length,
    policy: items.filter((i) => i.targetType === 'policy').length,
  }), [items])

  const uiState = !isLoggedIn ? 'login' : state === 'loading' ? 'loading' : state === 'error' ? 'error' : items.length === 0 ? 'empty' : 'ready'
  const struct = (
    <>
      <QxMeStructRow icon={BriefcaseIcon} title="岗位收藏" desc="回到岗位详情，按来源平台规则投递" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-favorites-0" />
      <QxMeStructRow icon={CalendarDaysIcon} title="招聘会收藏" desc="回到活动详情，预约以来源平台为准" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-favorites-1" />
      <QxMeStructRow icon={FileTextIcon} title="政策收藏" desc="对应政策页待建设，收藏仍会保留" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-favorites-2" />
    </>
  )

  let body: ReactNode
  if (!isLoggedIn) {
    body = <QxMeLoginBlock title="登录后查看我的收藏" desc="收藏只在登录后与账号绑定；公共一体机不保存游客的收藏。" struct={struct} onJobs={() => navigate('/jobs')} onPrint={() => navigate('/print-scan')} />
  } else if (state === 'loading') {
    body = <QxMeLoadingBlock title="正在加载我的收藏" />
  } else if (state === 'error') {
    body = <QxMeErrorBlock title="收藏这次没有加载出来" desc="当前列表没有更新。请检查网络后重试；已有收藏不会因为这次失败而消失。" struct={struct} />
  } else if (items.length === 0) {
    body = (
      <>
        <section className="qx-me-banner" data-testid="qx-me-fallback" data-kind="empty">
          <span className="qx-me-banner-ico" aria-hidden="true"><HeartIcon size={34} /></span>
          <span className="qx-me-banner-main">
            <h2 className="qx-me-banner-t">还没有收藏</h2>
            <span className="qx-me-banner-p">在岗位 / 招聘会 / 政策详情页点收藏之后，才会出现在这里。<b>空就是空</b>。</span>
          </span>
          <span className="qx-me-banner-mini"><i>共 0</i></span>
        </section>
        <QxMeSummary tone="plum" icon={<HeartIcon size={32} />} label="收藏夹" big={0} desc="只记录本人浏览兴趣，不含投递或预约结果" minis={['岗位 0', '招聘会 0', '政策 0']} />
        <section className="qx-me-list qx-me-grow" aria-label="从这里开始">
          <QxMeStartRow icon={BriefcaseIcon} title="看看第三方岗位" desc="来源、更新时间与外部投递入口都在详情页" label="查看岗位" route="/jobs" testid="member-records-start-jobs" onClick={() => navigate('/jobs')} />
          <QxMeStartRow icon={CalendarDaysIcon} tone="wheat" title="看看招聘会" desc="时间、地点与官方预约入口以详情页为准" label="查看招聘会" route="/job-fairs" testid="member-records-start-fairs" onClick={() => navigate('/job-fairs')} />
          <QxMeStartRow icon={SparklesIcon} tone="plum" title="先把简历准备好" desc="诊断或生成之后再去收藏岗位会更有针对性" label="去简历服务" route="/resume-service" testid="member-records-start-resume" onClick={() => navigate('/resume-service')} />
          <div className="qx-me-legal">在岗位 / 招聘会 / 政策详情页点收藏，这里会显示你的收藏。<b>空就是空</b>。</div>
        </section>
        <QxMeGuide items={[['怎么产生', '在详情页点收藏', '岗位 / 招聘会 / 政策都可以收藏'], ['这里显示什么', '只有收藏行为', '不含投递或预约结果'], ['去哪儿办', '来源平台', '投递与预约都在来源平台完成']]} />
      </>
    )
  } else {
    body = (
      <>
        <QxMeSummary
          tone="plum"
          icon={<HeartIcon size={32} />}
          label="收藏夹"
          big={counts.all}
          desc="只记录本人浏览兴趣，不含投递或预约结果"
          minis={[`岗位 ${counts.job}`, `招聘会 ${counts.job_fair}`, `政策 ${counts.policy}`]}
        />
        <div className="qx-me-tabbar" data-n="4" role="group" aria-label="记录筛选">
          {TABS.map((t) => (
            <button key={t.key} type="button" className="qx-me-tab" aria-current={tab === t.key ? 'true' : undefined} data-testid={`member-records-fav-tab-${t.key}`} onClick={() => setTab(t.key)}>
              {t.label}<i>{counts[t.key]}</i>
            </button>
          ))}
        </div>
        <section className="qx-me-list qx-me-grow" data-testid="member-records-list" aria-label="我的收藏">
          {visible.length === 0 ? (
            <div className="qx-me-legal">当前分类下没有收藏。</div>
          ) : visible.map((item) => {
            const meta = TYPE_META[item.targetType]
            const Icon = meta.icon
            return (
              <button key={item.id} type="button" className="qx-me-row" data-favorite-type={item.targetType} data-testid={`member-records-fav-${item.id}`} onClick={() => navigate(detailRoute(item))}>
                <span className="qx-me-row-ico" data-tone={meta.tone} aria-hidden="true"><Icon size={28} /></span>
                <span className="qx-me-row-main">
                  <span className="qx-me-row-title">{item.title ?? '未命名收藏'}</span>
                  <span className="qx-me-row-sub">{meta.label} · 收藏于 {formatTime(item.createdAt)}</span>
                </span>
                <span className="qx-me-row-go" aria-hidden="true"><ChevronRightIcon size={22} /></span>
              </button>
            )
          })}
          <div className="qx-me-fav-next" aria-label="收藏使用说明">
            <div><b>岗位收藏</b><span>打开岗位详情后，按来源平台的规则完成投递。</span></div>
            <div><b>招聘会收藏</b><span>查看活动详情；预约和签到以来源平台或现场规则为准。</span></div>
            <div><b>政策收藏</b><span>对应政策页待建设，当前保留收藏，不提供误导性的替代跳转。</span></div>
          </div>
          <div className="qx-me-legal">收藏只记录本人收藏行为；<b>投递与预约都在来源平台完成</b>，本机不代收简历，也不记录结果。</div>
        </section>
      </>
    )
  }

  return (
    <QxMePage
      title={tab === 'policy' ? '政策收藏' : '我的收藏'}
      view="favorites"
      screen="member-list"
      screenState={`favorites-${uiState}`}
      eyebrow="MY FAVORITES"
      ask={<>收藏的岗位与招聘会，<em>随时找回</em>。</>}
      doing={<>只记录<b>本人收藏行为</b>，不含投递或预约结果。</>}
      truth="投递与预约都在来源平台完成；本机不代收简历，也不记录结果。"
      ctabar={recordsCtabar(uiState, navigate, () => setReloadKey((k) => k + 1), '/me/favorites', '查看岗位', () => navigate('/jobs'))}
    >
      {body}
    </QxMePage>
  )
}
