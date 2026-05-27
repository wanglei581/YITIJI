import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobFairDTO } from '@ai-job-print/shared'
import { CalendarIcon, MapPinIcon, UsersIcon } from 'lucide-react'
import { getJobFairs } from '../../services/api'

const STATUS_CONFIG = {
  upcoming: { label: '未开始', bg: 'bg-blue-50',   text: 'text-blue-600' },
  ongoing:  { label: '进行中', bg: 'bg-green-50',  text: 'text-green-700' },
  ended:    { label: '已结束', bg: 'bg-gray-100',  text: 'text-gray-400' },
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
  const [fairs,   setFairs]   = useState<ExternalJobFairDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    const statusParam = activeFilter === '全部' ? undefined : STATUS_FILTER_MAP[activeFilter]
    getJobFairs({ status: statusParam })
      .then((res) => { if (!cancelled) setFairs(res.data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [activeFilter])

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
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {ALL_STATUS.map((s) => (
            <button
              key={s}
              onClick={() => setActiveFilter(s)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                activeFilter === s
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-1 flex-col gap-3 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-16">
            <p className="text-sm text-gray-400">加载中...</p>
          </div>
        ) : error ? (
          <div className="flex flex-1 flex-col items-center justify-center py-16 gap-3">
            <CalendarIcon className="h-12 w-12 text-gray-200" />
            <p className="text-sm text-gray-400">加载失败，请稍后重试</p>
            <Button size="sm" variant="secondary" onClick={() => setActiveFilter(activeFilter)}>重试</Button>
          </div>
        ) : fairs.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-16">
            <CalendarIcon className="h-12 w-12 text-gray-200" />
            <p className="mt-4 text-sm text-gray-400">该状态暂无招聘会</p>
          </div>
        ) : (
          fairs.map((fair) => {
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
                    <span>{fair.venue}</span>
                  </div>
                  {fair.boothCount && (
                    <div className="flex items-center gap-1.5">
                      <UsersIcon className="h-4 w-4 shrink-0 text-gray-400" />
                      <span>{fair.boothCount} 家单位参展</span>
                    </div>
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-400">
                    {fair.sourceName} · {formatSync(fair.syncTime)}
                  </span>
                  <Button
                    size="sm"
                    variant={fair.status === 'ended' ? 'secondary' : 'primary'}
                    onClick={() => navigate(`/job-fairs/${fair.id}`, { state: { fair } })}
                  >
                    查看详情
                  </Button>
                </div>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
