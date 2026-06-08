import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import {
  Building2Icon,
  CalendarIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
  MapPinIcon,
  QrCodeIcon,
  SmartphoneIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
import { getJobFairs } from '../../services/api'
import { SourceUrlQr } from '../../components/SourceUrlQr'
import { FairCalendarPopover } from './components/FairCalendarPopover'

const STATUS_CONFIG = {
  upcoming: { label: '未开始', bg: 'bg-blue-50',  text: 'text-blue-600',  bar: 'bg-blue-400' },
  ongoing:  { label: '进行中', bg: 'bg-green-50', text: 'text-green-700', bar: 'bg-green-400' },
  ended:    { label: '已结束', bg: 'bg-gray-100', text: 'text-gray-400',  bar: 'bg-gray-300' },
}

const ALL_STATUS = ['全部', '未开始', '进行中', '已结束'] as const
const STATUS_FILTER_MAP: Record<string, string> = { 未开始: 'upcoming', 进行中: 'ongoing', 已结束: 'ended' }

function pad(n: number) {
  return String(n).padStart(2, '0')
}
function dateKey(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function formatSync(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 同步`
}

// ─── 扫码预约二维码弹层（真实二维码，承载来源平台链接）────────────────────────────

function BookingQrOverlay({ fair, onClose }: { fair: ExternalJobFairDTO; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-80 rounded-2xl bg-white p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-gray-400 hover:bg-gray-100"
          aria-label="关闭"
        >
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-base font-semibold text-gray-800">扫码前往来源平台预约</p>
        <p className="mt-1 line-clamp-1 text-center text-sm text-gray-500">{fair.name}</p>
        <div className="mt-5 flex justify-center">
          <SourceUrlQr value={fair.sourceUrl} size={180} />
        </div>
        <div className="mt-5 space-y-1.5 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-500">
          <div className="flex justify-between">
            <span className="text-gray-400">来源机构</span>
            <span className="font-medium">{fair.sourceName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">外部编号</span>
            <span className="font-mono">{fair.externalId}</span>
          </div>
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

// ─── 页面 ───────────────────────────────────────────────────────────────────────

export function JobFairsPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState('全部')
  const [cityFilter,   setCityFilter]   = useState('全部')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [fairs,        setFairs]        = useState<ExternalJobFairDTO[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(false)
  const [retryKey,     setRetryKey]     = useState(0)
  const [qrFair,       setQrFair]       = useState<ExternalJobFairDTO | null>(null)

  // 一次拉全量（已审核已发布），状态/城市/日期均客户端过滤，便于日历标记与城市标签联动
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getJobFairs()
      .then((res) => { if (!cancelled) { setFairs(res.data); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [retryKey])

  const cities = useMemo(() => {
    const set: string[] = []
    for (const f of fairs) if (f.city && !set.includes(f.city)) set.push(f.city)
    return set
  }, [fairs])

  const visible = useMemo(() => {
    const statusVal = statusFilter === '全部' ? null : STATUS_FILTER_MAP[statusFilter]
    return fairs.filter((f) => {
      if (statusVal && f.status !== statusVal) return false
      if (cityFilter !== '全部' && f.city !== cityFilter) return false
      if (selectedDate && dateKey(f.startTime) !== selectedDate) return false
      return true
    })
  }, [fairs, statusFilter, cityFilter, selectedDate])

  return (
    <div className="flex h-full flex-col">
      {qrFair && <BookingQrOverlay fair={qrFair} onClose={() => setQrFair(null)} />}

      <div className="px-6 pt-6">
        <PageHeader
          title="招聘会"
          subtitle="来源：第三方平台 · 官方机构"
          actions={
            <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
              返回首页
            </Button>
          }
        />
        <p className="mt-3 text-xs text-gray-400">
          本系统仅展示第三方来源招聘会信息，不参与活动报名流程，请前往来源平台预约
        </p>

        {/* 校园招聘专区入口 */}
        <button
          type="button"
          onClick={() => navigate('/campus')}
          className="mt-4 flex w-full items-center justify-between gap-3 rounded-xl border border-cyan-200 bg-cyan-50/50 px-5 py-4 text-left transition-colors hover:bg-cyan-50 active:bg-cyan-100"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-cyan-100">
              <GraduationCapIcon className="h-6 w-6 text-cyan-700" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-gray-900">校园招聘专区</h2>
              <p className="mt-0.5 text-sm text-gray-500">应届校招 · 校园双选会 · 求职材料打印</p>
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-0.5 text-sm font-semibold text-primary-600">
            进入专区
            <ChevronRightIcon className="h-5 w-5" aria-hidden="true" />
          </span>
        </button>

        {/* 城市标签 + 日历按钮 */}
        <div className="mt-4 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            {['全部', ...cities].map((c) => (
              <button
                key={c}
                onClick={() => setCityFilter(c)}
                className={[
                  'flex min-h-[48px] shrink-0 items-center rounded-full px-4 text-sm font-medium transition-colors',
                  cityFilter === c
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                ].join(' ')}
              >
                {c}
              </button>
            ))}
          </div>
          <FairCalendarPopover
            fairs={fairs}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
        </div>

        {/* 状态标签 */}
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {ALL_STATUS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={[
                'flex min-h-[44px] shrink-0 items-center rounded-full px-4 text-sm font-medium transition-colors',
                statusFilter === s
                  ? 'bg-primary-50 text-primary-700 ring-1 ring-primary-200'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
              ].join(' ')}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-1 flex-col overflow-y-auto px-6 pb-6">
        {loading ? (
          <LoadingState className="flex-1" />
        ) : error ? (
          <ErrorState message="加载失败，请稍后重试" onRetry={() => setRetryKey((k) => k + 1)} className="flex-1" />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={CalendarIcon}
            title="没有符合条件的招聘会"
            description="请尝试切换城市、状态或清除日期筛选"
            className="flex-1"
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {visible.map((fair) => {
              const sc      = STATUS_CONFIG[fair.status]
              const isEnded = fair.status === 'ended'
              const companyLabel = fair.hasManagedData
                ? `已录入 ${fair.managedCompanyCount} 家企业`
                : fair.boothCount
                  ? `${fair.boothCount} 家单位参展`
                  : null
              return (
                <Card key={fair.id} className={`overflow-hidden p-0 ${isEnded ? 'opacity-80' : ''}`}>
                  {/* 状态色细条（克制视觉，替代整块渐变） */}
                  <div className={`h-1 w-full ${sc.bar}`} />
                  <div className="p-5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                        {fair.sourceName}
                      </span>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${sc.bg} ${sc.text}`}>
                        {sc.label}
                      </span>
                    </div>
                    <p className="mt-2 text-base font-semibold text-gray-900">{fair.name}</p>
                    <div className="mt-2 space-y-1.5 text-sm text-gray-600">
                      <div className="flex items-start gap-1.5">
                        <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                        <span>{formatDate(fair.startTime)}–{formatDate(fair.endTime)}</span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                        <span className="min-w-0 flex-1 line-clamp-1">
                          {fair.city ? `${fair.city} · ` : ''}{fair.venue}
                        </span>
                      </div>
                      <div className="flex items-start gap-1.5">
                        <Building2Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                        <span className="min-w-0 flex-1 line-clamp-1">主办：{fair.organizer}</span>
                      </div>
                      {companyLabel && (
                        <div className="flex items-center gap-1.5">
                          <UsersIcon className="h-4 w-4 shrink-0 text-gray-400" />
                          <span>{companyLabel}</span>
                        </div>
                      )}
                    </div>
                    <p className="mt-2 text-xs text-gray-400">{formatSync(fair.syncTime)}</p>

                    <div className="mt-3 flex gap-2">
                      {!isEnded && (
                        <Button
                          size="md"
                          className="flex flex-1 items-center justify-center gap-1.5"
                          onClick={() => setQrFair(fair)}
                        >
                          <QrCodeIcon className="h-4 w-4" />
                          扫码预约
                        </Button>
                      )}
                      <Button
                        size="md"
                        variant="secondary"
                        className={`flex items-center justify-center gap-1.5 ${isEnded ? 'flex-1' : ''}`}
                        onClick={() => navigate(`/job-fairs/${fair.id}`, { state: { fair } })}
                      >
                        查看详情
                        <ExternalLinkIcon className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
