import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import {
  Building2Icon,
  CalendarIcon,
  ChevronRightIcon,
  ClockIcon,
  MapIcon,
  MapPinIcon,
  QrCodeIcon,
  SearchIcon,
  SmartphoneIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
import { getJobFairs } from '../../services/api'
import { recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { FairCalendarPopover } from './components/FairCalendarPopover'
import { RegionPicker } from './components/RegionPicker'
import { matchesRegion, type RegionSelection } from '../../lib/regions'

// 来源品牌渐变（按来源名 hash 取色，复刻参考图彩色大卡；class 为字面量，Tailwind 不 purge）
const GRADIENTS = [
  'from-blue-500 to-indigo-600',
  'from-violet-500 to-purple-600',
  'from-orange-400 to-amber-500',
  'from-teal-500 to-cyan-600',
  'from-rose-500 to-pink-600',
  'from-sky-500 to-blue-600',
]
function gradOf(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return GRADIENTS[h % GRADIENTS.length]
}

const STATUS_DOT = {
  upcoming: { label: '即将开始', dot: 'bg-amber-300' },
  ongoing:  { label: '进行中',   dot: 'bg-emerald-300' },
  ended:    { label: '已结束',   dot: 'bg-white/50' },
}

const ALL_STATUS = ['全部', '即将开始', '进行中', '已结束'] as const
const STATUS_FILTER_MAP: Record<string, string> = { 即将开始: 'upcoming', 进行中: 'ongoing', 已结束: 'ended' }

const THEME_LABEL: Record<string, string> = {
  campus: '校园双选会', campus_corp: '校企合作专场', industry: '行业专场', general: '综合招聘会',
}
const THEME_TAGS: Record<string, string[]> = {
  campus: ['应届生', '校招', '多行业'],
  campus_corp: ['校企合作', '产学研', '应届生'],
  industry: ['行业专场', '社招/校招'],
  general: ['社招', '综合', '本地'],
}

function pad(n: number) { return String(n).padStart(2, '0') }
function dateKey(iso: string) { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function fmtDate(iso: string) { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function fmtTime(iso: string) { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

// ─── 扫码预约二维码弹层（真实二维码，承载来源平台链接）────────────────────────────

function BookingQrOverlay({ fair, onClose }: { fair: ExternalJobFairDTO; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-80 rounded-2xl bg-white p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100" aria-label="关闭">
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-base font-semibold text-gray-800">扫码前往来源平台预约</p>
        <p className="mt-1 line-clamp-1 text-center text-sm text-gray-500">{fair.name}</p>
        <div className="mt-5 flex justify-center"><SourceUrlQr value={fair.sourceUrl} size={180} /></div>
        <div className="mt-5 space-y-1.5 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500">
          <div className="flex justify-between"><span className="text-gray-400">来源机构</span><span className="font-medium">{fair.sourceName}</span></div>
          <div className="flex justify-between"><span className="text-gray-400">外部编号</span><span className="font-mono">{fair.externalId}</span></div>
        </div>
        <div className="mt-4 flex items-start gap-2">
          <SmartphoneIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
          <p className="text-xs leading-relaxed text-gray-500">
            请使用手机扫码前往来源平台办理预约，预约由对方平台管理，本系统不参与活动报名流程、不接收简历。
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── 步骤条（复刻参考图：选城市 → 浏览列表 → 表单预约）─────────────────────────────

function Stepper() {
  const steps = ['选地区', '浏览列表', '扫码预约']
  return (
    <div className="flex items-center gap-1 rounded-xl border border-gray-100 bg-white px-4 py-3">
      {steps.map((s, i) => (
        <div key={s} className="flex flex-1 items-center">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-600 text-xs font-semibold text-white">{i + 1}</span>
          <span className="ml-1.5 text-sm font-medium text-gray-700">{s}</span>
          {i < steps.length - 1 && <span className="mx-2 h-px flex-1 bg-gray-200" />}
        </div>
      ))}
    </div>
  )
}

// ─── 彩色渐变招聘会大卡（复刻参考图）─────────────────────────────────────────────

function FairCard({
  fair,
  onBook,
  onDetail,
  onMap,
}: {
  fair: ExternalJobFairDTO
  onBook: () => void
  onDetail: () => void
  onMap: () => void
}) {
  const grad = gradOf(fair.sourceName)
  const sc = STATUS_DOT[fair.status]
  const isEnded = fair.status === 'ended'
  const themeLabel = fair.theme ? THEME_LABEL[fair.theme] ?? '招聘会' : '招聘会'
  const tags = (fair.theme && THEME_TAGS[fair.theme]) || []
  const companyCount = fair.hasManagedData ? fair.managedCompanyCount : fair.boothCount ?? 0

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 shadow-sm">
      {/* 渐变头部 */}
      <div className={`bg-gradient-to-br ${grad} p-5 text-white ${isEnded ? 'opacity-80 saturate-50' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <span className="rounded-md bg-white/20 px-2 py-0.5 text-xs font-medium backdrop-blur-sm">{fair.sourceName}</span>
          {fair.hasManagedData && (
            <button onClick={onMap} className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25">
              <MapIcon className="h-3.5 w-3.5" />场馆导览
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          {fair.status === 'upcoming' && <span className="rounded bg-white/25 px-1.5 py-0.5 text-[11px] font-semibold">NEW</span>}
          <span className="rounded bg-white/20 px-1.5 py-0.5 text-[11px] font-medium">{themeLabel}</span>
        </div>
        <h3 className="mt-2 text-xl font-bold leading-tight">{fair.name}</h3>
        <p className="mt-0.5 line-clamp-1 text-sm text-white/80">主办：{fair.organizer}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/90">
          <span className="flex items-center gap-1"><CalendarIcon className="h-4 w-4" />{fmtDate(fair.startTime)}</span>
          <span className="flex items-center gap-1"><ClockIcon className="h-4 w-4" />{fmtTime(fair.startTime)}—{fmtTime(fair.endTime)}</span>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-white/15 pt-3">
          <span className="flex items-center gap-1.5 text-sm">
            <span className={`h-2 w-2 rounded-full ${sc.dot}`} />{sc.label}
          </span>
          {fair.jobCount != null && <span className="text-sm font-semibold">{fair.jobCount.toLocaleString()} 个岗位</span>}
        </div>
      </div>

      {/* 白底信息区 */}
      <div className="space-y-3 bg-white p-5">
        <div className="flex items-start gap-1.5 text-sm text-gray-700">
          <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
          <span className="min-w-0 flex-1">{fair.city ? `${fair.city} · ` : ''}{fair.venue}</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex -space-x-1.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className={`h-6 w-6 rounded-full border-2 border-white bg-gradient-to-br ${GRADIENTS[i]}`} />
              ))}
            </div>
            <span className="flex items-center gap-1 text-sm text-gray-600">
              <Building2Icon className="h-4 w-4 text-gray-400" />{companyCount} 家企业
            </span>
          </div>
          <div className="flex flex-wrap justify-end gap-1">
            {tags.slice(0, 3).map((t) => (
              <span key={t} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">{t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* 操作区 */}
      <div className="flex gap-2 bg-white px-5 pb-5">
        {!isEnded ? (
          <button
            onClick={onBook}
            className={`flex flex-[2] items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r ${grad} py-3 text-sm font-semibold text-white shadow-sm active:opacity-90`}
          >
            <QrCodeIcon className="h-4 w-4" />扫码预约
          </button>
        ) : (
          <div className="flex flex-[2] items-center justify-center rounded-lg bg-gray-100 py-3 text-sm font-medium text-gray-400">活动已结束</div>
        )}
        <button
          onClick={onDetail}
          className="flex flex-1 items-center justify-center gap-0.5 rounded-lg border border-gray-200 py-3 text-sm font-semibold text-gray-700 active:bg-gray-50"
        >
          详情<ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// ─── 页面 ───────────────────────────────────────────────────────────────────────

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
  const { getToken } = useAuth()

  // 外部跳转记录(P1):只记录「打开来源平台预约入口」;预约结果以来源平台为准,本系统不记录。
  const openBookingQr = (fair: ExternalJobFairDTO) => {
    recordExternalJump(getToken(), 'job_fair', fair.id, 'external_appointment')
    setQrFair(fair)
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(false)
    getJobFairs()
      .then((res) => { if (!cancelled) { setFairs(res.data); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [retryKey])

  const visible = useMemo(() => {
    const statusVal = statusFilter === '全部' ? null : STATUS_FILTER_MAP[statusFilter]
    const q = query.trim()
    return fairs.filter((f) => {
      if (statusVal && f.status !== statusVal) return false
      if (!matchesRegion(f, region)) return false
      if (selectedDate && dateKey(f.startTime) !== selectedDate) return false
      if (q && !`${f.name}${f.organizer}${f.venue}${f.city ?? ''}`.includes(q)) return false
      return true
    })
  }, [fairs, statusFilter, region, selectedDate, query])

  return (
    <div className="flex h-full flex-col">
      {qrFair && <BookingQrOverlay fair={qrFair} onClose={() => setQrFair(null)} />}

      <div className="px-6 pt-6">
        <PageHeader
          title="招聘会"
          subtitle="来源：第三方平台 · 官方机构"
          actions={<Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回首页</Button>}
        />

        {/* 搜索 */}
        <div className="mt-4">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索招聘会、企业、地点"
              className="h-12 w-full rounded-full border border-gray-200 bg-gray-50 pl-9 pr-4 text-sm text-gray-700 placeholder:text-gray-400 focus:border-primary-400 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        {/* 地区筛选（全国省/市/区） + 日历小按钮 */}
        <div className="mt-3 flex items-center gap-2">
          <RegionPicker value={region} onChange={setRegion} />
          <FairCalendarPopover fairs={fairs} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
        </div>

        {/* 状态筛选 */}
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {ALL_STATUS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={[
                'flex min-h-[44px] shrink-0 items-center rounded-full px-4 text-sm font-medium transition-colors',
                statusFilter === s ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
              ].join(' ')}
            >
              {s}
            </button>
          ))}
        </div>

        {/* 步骤条 */}
        <div className="mt-3"><Stepper /></div>
      </div>

      <div className="mt-3 flex flex-1 flex-col overflow-y-auto px-6 pb-6">
        {loading ? (
          <LoadingState className="flex-1" />
        ) : error ? (
          <ErrorState message="加载失败，请稍后重试" onRetry={() => setRetryKey((k) => k + 1)} className="flex-1" />
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-500">
              共 <span className="font-semibold text-primary-600">{visible.length}</span> 场招聘会
            </p>
            {visible.length === 0 ? (
              <EmptyState icon={CalendarIcon} title="没有符合条件的招聘会" description="请调整搜索、地区、状态或日期筛选" className="flex-1" />
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {visible.map((fair) => (
                  <FairCard
                    key={fair.id}
                    fair={fair}
                    onBook={() => openBookingQr(fair)}
                    onDetail={() => navigate(`/job-fairs/${fair.id}`, { state: { fair } })}
                    onMap={() => navigate(`/job-fairs/${fair.id}/map`)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* 合规说明 */}
      <div className="border-t border-gray-100 px-6 py-2">
        <p className="flex items-center gap-1.5 text-xs text-gray-400">
          <UsersIcon className="h-3.5 w-3.5" />
          本系统仅展示第三方来源招聘会信息，不参与报名流程，预约请前往来源平台
        </p>
      </div>
    </div>
  )
}
