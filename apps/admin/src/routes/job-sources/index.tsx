import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, Drawer, StatusBadge, EmptyState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { BriefcaseIcon, FilterIcon, XIcon } from 'lucide-react'
import type { AdminJobSourceRecord, ReviewStatus, PublishStatus } from '../../services/api'
import {
  getJobSources,
  approveJobSource,
  publishJobSource,
  unpublishJobSource,
} from '../../services/api'
import { Pagination, useTableState } from '../components/DataTable'

// ─── Display maps ─────────────────────────────────────────────────────────────

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

const REVIEW_FILTERS = ['全部', '待审核', '审核中', '已通过', '已拒绝'] as const
const REVIEW_FILTER_MAP: Record<string, ReviewStatus | null> = {
  全部: null, 待审核: 'pending', 审核中: 'reviewing', 已通过: 'approved', 已拒绝: 'rejected',
}

// ─── Component ────────────────────────────────────────────────────────────────

/** 只读详情行:值为空则不渲染该行。 */
function DetailRow({ label, value }: { label: string; value?: ReactNode }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <div className="flex gap-3 border-b border-neutral-50 py-2 last:border-0">
      <span className="w-20 flex-shrink-0 text-xs text-neutral-400">{label}</span>
      <span className="flex-1 break-words text-sm text-neutral-700">{value}</span>
    </div>
  )
}

export default function JobSourcesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const sourceIdFilter = searchParams.get('sourceId') ?? ''
  const batchLabel     = searchParams.get('batchLabel') ?? ''

  const [sources,      setSources]      = useState<AdminJobSourceRecord[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(false)
  const [reviewFilter, setReviewFilter] = useState('全部')
  const [viewing,      setViewing]      = useState<AdminJobSourceRecord | null>(null)
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  useEffect(() => {
    let cancelled = false
    getJobSources()
      .then((data) => { if (!cancelled) setSources(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // sourceId filter: when arriving from import-batches page
  const bySource = sourceIdFilter
    ? sources.filter((s) => s.sourceId === sourceIdFilter)
    : sources

  const filtered = reviewFilter === '全部'
    ? bySource
    : bySource.filter((s) => s.reviewStatus === REVIEW_FILTER_MAP[reviewFilter])

  const searched = search.trim()
    ? filtered.filter((s) =>
        s.title.includes(search) ||
        s.company.includes(search) ||
        s.sourceName.includes(search)
      )
    : filtered

  const total = searched.length
  const paginated = searched.slice((page - 1) * pageSize, page * pageSize)

  const counts = {
    全部:   bySource.length,
    待审核: bySource.filter((s) => s.reviewStatus === 'pending').length,
    审核中: bySource.filter((s) => s.reviewStatus === 'reviewing').length,
    已通过: bySource.filter((s) => s.reviewStatus === 'approved').length,
    已拒绝: bySource.filter((s) => s.reviewStatus === 'rejected').length,
  }

  const handleApprove = (id: string) => {
    approveJobSource(id).then((updated) => {
      setSources((prev) => prev.map((s) => s.id === id ? updated : s))
    })
  }

  const handlePublish = (id: string) => {
    publishJobSource(id).then((updated) => {
      setSources((prev) => prev.map((s) => s.id === id ? updated : s))
    })
  }

  const handleUnpublish = (id: string) => {
    unpublishJobSource(id).then((updated) => {
      setSources((prev) => prev.map((s) => s.id === id ? updated : s))
    })
  }

  if (loading) {
    return (
      <Page title="岗位信息源" subtitle="第三方平台同步岗位数据管理">
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-neutral-400">加载中...</p>
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="岗位信息源" subtitle="第三方平台同步岗位数据管理">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <BriefcaseIcon className="h-10 w-10 text-neutral-200" />
          <p className="text-sm text-neutral-400">加载失败，请稍后重试</p>
        </div>
      </Page>
    )
  }

  return (
    <Page title="岗位信息源" subtitle="第三方平台同步岗位数据管理">
      {/* 来自 Excel 导入批次的上下文 banner */}
      {sourceIdFilter && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
          <FilterIcon className="h-4 w-4 flex-shrink-0 text-amber-500" />
          <span className="text-sm text-amber-800">
            正在显示来自 Excel 导入批次 <strong>{batchLabel || sourceIdFilter}</strong> 的岗位（数据源 ID：{sourceIdFilter}）
          </span>
          <button
            onClick={() => setSearchParams({})}
            className="ml-auto text-amber-500 hover:text-amber-700"
            title="清除筛选"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 筛选标签 */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex gap-2">
          {REVIEW_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => { setReviewFilter(f); setPage(1) }}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              reviewFilter === f ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
{f}
              <span className="ml-1.5 text-xs opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索岗位、公司..." className="h-8 w-56 rounded-lg border border-neutral-200 bg-white pl-8 pr-3 text-xs text-neutral-700 placeholder-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200" />
          <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
        </div>
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-100 bg-neutral-50">
              <tr>
                {['来源机构', '外部编号', '岗位标题', '公司', '城市', '薪资', '同步时间', '审核状态', '发布状态', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <EmptyState title={search ? '未找到匹配的岗位' : '该分类暂无岗位数据'} description={search ? '请尝试其他关键词' : undefined} icon={BriefcaseIcon} className="py-12" />
                  </td>
                </tr>
              ) : (
                paginated.map((s) => {
                  const review  = REVIEW_MAP[s.reviewStatus]
                  const publish = PUBLISH_MAP[s.publishStatus]
                  return (
                    <tr key={s.id} className="hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3 text-xs font-medium text-neutral-700">{s.sourceName}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-400">{s.externalId}</td>
                      <td className="px-4 py-3 font-medium text-neutral-800">{s.title}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">{s.company}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{s.city}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">{s.salary}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-400">{s.syncTime}</td>
                      <td className="px-4 py-3"><StatusBadge status={review.badge}  label={review.label}  /></td>
                      <td className="px-4 py-3"><StatusBadge status={publish.badge} label={publish.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => setViewing(s)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">查看</button>
                          {s.reviewStatus === 'pending' && (
                            <button
                              className="rounded px-2 py-1 text-xs font-medium text-green-600 hover:bg-green-50"
                              onClick={() => handleApprove(s.id)}
                            >
                              审核通过
                            </button>
                          )}
                          {s.reviewStatus === 'approved' && s.publishStatus === 'draft' && (
                            <button
                              className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                              onClick={() => handlePublish(s.id)}
                            >
                              发布
                            </button>
                          )}
                          {s.publishStatus === 'published' && (
                            <button
                              className="rounded px-2 py-1 text-xs font-medium text-orange-500 hover:bg-orange-50"
                              onClick={() => handleUnpublish(s.id)}
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
        <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }} />
      </Card>

      <p className="mt-3 text-xs text-neutral-400">
        仅展示第三方平台同步的岗位信息，不参与招聘闭环。
      </p>

      <Drawer
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title="岗位来源详情"
        size="md"
        footer={
          <div className="flex justify-end">
            <button onClick={() => setViewing(null)} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50">关闭</button>
          </div>
        }
      >
        {viewing && (
          <div className="space-y-0.5">
            <DetailRow label="来源机构" value={viewing.sourceName} />
            <DetailRow label="外部编号" value={viewing.externalId} />
            <DetailRow label="来源链接" value={viewing.sourceUrl ? <a href={viewing.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">去来源平台查看</a> : '—'} />
            <DetailRow label="岗位标题" value={viewing.title} />
            <DetailRow label="公司" value={viewing.company} />
            <DetailRow label="城市" value={viewing.city} />
            <DetailRow label="薪资" value={viewing.salary} />
            <DetailRow label="行业" value={viewing.industry} />
            <DetailRow label="标签" value={viewing.tags.length ? viewing.tags.join('、') : undefined} />
            <DetailRow label="岗位描述" value={viewing.description} />
            <DetailRow label="任职要求" value={viewing.requirements} />
            <DetailRow label="同步时间" value={viewing.syncTime} />
            <DetailRow label="审核状态" value={REVIEW_MAP[viewing.reviewStatus].label} />
            <DetailRow label="发布状态" value={PUBLISH_MAP[viewing.publishStatus].label} />
            <p className="mt-4 text-xs text-neutral-400">仅展示第三方来源数据，系统不参与招聘闭环、不收取简历。</p>
          </div>
        )}
      </Drawer>
    </Page>
  )
}
