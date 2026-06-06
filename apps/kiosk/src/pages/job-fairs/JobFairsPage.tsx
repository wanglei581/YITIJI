import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import { Building2Icon, CalendarIcon, ChevronRightIcon, GraduationCapIcon, MapPinIcon, UsersIcon } from 'lucide-react'
import { getJobFairs } from '../../services/api'

const STATUS_CONFIG = {
  upcoming: { label: '未开始', bg: 'bg-blue-50',  text: 'text-blue-600' },
  ongoing:  { label: '进行中', bg: 'bg-green-50', text: 'text-green-700' },
  ended:    { label: '已结束', bg: 'bg-gray-100', text: 'text-gray-400' },
}

const ALL_STATUS = ['全部', '未开始', '进行中', '已结束'] as const
const STATUS_FILTER_MAP: Record<string, string> = { 未开始: 'upcoming', 进行中: 'ongoing', 已结束: 'ended' }

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatSync(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日 同步`
}

export function JobFairsPage() {
  const navigate = useNavigate()
  const [activeFilter, setActiveFilter] = useState('全部')
  const [fairs,        setFairs]        = useState<ExternalJobFairDTO[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(false)
  const [retryKey,     setRetryKey]     = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    const statusParam = activeFilter === '全部' ? undefined : STATUS_FILTER_MAP[activeFilter]
    getJobFairs({ status: statusParam })
      .then((res) => { if (!cancelled) { setFairs(res.data); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [activeFilter, retryKey])

  return (
    <div className="flex h-full flex-col">
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

        {/* 校园招聘专区入口（设计 §三：招聘会页顶部引导卡 → /campus） */}
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

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {ALL_STATUS.map((s) => (
            <button
              key={s}
              onClick={() => setActiveFilter(s)}
              className={[
                'flex min-h-[48px] shrink-0 items-center rounded-full px-4 text-sm font-medium transition-colors',
                activeFilter === s
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
              ].join(' ')}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col overflow-y-auto px-6 pb-6">
        {loading ? (
          <LoadingState className="flex-1" />
        ) : error ? (
          <ErrorState
            message="加载失败，请稍后重试"
            onRetry={() => setRetryKey((k) => k + 1)}
            className="flex-1"
          />
        ) : fairs.length === 0 ? (
          <EmptyState
            icon={CalendarIcon}
            title="该状态暂无招聘会"
            description="请尝试切换其他状态筛选"
            className="flex-1"
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {fairs.map((fair) => {
              const sc = STATUS_CONFIG[fair.status]
              return (
                <Card key={fair.id} className={`p-5 ${fair.status === 'ended' ? 'opacity-70' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex-1 text-base font-semibold text-gray-900">{fair.name}</p>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${sc.bg} ${sc.text}`}>
                      {sc.label}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1.5 text-sm text-gray-600">
                    <div className="flex items-start gap-1.5">
                      <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                      <span>{formatDate(fair.startTime)}–{formatDate(fair.endTime)}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <MapPinIcon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1 line-clamp-1">{fair.venue}</span>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <Building2Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                      <span className="min-w-0 flex-1 line-clamp-1">主办：{fair.organizer}</span>
                    </div>
                    {/* 企业数用真实字段：已录入数字化数据则展示 managedCompanyCount/资料数，
                        否则展示 boothCount。岗位数(jobCount)与届别(audienceType)DTO 暂无，
                        留 P1 加字段后再补，本轮不硬造 mock。 */}
                    {fair.hasManagedData ? (
                      <div className="flex items-center gap-1.5">
                        <UsersIcon className="h-4 w-4 shrink-0 text-gray-400" />
                        <span>已录入 {fair.managedCompanyCount} 家企业 · {fair.managedMaterialCount} 份资料</span>
                      </div>
                    ) : fair.boothCount ? (
                      <div className="flex items-center gap-1.5">
                        <UsersIcon className="h-4 w-4 shrink-0 text-gray-400" />
                        <span>{fair.boothCount} 家单位参展</span>
                      </div>
                    ) : null}
                  </div>
                  {fair.dataSourceNote && (
                    <p className="mt-2 line-clamp-1 text-xs text-gray-400">{fair.dataSourceNote}</p>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs text-gray-400">
                      {fair.sourceName} · {formatSync(fair.syncTime)}
                    </span>
                    <Button
                      size="sm"
                      variant={fair.status === 'ended' ? 'secondary' : 'primary'}
                      onClick={() => navigate(`/job-fairs/${fair.id}`, { state: { fair } })}
                    >
                      查看招聘会
                    </Button>
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
