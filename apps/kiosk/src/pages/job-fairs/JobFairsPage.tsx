import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import {
  ArrowLeftIcon,
  Building2Icon,
  CalendarIcon,
  ChevronRightIcon,
  InfoIcon,
  MapPinIcon,
  QrCodeIcon,
  RefreshCwIcon,
  SearchIcon,
  SmartphoneIcon,
  StarIcon,
  XIcon,
} from 'lucide-react'
import { getJobFairs, getTerminalId } from '../../services/api'
import { recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { useFavorites } from '../../favorites/useFavorites'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { FairCalendarPopover } from './components/FairCalendarPopover'
import { RegionPicker } from './components/RegionPicker'
import { matchesRegion, type RegionSelection } from '../../lib/regions'
import { ProtoListSteps } from '../jobs-fairs-prototype'

// ─── 状态标签配置 ───────────────────────────────────────────────────────────────
const STATUS_DOT = {
  upcoming: { label: '即将开始' },
  ongoing:  { label: '进行中' },
  ended:    { label: '已结束' },
}

const ALL_STATUS = ['全部', '即将开始', '进行中', '已结束'] as const
const STATUS_FILTER_MAP: Record<string, string> = { 即将开始: 'upcoming', 进行中: 'ongoing', 已结束: 'ended' }

const THEME_LABEL: Record<string, string> = {
  campus: '校园双选会', campus_corp: '校企合作专场', industry: '行业专场', general: '综合招聘会',
}

// ─── 时间格式化 ──────────────────────────────────────────────────────────────────
function pad(n: number) { return String(n).padStart(2, '0') }
function fmtDate(iso: string) { const d = new Date(iso); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function fmtTime(iso: string) { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
function fmtSync(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function dateKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ─── 扫码预约弹层 ─────────────────────────────────────────────────────────────────
function BookingQrOverlay({ fair, onClose }: { fair: ExternalJobFairDTO; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-80 rounded-2xl bg-white p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full p-1 text-neutral-400 hover:bg-neutral-100" aria-label="关闭">
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-base font-semibold text-neutral-800">扫码前往来源平台预约</p>
        <p className="mt-1 line-clamp-1 text-center text-sm text-neutral-500">{fair.name}</p>
        <div className="mt-5 flex justify-center"><SourceUrlQr value={fair.sourceUrl} size={180} /></div>
        <div className="mt-5 space-y-1.5 rounded-lg bg-neutral-50 px-4 py-3 text-xs text-neutral-500">
          <div className="flex justify-between"><span className="text-neutral-400">来源机构</span><span className="font-medium">{fair.sourceName}</span></div>
          <div className="flex justify-between"><span className="text-neutral-400">外部编号</span><span className="font-mono">{fair.externalId}</span></div>
        </div>
        <div className="mt-4 flex items-start gap-2">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
          <p className="text-xs leading-relaxed text-neutral-500">
            请使用手机扫码前往来源平台办理预约，预约由对方平台管理，本系统不参与活动报名流程、不接收简历。
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── CSS accent override for wheat tone ─────────────────────────────────────────
const WHEAT_ACCENT: React.CSSProperties = {
  '--accent': 'var(--wheat)',
  '--accent-deep': 'var(--wheat-deep)',
  '--accent-soft': 'var(--wheat-soft)',
} as React.CSSProperties

// ─── 招聘会行条目（麦金左边框 · 复刻原型 10）────────────────────────────────────────
function FairRow({
  fair,
  favorite,
  onToggleFavorite,
  onBook,
  onDetail,
}: {
  fair: ExternalJobFairDTO
  favorite: boolean
  onToggleFavorite: () => void
  onBook: () => void
  onDetail: () => void
}) {
  const isEnded = fair.status === 'ended'
  const themeLabel = fair.theme ? (THEME_LABEL[fair.theme] ?? '招聘会') : '招聘会'
  const isNew = fair.status === 'upcoming'
  const sc = STATUS_DOT[fair.status]
  const companyCount = fair.hasManagedData ? fair.managedCompanyCount : (fair.boothCount ?? 0)

  return (
    <div
      className={`jf-row align-start${isEnded ? ' past' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onDetail}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onDetail() }}
      aria-label={`查看 ${fair.name} 详情`}
    >
      <div className="jf-row-main">
        <div className="jf-row-title">
          <b>{fair.name}</b>
          <span className="jf-kind">{themeLabel}</span>
          {isNew && <span className="jf-kind teal">NEW</span>}
        </div>
        <div className="jf-row-info">
          <span>
            <CalendarIcon aria-hidden="true" />
            {fmtDate(fair.startTime)} {fmtTime(fair.startTime)}—{fmtTime(fair.endTime)}
          </span>
          <span>
            <MapPinIcon aria-hidden="true" />
            {fair.city ? `${fair.city} · ` : ''}{fair.venue}
          </span>
          {companyCount > 0 && (
            <span>
              <Building2Icon aria-hidden="true" />
              {companyCount} 家企业{fair.jobCount != null ? ` · ${fair.jobCount} 个岗位` : ''}
            </span>
          )}
        </div>
        <div className="jf-row-sub">
          <span className="jf-chip src">来源 · {fair.sourceName}</span>
          <span className="jf-chip">同步 <b>{fmtSync(fair.syncTime)}</b></span>
          <span className="jf-chip">外部ID <b>{fair.externalId}</b></span>
          <span className={`jf-chip${fair.status === 'ongoing' ? ' ok' : fair.status === 'upcoming' ? ' warn' : ''}`}>
            {sc.label}
          </span>
        </div>
      </div>
      {!isEnded && (
        <div className="jf-fair-aside" onClick={(e) => e.stopPropagation()} role="presentation">
          <button
            type="button"
            className={`jf-fav${favorite ? ' on' : ''}`}
            aria-label={favorite ? '取消收藏' : '收藏招聘会'}
            aria-pressed={favorite}
            onClick={(e) => { e.stopPropagation(); onToggleFavorite() }}
          >
            <StarIcon aria-hidden="true" />
          </button>
          <button
            type="button"
            className="jf-btn sm ghost jf-qr-go"
            onClick={(e) => { e.stopPropagation(); onBook() }}
          >
            <QrCodeIcon aria-hidden="true" />
            扫码预约
          </button>
        </div>
      )}
      <ChevronRightIcon className="jf-arrow" aria-hidden="true" />
    </div>
  )
}

// ─── 主页面 ──────────────────────────────────────────────────────────────────────
export function JobFairsPage() {
  const navigate = useNavigate()
  const [query,        setQuery]        = useState('')
  const [region,       setRegion]       = useState<RegionSelection>({})
  const [statusFilter, setStatusFilter] = useState('全部')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [fairs,        setFairs]        = useState<ExternalJobFairDTO[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(false)
  const [retryKey,     setRetryKey]     = useState(0)
  const [qrFair,       setQrFair]       = useState<ExternalJobFairDTO | null>(null)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const { getToken } = useAuth()
  const { idsOf, toggle: toggleFavorite } = useFavorites()
  const favoriteSet = idsOf('job_fair')

  const openBookingQr = (fair: ExternalJobFairDTO) => {
    recordExternalJump(getToken(), 'job_fair', fair.id, 'external_appointment')
    setQrFair(fair)
  }

  useEffect(() => {
    let cancelled = false
    const terminalId = getTerminalId()
    setLoading(true); setError(false)
    getJobFairs(terminalId ? { terminalId } : undefined)
      .then((res) => { if (!cancelled) { setFairs(res.data); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [retryKey])

  const visible = useMemo(() => {
    const statusVal = statusFilter === '全部' ? null : STATUS_FILTER_MAP[statusFilter]
    const q = query.trim()
    return fairs.filter((f) => {
      if (favoritesOnly && !favoriteSet.has(f.id)) return false
      if (statusVal && f.status !== statusVal) return false
      if (!matchesRegion(f, region)) return false
      if (selectedDate && dateKey(f.startTime) !== selectedDate) return false
      if (q && !`${f.name}${f.organizer}${f.venue}${f.city ?? ''}`.includes(q)) return false
      return true
    })
  }, [fairs, statusFilter, region, selectedDate, query, favoritesOnly, favoriteSet])

  // 即将开始/进行中计数，用于 count line 展示
  const upcomingCount = useMemo(() => visible.filter(f => f.status === 'upcoming').length, [visible])
  const ongoingCount  = useMemo(() => visible.filter(f => f.status === 'ongoing').length, [visible])

  return (
    <div className="flex h-full flex-col bg-canvas" style={WHEAT_ACCENT}>
      {qrFair && <BookingQrOverlay fair={qrFair} onClose={() => setQrFair(null)} />}

      {/* 页头 */}
      <div className="jf-pagehead">
        <button type="button" className="jf-back" onClick={() => navigate('/')}>
          <ArrowLeftIcon aria-hidden="true" />
          返回
        </button>
        <div className="jf-titlebox flex-1">
          <h1>招聘会</h1>
          <p>来源：第三方平台 · 官方机构，预约请前往来源平台</p>
        </div>
        <div className="jf-pagehead-aside">
          <span className="jf-badge">
            <RefreshCwIcon aria-hidden="true" />
            每日同步更新
          </span>
        </div>
      </div>

      {/* 搜索 + 地区筛选 + 日期 */}
      <div className="jf-toolrow px-12">
        <div className="jf-searchbox flex-1">
          <SearchIcon aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索招聘会、企业、地点"
            aria-label="搜索招聘会"
          />
        </div>
        <RegionPicker value={region} onChange={setRegion} />
        <FairCalendarPopover fairs={fairs} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      </div>

      {/* 状态筛选 + 只看收藏 */}
      <div className="jf-filter-bar px-12 pt-2">
        {ALL_STATUS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`jf-f-chip${statusFilter === s ? ' on' : ''}`}
          >
            {s}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setFavoritesOnly((v) => !v)}
          aria-pressed={favoritesOnly}
          className={`jf-f-chip${favoritesOnly ? ' on' : ''}`}
        >
          <StarIcon aria-hidden="true" />
          只看收藏{favoriteSet.size > 0 && ` · ${favoriteSet.size}`}
        </button>
      </div>

      {/* 步骤条 */}
      <div className="px-12 pt-3">
        <ProtoListSteps />
      </div>

      {/* 列表内容 */}
      <div className="mt-3 flex flex-1 flex-col overflow-y-auto px-12 pb-6">
        {loading ? (
          <LoadingState className="flex-1" />
        ) : error ? (
          <ErrorState message="加载失败，请稍后重试" onRetry={() => setRetryKey((k) => k + 1)} className="flex-1" />
        ) : (
          <>
            <div className="jf-count-line mb-3">
              共 <b>{visible.length}</b> 场招聘会
              {upcomingCount > 0 && <span> · 即将开始 {upcomingCount} 场</span>}
              {ongoingCount  > 0 && <span> · 进行中 {ongoingCount} 场</span>}
            </div>
            {visible.length === 0 ? (
              <EmptyState
                icon={favoritesOnly ? StarIcon : CalendarIcon}
                title={favoritesOnly ? '还没有收藏的招聘会' : '没有符合条件的招聘会'}
                description={favoritesOnly ? '在招聘会列表上点击星标即可收藏' : '请调整搜索、地区、状态或日期筛选'}
                className="flex-1"
              />
            ) : (
              <div className="jf-list">
                {visible.map((fair) => (
                  <FairRow
                    key={fair.id}
                    fair={fair}
                    favorite={favoriteSet.has(fair.id)}
                    onToggleFavorite={() => toggleFavorite({ type: 'job_fair', id: fair.id, title: fair.name })}
                    onBook={() => openBookingQr(fair)}
                    onDetail={() => navigate(`/job-fairs/${fair.id}`, { state: { fair } })}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 合规底注 */}
      <div className="jf-notice mx-12 mb-4">
        <InfoIcon aria-hidden="true" />
        <span>本系统仅展示第三方来源招聘会信息，不参与报名流程，预约请前往来源平台。</span>
      </div>
    </div>
  )
}
