import { useEffect, useState } from 'react'
import { Button, Card, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { BriefcaseIcon, DownloadIcon, PlusIcon } from 'lucide-react'
import type {
  PartnerJobRecord,
  JobCategory,
  ReviewStatus,
  PublishStatus,
} from '../../services/api'
import { getPartnerJobs, unpublishPartnerJob } from '../../services/api'

// ─── Display maps ─────────────────────────────────────────────────────────────

const CATEGORY_MAP: Record<JobCategory, { label: string; style: string }> = {
  fulltime: { label: '全职', style: 'bg-blue-50 text-blue-600'     },
  intern:   { label: '实习', style: 'bg-purple-50 text-purple-600' },
  campus:   { label: '校招', style: 'bg-green-50 text-green-600'   },
  parttime: { label: '兼职', style: 'bg-orange-50 text-orange-600' },
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

const CATEGORY_FILTERS = ['全部', '全职', '实习', '校招', '兼职'] as const
const REVIEW_FILTERS   = ['全部', '待审核', '审核中', '已通过', '已拒绝'] as const
const CATEGORY_FILTER_MAP: Record<string, JobCategory | null>  = { 全部: null, 全职: 'fulltime', 实习: 'intern', 校招: 'campus', 兼职: 'parttime' }
const REVIEW_FILTER_MAP:   Record<string, ReviewStatus | null> = { 全部: null, 待审核: 'pending', 审核中: 'reviewing', 已通过: 'approved', 已拒绝: 'rejected' }

// ─── Component ────────────────────────────────────────────────────────────────

export default function JobsPage() {
  const [jobs,           setJobs]           = useState<PartnerJobRecord[]>([])
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState(false)
  const [categoryFilter, setCategoryFilter] = useState('全部')
  const [reviewFilter,   setReviewFilter]   = useState('全部')

  useEffect(() => {
    let cancelled = false
    getPartnerJobs()
      .then((data) => { if (!cancelled) setJobs(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const filtered = jobs.filter((j) => {
    const matchCat    = categoryFilter === '全部' || j.category     === CATEGORY_FILTER_MAP[categoryFilter]
    const matchReview = reviewFilter   === '全部' || j.reviewStatus === REVIEW_FILTER_MAP[reviewFilter]
    return matchCat && matchReview
  })

  const reviewCounts = {
    全部:   jobs.length,
    待审核: jobs.filter((j) => j.reviewStatus === 'pending').length,
    审核中: jobs.filter((j) => j.reviewStatus === 'reviewing').length,
    已通过: jobs.filter((j) => j.reviewStatus === 'approved').length,
    已拒绝: jobs.filter((j) => j.reviewStatus === 'rejected').length,
  }

  const handleUnpublish = (id: string) => {
    unpublishPartnerJob(id).then((updated) => {
      setJobs((prev) => prev.map((j) => j.id === id ? updated : j))
    })
  }

  if (loading) {
    return (
      <Page title="岗位信息管理" subtitle="加载中...">
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="岗位信息管理" subtitle="加载失败">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <BriefcaseIcon className="h-10 w-10 text-gray-200" />
          <p className="text-sm text-gray-400">加载失败，请稍后重试</p>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="岗位信息管理"
      subtitle={`共 ${jobs.length} 条岗位`}
      actions={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex items-center gap-1.5">
            <DownloadIcon className="h-4 w-4" />
            导入岗位
          </Button>
          <Button size="sm" variant="primary" className="flex items-center gap-1.5">
            <PlusIcon className="h-4 w-4" />
            新增岗位
          </Button>
        </div>
      }
    >
      {/* 双行筛选 */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="w-14 text-xs text-gray-400">岗位类型</span>
          <div className="flex gap-2">
            {CATEGORY_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setCategoryFilter(f)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  categoryFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-14 text-xs text-gray-400">审核状态</span>
          <div className="flex gap-2">
            {REVIEW_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setReviewFilter(f)}
                className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  reviewFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f}
                <span className="ml-1 text-xs opacity-70">{reviewCounts[f]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['外部编号', '岗位标题', '公司', '城市', '类型', '来源链接', '同步时间', '审核状态', '发布状态', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-sm text-gray-400">
                    <BriefcaseIcon className="mx-auto mb-2 h-8 w-8 text-gray-200" />
                    当前筛选条件下无岗位
                  </td>
                </tr>
              ) : (
                filtered.map((j) => {
                  const cat     = j.category ? CATEGORY_MAP[j.category] : undefined
                  const review  = REVIEW_MAP[j.reviewStatus]
                  const publish = PUBLISH_MAP[j.publishStatus]
                  return (
                    <tr key={j.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-400">{j.externalId}</td>
                      <td className="px-4 py-3 font-medium text-gray-800">{j.title}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{j.company}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{j.city}</td>
                      <td className="px-4 py-3">
                        {cat
                          ? <span className={`rounded px-2 py-0.5 text-xs font-medium ${cat.style}`}>{cat.label}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-primary-600">
                        <a href={j.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
                          查看来源
                        </a>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{j.syncTime}</td>
                      <td className="px-4 py-3"><StatusBadge status={review.badge}  label={review.label}  /></td>
                      <td className="px-4 py-3"><StatusBadge status={publish.badge} label={publish.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex gap-2">
                          <button className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">编辑</button>
                          <button className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">查看二维码</button>
                          {j.publishStatus === 'published' && (
                            <button
                              className="rounded px-2 py-1 text-xs font-medium text-orange-500 hover:bg-orange-50"
                              onClick={() => handleUnpublish(j.id)}
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
        本后台仅管理外部来源岗位链接，不在本系统内接收求职者简历，不参与招聘闭环。
      </p>
    </Page>
  )
}
