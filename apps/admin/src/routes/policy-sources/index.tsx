import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDateTime } from '@ai-job-print/shared'
import { Card, StatusBadge, EmptyState, LoadingState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { ScrollTextIcon } from 'lucide-react'
import { policiesAdminService, type AdminPolicyRecord } from '../../services/api/policiesAdmin'
import type { AdminSourcePage, ReviewStatus } from '../../services/api'
import { requireAdminSourcePage } from '../../services/api/sourcePaging'
import { Pagination, useTableState } from '../components/DataTable'
import EligibilityRulesDrawer from './EligibilityRulesDrawer'
import { EmergencyTakedownDialog } from '../components/recruitment/EmergencyTakedownDialog'
import type { EmergencyTakedownTarget } from '../components/recruitment/emergencyReason'

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

const SUBTITLE = '合作机构自行审核发布的政策扶持 / 公告内容（管理员只读 + 紧急下架）'

const REVIEW_FILTERS = ['全部', '待审核', '审核中', '已通过', '已拒绝'] as const
const REVIEW_FILTER_MAP: Record<string, ReviewStatus | null> = {
  全部: null, 待审核: 'pending', 审核中: 'reviewing', 已通过: 'approved', 已拒绝: 'rejected',
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * 政策由机构自己审核、发布并确认发布责任（3.13）。管理员在这里只能查看与紧急下架：
 * 服务端对管理员的审核 / 发布 / 批量发布一律回 403 ADMIN_POLICY_PUBLISH_DISABLED，
 * 与招聘内容托管开关无关，所以本页不按开关分支，两种部署都一样。
 */
export default function PolicySourcesPage() {
  const [records,      setRecords]      = useState<AdminPolicyRecord[]>([])
  const [total,        setTotal]        = useState(0)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(false)
  const [reviewFilter, setReviewFilter] = useState('全部')
  // 申领条件只读复核:紧急处置前要能看到这条政策挂了哪些申领门槛(条件在机构侧录入)
  const [rulesFor,     setRulesFor]     = useState<AdminPolicyRecord | null>(null)
  const [takedown,     setTakedown]     = useState<EmergencyTakedownTarget | null>(null)
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  const listQuery = useMemo(() => ({
    page,
    pageSize,
    keyword: search.trim() || undefined,
    reviewStatus: REVIEW_FILTER_MAP[reviewFilter] ?? undefined,
  }), [page, pageSize, search, reviewFilter])

  const applyPage = useCallback((data: AdminPolicyRecord[] | AdminSourcePage<AdminPolicyRecord>) => {
    const pageData = requireAdminSourcePage(data)
    setRecords(pageData.items)
    setTotal(pageData.total)
  }, [])

  useEffect(() => {
    let cancelled = false
    setError(false)
    policiesAdminService.getPolicySources(listQuery)
      .then((data) => { if (!cancelled) applyPage(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [listQuery, applyPage])

  const reload = useCallback(() => {
    policiesAdminService.getPolicySources(listQuery).then(applyPage).catch(() => setError(true))
  }, [listQuery, applyPage])

  if (loading) {
    return (
      <Page title="政策信息源" subtitle={SUBTITLE}>
        <div className="flex h-48 items-center justify-center">
          <LoadingState text="加载中…" className="py-12" />
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="政策信息源" subtitle={SUBTITLE}>
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <ScrollTextIcon className="h-10 w-10 text-neutral-200" />
          <p className="text-sm text-neutral-400">加载失败，请稍后重试</p>
        </div>
      </Page>
    )
  }

  return (
    <Page title="政策信息源" subtitle={SUBTITLE}>
      <div role="status" className="mb-4 rounded-lg border border-info/20 bg-info-bg px-4 py-3 text-sm text-info-fg">
        政策由发布机构自己审核、发布，并在发布时确认对内容负责；管理员不审核、不发布，本页只保留查看与紧急下架。
        紧急下架是单向操作，提交后不能恢复，并会自动通知发布机构。
      </div>
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
              {records.length === 0 ? (
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
                records.map((r) => {
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
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-400">{formatDateTime(r.syncTime)}</td>
                      <td className="px-4 py-3"><StatusBadge dot status={review.badge}  label={review.label}  /></td>
                      <td className="px-4 py-3"><StatusBadge dot status={publish.badge} label={publish.label} /></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="whitespace-nowrap rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                            onClick={() => setRulesFor(r)}
                          >
                            查看申领条件
                          </button>
                          <button
                            type="button"
                            className="whitespace-nowrap rounded px-2 py-1 text-xs font-medium text-error-fg hover:bg-error-bg"
                            onClick={() => setTakedown({ targetType: 'policy', targetId: r.id, title: r.title, orgName: r.sourceName })}
                          >
                            紧急下架
                          </button>
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
        政策内容为 info-only:仅政策说明、材料清单与官方入口;不承诺补贴到账、不代申请。发布机构审核通过并确认发布责任后在一体机「政策服务」页展示,所有操作记录审计日志。
        「查看申领条件」为只读复核:条件由来源机构在合作机构后台录入,本页不改条件。
      </p>

      <EmergencyTakedownDialog target={takedown} onClose={() => setTakedown(null)} onDone={reload} />

      {/* key 绑 id:换一条政策必须重挂组件,避免上一条的条件在新标题下短暂残留 */}
      {rulesFor && (
        <EligibilityRulesDrawer key={rulesFor.id} policy={rulesFor} onClose={() => setRulesFor(null)} />
      )}
    </Page>
  )
}
