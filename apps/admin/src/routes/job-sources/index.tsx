import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, Drawer, StatusBadge, EmptyState, LoadingState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { BriefcaseIcon, FilterIcon, XIcon } from 'lucide-react'
import type { AdminJobSourceRecord, ReviewStatus, PublishStatus } from '../../services/api'
import {
  getJobSources,
  approveJobSource,
  rejectJobSource,
  publishJobSource,
  unpublishJobSource,
} from '../../services/api'
import { Pagination, useTableState } from '../components/DataTable'
import { BulkPublishButton } from '../components/BulkPublishButton'
import { toOrgOptions } from '../../services/api/bulkPublish'

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
  const [rejectingId,  setRejectingId]  = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  useEffect(() => {
    let cancelled = false
    getJobSources()
      .then((data) => { if (!cancelled) setSources(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // 批量发布后重新拉取,让页面状态与库一致(不做本地猜测式更新)
  const reload = useCallback(() => {
    getJobSources().then(setSources).catch(() => setError(true))
  }, [])

  const orgOptions = useMemo(() => toOrgOptions(sources), [sources])

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
    void approveJobSource(id).then((updated) => {
      setSources((prev) => prev.map((s) => s.id === id ? updated : s))
    })
  }

  const handleReject = (id: string) => {
    if (!rejectReason.trim()) return
    void rejectJobSource(id, rejectReason.trim()).then((updated) => {
      setSources((prev) => prev.map((s) => s.id === id ? updated : s))
      setRejectingId(null)
      setRejectReason('')
    })
  }

  const handlePublish = (id: string) => {
    void publishJobSource(id).then((updated) => {
      setSources((prev) => prev.map((s) => s.id === id ? updated : s))
    })
  }

  const handleUnpublish = (id: string) => {
    void unpublishJobSource(id).then((updated) => {
      setSources((prev) => prev.map((s) => s.id === id ? updated : s))
    })
  }

  if (loading) {
    return (
      <Page title="岗位信息源" subtitle="第三方平台同步岗位数据管理">
        <div className="flex h-48 items-center justify-center">
          <LoadingState text="加载中…" className="py-12" />
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
    <Page
      title="岗位信息源"
      subtitle="第三方平台同步岗位数据管理"
      actions={<BulkPublishButton kind="job" orgOptions={orgOptions} onDone={reload} />}
    >
      {/* 来自 Excel 导入批次的上下文 banner */}
      {sourceIdFilter && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-bg px-4 py-2.5">
          <FilterIcon className="h-4 w-4 flex-shrink-0 text-warning" />
          <span className="text-sm text-warning-fg">
            正在显示来自 Excel 导入批次 <strong>{batchLabel || sourceIdFilter}</strong> 的岗位（数据源 ID：{sourceIdFilter}）
          </span>
          <button
            onClick={() => setSearchParams({})}
            className="ml-auto text-warning hover:text-warning-fg"
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
            className={`rounded-full border px-[13px] py-1.5 text-[12.5px] font-bold transition-colors ${
              reviewFilter === f ? 'border-primary-600 bg-primary-600 text-white' : 'border-neutral-900/10 bg-surface text-neutral-700 hover:border-primary-600/40'
            }`}
          >
{f}
              <span className="ml-1.5 text-xs opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索岗位、公司..." className="h-8 w-56 rounded-lg border border-neutral-200 bg-surface pl-8 pr-3 text-xs text-neutral-700 placeholder-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200" />
          <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
        </div>
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['来源机构', '外部编号', '岗位标题', '公司', '城市', '薪资', '同步时间', '审核状态', '发布状态', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 bg-neutral-50/90 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <EmptyState title={search ? '未找到匹配的岗位' : '该分类暂无岗位数据'} description={search ? '请尝试其他关键词' : undefined} icon={BriefcaseIcon} className="py-12" />
                  </td>
                </tr>
              ) : (
                paginated.map((s) => {
                  const review  = REVIEW_MAP[s.reviewStatus]
                  // 过期是后端按 validThrough 实时派生的，与 publishStatus 并列展示：
                  // 库里仍是「已发布」（所以「下架」按钮还在），但对求职者已不再放出。
                  const publish = s.expired
                    ? { badge: 'default' as const, label: '已发布 · 已过期' }
                    : PUBLISH_MAP[s.publishStatus]
                  return (
                    <tr key={s.id} className="hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3 text-xs font-medium text-neutral-700">{s.sourceName}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-400">{s.externalId}</td>
                      <td className="px-4 py-3 font-medium text-neutral-800">
                        <p>{s.title}</p>
                        {s.reviewStatus === 'rejected' && s.rejectReason && (
                          <p className="mt-0.5 text-xs text-error-fg">拒绝原因:{s.rejectReason}</p>
                        )}
                        {/*
                          确定性关键词筛查结果（后端读取时派生，非 AI 判定）。
                          命中只表示「需人工看一眼」,系统不会据此自动拒绝 ——
                          文案必须保持「疑似 / 请人工复核」口径,不得写成结论。
                        */}
                        {s.contentFlags && s.contentFlags.length > 0 && (
                          <p className="mt-0.5 text-xs text-warning-fg">
                            疑似违规表述，请人工复核:{s.contentFlags.map((f) => `「${f.term}」${f.label}`).join('；')}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">{s.company}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{s.city}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">{s.salary}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-400">{s.syncTime}</td>
                      <td className="px-4 py-3"><StatusBadge dot status={review.badge}  label={review.label}  /></td>
                      <td className="px-4 py-3"><StatusBadge dot status={publish.badge} label={publish.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {rejectingId === s.id ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              className="h-7 w-40 rounded border border-error/30 px-2 text-xs focus:border-red-400 focus:outline-none"
                              placeholder="拒绝原因(必填)"
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                            />
                            <button
                              type="button"
                              onClick={() => handleReject(s.id)}
                              disabled={!rejectReason.trim()}
                              className="rounded bg-error px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                            >
                              确认
                            </button>
                            <button
                              type="button"
                              onClick={() => { setRejectingId(null); setRejectReason('') }}
                              className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setViewing(s)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">查看</button>
                            {(s.reviewStatus === 'pending' || s.reviewStatus === 'reviewing') && (
                              <>
                                <button
                                  type="button"
                                  className="rounded px-2 py-1 text-xs font-medium text-success-fg hover:bg-success-bg"
                                  onClick={() => handleApprove(s.id)}
                                >
                                  审核通过
                                </button>
                                <button
                                  type="button"
                                  className="rounded px-2 py-1 text-xs font-medium text-error-fg hover:bg-error-bg"
                                  onClick={() => { setRejectingId(s.id); setRejectReason('') }}
                                >
                                  拒绝
                                </button>
                              </>
                            )}
                            {s.reviewStatus === 'approved' && s.publishStatus !== 'published' && (
                              <button
                                type="button"
                                className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                                onClick={() => handlePublish(s.id)}
                              >
                                发布
                              </button>
                            )}
                            {s.publishStatus === 'published' && (
                              <button
                                type="button"
                                className="rounded px-2 py-1 text-xs font-medium text-warning-fg hover:bg-warning-bg"
                                onClick={() => handleUnpublish(s.id)}
                              >
                                下架
                              </button>
                            )}
                          </div>
                        )}
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
            <DetailRow
              label="有效期"
              value={viewing.validThrough
                ? `${viewing.validThrough.slice(0, 10)}${viewing.expired ? '（已过期，求职者端已自动不再展示；请下架或联系来源机构更新）' : ''}`
                : '来源未提供'}
            />
            {viewing.reviewStatus === 'rejected' && viewing.rejectReason ? (
              <DetailRow label="拒绝原因" value={viewing.rejectReason} />
            ) : null}
            <p className="mt-4 text-xs text-neutral-400">仅展示第三方来源数据，系统不参与招聘闭环、不收取简历。</p>
          </div>
        )}
      </Drawer>
    </Page>
  )
}
