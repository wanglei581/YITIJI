import { useEffect, useState } from 'react'
import { Button, Card, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { CalendarIcon, DownloadIcon, PlusIcon } from 'lucide-react'
import type {
  PartnerFairRecord,
  JobFairStatus,
  ReviewStatus,
  PublishStatus,
} from '../../services/api'
import { getPartnerFairs, unpublishPartnerFair } from '../../services/api'

// ─── Display maps ─────────────────────────────────────────────────────────────

const FAIR_STATUS_MAP: Record<JobFairStatus, { style: string; label: string }> = {
  upcoming: { style: 'bg-blue-50 text-blue-600',   label: '未开始' },
  ongoing:  { style: 'bg-green-50 text-green-600', label: '进行中' },
  ended:    { style: 'bg-gray-100 text-gray-500',  label: '已结束' },
}

const REVIEW_MAP: Record<ReviewStatus, { badge: 'warning' | 'info' | 'success' | 'error'; label: string }> = {
  pending:   { badge: 'warning', label: '待审核' },
  reviewing: { badge: 'info',    label: '审核中' },
  approved:  { badge: 'success', label: '已通过' },
  rejected:  { badge: 'error',   label: '已拒绝' },
}

const PUBLISH_MAP: Record<PublishStatus, { badge: 'success' | 'warning' | 'default'; label: string }> = {
  draft:       { badge: 'warning', label: '待发布' },
  published:   { badge: 'success', label: '已发布' },
  unpublished: { badge: 'default', label: '已下架' },
  expired:     { badge: 'default', label: '已过期' },
}

const STATUS_FILTERS = ['全部', '未开始', '进行中', '已结束'] as const
const STATUS_FILTER_MAP: Record<string, JobFairStatus | null> = {
  全部: null, 未开始: 'upcoming', 进行中: 'ongoing', 已结束: 'ended',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FairsPage() {
  const [fairs,        setFairs]        = useState<PartnerFairRecord[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(false)
  const [statusFilter, setStatusFilter] = useState('全部')

  useEffect(() => {
    let cancelled = false
    getPartnerFairs()
      .then((data) => { if (!cancelled) setFairs(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const filtered = statusFilter === '全部'
    ? fairs
    : fairs.filter((f) => f.status === STATUS_FILTER_MAP[statusFilter])

  const counts = {
    全部:   fairs.length,
    未开始: fairs.filter((f) => f.status === 'upcoming').length,
    进行中: fairs.filter((f) => f.status === 'ongoing').length,
    已结束: fairs.filter((f) => f.status === 'ended').length,
  }

  const handleUnpublish = (id: string) => {
    unpublishPartnerFair(id).then((updated) => {
      setFairs((prev) => prev.map((f) => f.id === id ? updated : f))
    })
  }

  if (loading) {
    return (
      <Page title="招聘会信息管理" subtitle="加载中...">
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="招聘会信息管理" subtitle="加载失败">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <CalendarIcon className="h-10 w-10 text-gray-200" />
          <p className="text-sm text-gray-400">加载失败，请稍后重试</p>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="招聘会信息管理"
      subtitle={`共 ${fairs.length} 场招聘会`}
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex items-center gap-1.5">
            <DownloadIcon className="h-4 w-4" />
            导入招聘会
          </Button>
          <Button size="sm" variant="primary" className="flex items-center gap-1.5">
            <PlusIcon className="h-4 w-4" />
            新增招聘会
          </Button>
        </div>
      }
    >
      {/* 筛选标签 */}
      <div className="mb-4 flex gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f}
            <span className="ml-1.5 text-xs opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['外部编号', '招聘会名称', '主办方', '时间', '地点', '会议状态', '来源预约链接', '同步时间', '审核状态', '发布状态', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-sm text-gray-400">
                    <CalendarIcon className="mx-auto mb-2 h-8 w-8 text-gray-200" />
                    当前筛选条件下无招聘会
                  </td>
                </tr>
              ) : (
                filtered.map((f) => {
                  const fs      = FAIR_STATUS_MAP[f.status]
                  const review  = REVIEW_MAP[f.reviewStatus]
                  const publish = PUBLISH_MAP[f.publishStatus]
                  return (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-400">{f.externalId}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{f.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{f.organizer}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        <div>{f.startTime}</div>
                        <div className="text-gray-300">至 {f.endTime.slice(5)}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{f.venue}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${fs.style}`}>{fs.label}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-primary-600">
                        <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
                          查看来源
                        </a>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{f.syncTime}</td>
                      <td className="px-4 py-3"><StatusBadge status={review.badge}  label={review.label}  /></td>
                      <td className="px-4 py-3"><StatusBadge status={publish.badge} label={publish.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex gap-2">
                          <button className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">编辑</button>
                          <button className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">查看预约二维码</button>
                          <button className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">打印活动资料</button>
                          {f.publishStatus === 'published' && (
                            <button
                              className="rounded px-2 py-1 text-xs font-medium text-orange-500 hover:bg-orange-50"
                              onClick={() => handleUnpublish(f.id)}
                            >
                              下架
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-gray-400">
        本后台仅管理来源数据，不在本系统内接收求职者简历，不参与招聘闭环。
      </p>
    </Page>
  )
}
