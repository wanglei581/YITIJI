import { useEffect, useState } from 'react'
import { Card, StatusBadge, EmptyState, LoadingState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { ScrollTextIcon } from 'lucide-react'
import { policiesAdminService, type AdminPolicyRecord } from '../../services/api/policiesAdmin'
import { Pagination, useTableState } from '../components/DataTable'

// ─── Display maps ─────────────────────────────────────────────────────────────

const REVIEW_MAP: Record<string, { badge: 'warning' | 'info' | 'success' | 'error'; label: string }> = {
  pending:   { badge: 'warning', label: '待审核' },
  reviewing: { badge: 'info',    label: '审核中' },
  approved:  { badge: 'success', label: '已通过' },
  rejected:  { badge: 'error',   label: '已拒绝' },
}

const PUBLISH_MAP: Record<string, { badge: 'success' | 'warning' | 'default'; label: string }> = {
  draft:       { badge: 'warning', label: '待发布' },
  published:   { badge: 'success', label: '已发布' },
  unpublished: { badge: 'default', label: '已下架' },
  expired:     { badge: 'default', label: '已过期' },
}

const KIND_LABELS: Record<string, string> = { policy_guide: '政策扶持', notice: '政策公告' }
const AUDIENCE_LABELS: Record<string, string> = {
  graduate: '应届毕业生', flexible: '灵活就业', migrant: '返乡务工', hardship: '困难群体', startup: '创业扶持', general: '通用',
}
const CATEGORY_LABELS: Record<string, string> = {
  policy: '政策', announcement: '公告', notice: '通知', recruitment: '招募',
}

const REVIEW_FILTERS = ['全部', '待审核', '审核中', '已通过', '已拒绝'] as const
const REVIEW_FILTER_MAP: Record<string, string | null> = {
  全部: null, 待审核: 'pending', 审核中: 'reviewing', 已通过: 'approved', 已拒绝: 'rejected',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PolicySourcesPage() {
  const [records,      setRecords]      = useState<AdminPolicyRecord[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(false)
  const [reviewFilter, setReviewFilter] = useState('全部')
  const [rejectingId,  setRejectingId]  = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  useEffect(() => {
    let cancelled = false
    policiesAdminService.getPolicySources()
      .then((data) => { if (!cancelled) setRecords(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const applyUpdate = (updated: AdminPolicyRecord) => {
    setRecords((prev) => prev.map((r) => r.id === updated.id ? updated : r))
  }

  const handleApprove = (id: string) => {
    void policiesAdminService.reviewPolicy(id, 'approve').then(applyUpdate)
  }
  const handleReject = (id: string) => {
    if (!rejectReason.trim()) return
    void policiesAdminService.reviewPolicy(id, 'reject', rejectReason.trim()).then((updated) => {
      applyUpdate(updated)
      setRejectingId(null)
      setRejectReason('')
    })
  }
  const handlePublish = (id: string) => {
    void policiesAdminService.publishPolicy(id, 'publish').then(applyUpdate)
  }
  const handleUnpublish = (id: string) => {
    void policiesAdminService.publishPolicy(id, 'unpublish').then(applyUpdate)
  }

  const filtered = reviewFilter === '全部'
    ? records
    : records.filter((r) => r.reviewStatus === REVIEW_FILTER_MAP[reviewFilter])

  const searched = search.trim()
    ? filtered.filter((r) => r.title.includes(search) || r.sourceName.includes(search))
    : filtered

  const total = searched.length
  const paginated = searched.slice((page - 1) * pageSize, page * pageSize)

  const counts = {
    全部:   records.length,
    待审核: records.filter((r) => r.reviewStatus === 'pending').length,
    审核中: records.filter((r) => r.reviewStatus === 'reviewing').length,
    已通过: records.filter((r) => r.reviewStatus === 'approved').length,
    已拒绝: records.filter((r) => r.reviewStatus === 'rejected').length,
  }

  if (loading) {
    return (
      <Page title="政策信息源" subtitle="合作机构提交的政策扶持/公告内容审核与发布">
        <div className="flex h-48 items-center justify-center">
          <LoadingState text="加载中…" className="py-12" />
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="政策信息源" subtitle="合作机构提交的政策扶持/公告内容审核与发布">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <ScrollTextIcon className="h-10 w-10 text-neutral-200" />
          <p className="text-sm text-neutral-400">加载失败，请稍后重试</p>
        </div>
      </Page>
    )
  }

  return (
    <Page title="政策信息源" subtitle="合作机构提交的政策扶持/公告内容审核与发布">
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
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索标题、来源机构..." className="h-8 w-56 rounded-lg border border-neutral-200 bg-surface pl-8 pr-3 text-xs text-neutral-700 placeholder-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200" />
          <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
        </div>
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['来源机构', '类型', '标题', '分组/标签', '展示日期', '提交时间', '审核状态', '发布状态', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 bg-neutral-50/90 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      title={search ? '未找到匹配的政策内容' : '暂无政策内容'}
                      description={search ? '请尝试其他关键词' : '政策内容由合作机构在机构后台「政策公告」中提交'}
                      icon={ScrollTextIcon}
                      className="py-12"
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((r) => {
                  const review  = REVIEW_MAP[r.reviewStatus] ?? REVIEW_MAP.pending
                  const publish = PUBLISH_MAP[r.publishStatus] ?? PUBLISH_MAP.draft
                  return (
                    <tr key={r.id} className="hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3 text-xs font-medium text-neutral-700">{r.sourceName}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${r.kind === 'policy_guide' ? 'bg-info-bg text-info-fg' : 'bg-purple-50 text-purple-600'}`}>
                          {KIND_LABELS[r.kind] ?? r.kind}
                        </span>
                      </td>
                      <td className="max-w-80 px-4 py-3">
                        <p className="font-medium text-neutral-800">{r.title}</p>
                        {r.summary && <p className="mt-0.5 line-clamp-1 text-xs text-neutral-400">{r.summary}</p>}
                        {r.reviewStatus === 'rejected' && r.rejectReason && (
                          <p className="mt-0.5 text-xs text-error-fg">拒绝原因:{r.rejectReason}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                        {r.kind === 'policy_guide'
                          ? (r.audience ? AUDIENCE_LABELS[r.audience] ?? r.audience : '—')
                          : (r.category ? CATEGORY_LABELS[r.category] ?? r.category : '—')}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{r.publishedDate ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-400">{r.syncTime.slice(0, 16).replace('T', ' ')}</td>
                      <td className="px-4 py-3"><StatusBadge dot status={review.badge}  label={review.label}  /></td>
                      <td className="px-4 py-3"><StatusBadge dot status={publish.badge} label={publish.label} /></td>
                      <td className="px-4 py-3">
                        {rejectingId === r.id ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              autoFocus
                              className="h-7 w-40 rounded border border-error/30 px-2 text-xs focus:border-red-400 focus:outline-none"
                              placeholder="拒绝原因(必填)"
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                            />
                            <button
                              onClick={() => handleReject(r.id)}
                              disabled={!rejectReason.trim()}
                              className="rounded bg-error px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                            >
                              确认
                            </button>
                            <button onClick={() => { setRejectingId(null); setRejectReason('') }} className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100">取消</button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            {(r.reviewStatus === 'pending' || r.reviewStatus === 'reviewing') && (
                              <>
                                <button className="rounded px-2 py-1 text-xs font-medium text-success-fg hover:bg-success-bg" onClick={() => handleApprove(r.id)}>
                                  审核通过
                                </button>
                                <button className="rounded px-2 py-1 text-xs font-medium text-error-fg hover:bg-error-bg" onClick={() => { setRejectingId(r.id); setRejectReason('') }}>
                                  拒绝
                                </button>
                              </>
                            )}
                            {r.reviewStatus === 'approved' && r.publishStatus !== 'published' && (
                              <button className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50" onClick={() => handlePublish(r.id)}>
                                发布
                              </button>
                            )}
                            {r.publishStatus === 'published' && (
                              <button className="rounded px-2 py-1 text-xs font-medium text-warning-fg hover:bg-warning-bg" onClick={() => handleUnpublish(r.id)}>
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
        政策内容为 info-only:仅政策说明、材料清单与官方入口;不承诺补贴到账、不代申请。审核通过并发布后在一体机「政策服务」页展示,所有操作记录审计日志。
      </p>
    </Page>
  )
}
