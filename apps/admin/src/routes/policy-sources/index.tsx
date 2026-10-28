import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDateTime } from '@ai-job-print/shared'
import { Card, ConsoleTable, StatusBadge, LoadingState, type ConsoleColumn } from '@ai-job-print/ui'
import { Page } from '../Page'
import { ScrollTextIcon } from 'lucide-react'
import { policiesAdminService, type AdminPolicyRecord } from '../../services/api/policiesAdmin'
import type { AdminSourcePage, ReviewStatus } from '../../services/api'
import { requireAdminSourcePage } from '../../services/api/sourcePaging'
import { useTableState } from '../components/DataTable'
import EligibilityRulesDrawer from './EligibilityRulesDrawer'
import { EmergencyTakedownDialog } from '../components/recruitment/EmergencyTakedownDialog'
import type { EmergencyTakedownTarget } from '../components/recruitment/emergencyReason'
import { POLICY_AUDIT_ACTIONS, RecentEmergencyAuditCard } from '../components/RecentEmergencyAuditCard'
import { SourceNarrowCards, SourceStatusFilters } from '../components/SourceNarrowCards'

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
  graduate: '应届高校毕业生', flexible: '灵活就业人员', migrant: '返乡务工人员', hardship: '困难群体就业援助', startup: '创业扶持', general: '通用',
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
    setError(false)
    setLoading(true)
    policiesAdminService.getPolicySources(listQuery)
      .then(applyPage)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [listQuery, applyPage])

  if (loading) {
    return (
      <Page title="政策信息源" subtitle={SUBTITLE}>
        <div className="flex h-48 items-center justify-center">
          <LoadingState text="加载中…" className="py-12" />
        </div>
        <RecentEmergencyAuditCard actions={POLICY_AUDIT_ACTIONS} />
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="政策信息源" subtitle={SUBTITLE}>
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <ScrollTextIcon className="h-10 w-10 text-neutral-200" />
          <p className="text-sm text-neutral-400">加载失败，请稍后重试</p>
          <button
            type="button"
            onClick={reload}
            className="inline-flex h-11 items-center rounded-lg border border-neutral-200 bg-surface px-4 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            重新加载
          </button>
        </div>
        <RecentEmergencyAuditCard actions={POLICY_AUDIT_ACTIONS} />
      </Page>
    )
  }

  const baseColumns: ConsoleColumn<AdminPolicyRecord>[] = [
    { id: 'source', header: '来源机构', headerClassName: 'w-[11%]', truncate: true, cell: (r) => r.sourceName },
    { id: 'kind', header: '类型', headerClassName: 'w-[6%]', cell: (r) => <span className={`whitespace-nowrap text-xs ${r.kind === 'policy_guide' ? 'text-info-fg' : 'text-purple-600'}`}>{KIND_LABELS[r.kind] ?? r.kind}</span> },
    { id: 'title', header: '标题', headerClassName: 'w-[24%]', cell: (r) => <div title={[r.title, r.summary, r.reviewStatus === 'rejected' && r.rejectReason ? `拒绝原因:${r.rejectReason}` : ''].filter(Boolean).join('\n')}>
      <p className={`${r.reviewStatus === 'rejected' && r.rejectReason ? 'line-clamp-1' : 'line-clamp-2'} break-words font-medium text-neutral-800`}>{r.title}</p>
      {r.summary && <p className="line-clamp-1 text-xs text-neutral-500">{r.summary}</p>}
      {r.reviewStatus === 'rejected' && r.rejectReason && <p className="truncate text-xs text-error-fg">拒绝原因:{r.rejectReason}</p>}
    </div> },
    { id: 'group', header: '分组/标签', headerClassName: 'w-[7%]', truncate: true, cell: (r) => r.kind === 'policy_guide' ? (r.audience ? AUDIENCE_LABELS[r.audience] ?? r.audience : '—') : (r.category ? CATEGORY_LABELS[r.category] ?? r.category : '—') },
    { id: 'date', header: '展示日期', headerClassName: 'w-[10%]', cellClassName: 'whitespace-nowrap text-[11px]', cell: (r) => r.publishedDate ?? '—' },
    { id: 'time', header: '提交时间', headerClassName: 'w-[14%]', cellClassName: 'whitespace-nowrap text-[11px]', cell: (r) => <span title={formatDateTime(r.syncTime)}>{formatDateTime(r.syncTime)}</span> },
    { id: 'review', header: '审核状态', headerClassName: 'w-[9%]', cell: (r) => <StatusBadge className="px-2 text-[11px]" dot status={(REVIEW_MAP[r.reviewStatus] ?? REVIEW_MAP.pending).badge} label={(REVIEW_MAP[r.reviewStatus] ?? REVIEW_MAP.pending).label} /> },
    { id: 'publish', header: '发布状态', headerClassName: 'w-[9%]', cell: (r) => <StatusBadge className="px-2 text-[11px]" dot status={(PUBLISH_MAP[r.publishStatus] ?? PUBLISH_MAP.draft).badge} label={(PUBLISH_MAP[r.publishStatus] ?? PUBLISH_MAP.draft).label} /> },
    { id: 'actions', header: '操作', headerClassName: 'w-[10%]', sticky: true, cell: (r) => <div className="flex flex-col items-start gap-0.5">
      <button type="button" className="whitespace-nowrap rounded px-1 py-0.5 text-xs font-medium text-primary-600 hover:bg-primary-50" onClick={() => setRulesFor(r)}>查看申领条件</button>
      <button type="button" className="whitespace-nowrap rounded px-1 py-0.5 text-xs font-medium text-error-fg hover:bg-error-bg" onClick={() => setTakedown({ targetType: 'policy', targetId: r.id, title: r.title, orgName: r.sourceName })}>紧急下架</button>
    </div> },
  ]
  const columns = baseColumns.map((column) => ({ ...column, headerClassName: `${column.headerClassName} !px-2`, cellClassName: `${column.cellClassName ?? ''} !px-2 text-xs` }))

  return (
    <Page title="政策信息源" subtitle={SUBTITLE}>
      <div role="status" className="mb-4 rounded-lg border border-info/20 bg-info-bg px-4 py-3 text-sm text-info-fg">
        政策由发布机构自己审核、发布，并在发布时确认对内容负责；管理员不审核、不发布，本页只保留查看与紧急下架。
        紧急下架是单向操作，提交后不能恢复，并会自动通知发布机构。
      </div>
      <SourceStatusFilters
        options={REVIEW_FILTERS}
        value={reviewFilter}
        onChange={(next) => { setReviewFilter(next as typeof reviewFilter); setPage(1) }}
        search={search}
        onSearch={setSearch}
        searchPlaceholder="搜索标题、来源机构..."
      />

      <SourceNarrowCards
        items={records}
        emptyTitle={search ? '未找到匹配的政策内容' : '暂无政策内容'}
        titleOf={(row) => row.title}
        viewLabel="查看申领条件"
        statusOf={(row) => (
          <>
            <StatusBadge dot status={(REVIEW_MAP[row.reviewStatus] ?? REVIEW_MAP.pending).badge} label={(REVIEW_MAP[row.reviewStatus] ?? REVIEW_MAP.pending).label} />
            <StatusBadge dot status={(PUBLISH_MAP[row.publishStatus] ?? PUBLISH_MAP.draft).badge} label={(PUBLISH_MAP[row.publishStatus] ?? PUBLISH_MAP.draft).label} />
          </>
        )}
        onView={setRulesFor}
        onTakedown={(row) => setTakedown({ targetType: 'policy', targetId: row.id, title: row.title, orgName: row.sourceName })}
      />

      {/* 固定列宽在 1280 下给标题留出两行空间；全文与摘要保留在悬停。 */}
      <Card className="hidden overflow-hidden p-0 md:block">
        <ConsoleTable items={records} columns={columns} scrollX={false} className="[&_table]:table-fixed"
          empty={{ title: search ? '未找到匹配的政策内容' : '暂无政策内容', description: search ? '请尝试其他关键词' : '政策内容由合作机构在机构后台「政策公告」中提交' }}
          page={page} pageSize={pageSize} total={total} onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />
      </Card>

      <p className="mt-3 text-xs text-neutral-400">
        政策内容只做说明：仅政策说明、材料清单与官方入口；不承诺补贴到账、不代申请。发布机构审核通过并确认发布责任后在一体机「政策服务」页展示,所有操作记录审计日志。
        「查看申领条件」为只读复核:条件由来源机构在合作机构后台录入,本页不改条件。
      </p>

      <RecentEmergencyAuditCard actions={POLICY_AUDIT_ACTIONS} />

      <EmergencyTakedownDialog target={takedown} onClose={() => setTakedown(null)} onDone={reload} />

      {/* key 绑 id:换一条政策必须重挂组件,避免上一条的条件在新标题下短暂残留 */}
      {rulesFor && (
        <EligibilityRulesDrawer key={rulesFor.id} policy={rulesFor} onClose={() => setRulesFor(null)} />
      )}
    </Page>
  )
}
