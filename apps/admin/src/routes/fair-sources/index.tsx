import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { formatDateTime } from '@ai-job-print/shared'
import { Card, Drawer, ErrorState, LoadingState, StatusBadge, ConsoleTable, type ConsoleColumn } from '@ai-job-print/ui'
import { Page } from '../Page'
import { FilterIcon, SearchIcon, XIcon } from 'lucide-react'
import { FilterChip } from '../components/FilterChip'
import type { AdminFairSourceRecord, AdminSourcePage, ReviewStatus, PublishStatus, JobFairStatus } from '../../services/api'
import { getFairSources } from '../../services/api'
import { requireAdminSourcePage } from '../../services/api/sourcePaging'
import { useTableState } from '../components/DataTable'
import { useRecruitmentHosting } from '../components/recruitment/useRecruitmentHosting'
import { RecruitmentHostingNotice } from '../components/recruitment/RecruitmentHostingNotice'
import { EmergencyTakedownDialog } from '../components/recruitment/EmergencyTakedownDialog'
import type { EmergencyTakedownTarget } from '../components/recruitment/emergencyReason'

// ─── Display maps ─────────────────────────────────────────────────────────────

const REVIEW_MAP: Record<ReviewStatus, { badge: 'warning' | 'info' | 'success' | 'error'; label: string }> = {
  pending:   { badge: 'warning', label: '未审核' },
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

const FAIR_STATUS_STYLES: Record<JobFairStatus, string> = {
  upcoming: 'bg-info-bg text-info-fg',
  ongoing:  'bg-success-bg text-success-fg',
  ended:    'bg-neutral-100 text-neutral-500',
}
const FAIR_STATUS_LABELS: Record<JobFairStatus, string> = { upcoming: '未开始', ongoing: '进行中', ended: '已结束' }

// 3.15：管理员不再审核，「待审核」不再是管理员的待办队列，筛选按数据状态叫「未审核」。
const REVIEW_FILTERS = ['全部', '未审核', '审核中', '已通过', '已拒绝'] as const
/** 原审核 / 发布 / 批量发布按钮的位置换成这一句（按钮停放在 FairSourceReviewActions.tsx 与 BulkPublishButton.tsx）。 */
const NO_PROXY_REVIEW_NOTE = '本平台不代审、不代发招聘内容；如有违法违规内容，请用紧急下架。'

const REVIEW_FILTER_MAP: Record<string, ReviewStatus | null> = {
  全部: null, 未审核: 'pending', 审核中: 'reviewing', 已通过: 'approved', 已拒绝: 'rejected',
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

export default function FairSourcesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const sourceOrgIdFilter = searchParams.get('sourceOrgId') ?? ''
  const batchLabel        = searchParams.get('batchLabel') ?? ''

  const [sources,      setSources]      = useState<AdminFairSourceRecord[]>([])
  const [total,        setTotal]        = useState(0)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(false)
  const [reviewFilter, setReviewFilter] = useState('全部')
  const [viewing,      setViewing]      = useState<AdminFairSourceRecord | null>(null)
  const [takedown,     setTakedown]     = useState<EmergencyTakedownTarget | null>(null)
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)
  // 3.15：审核 / 发布 / 批量发布不论托管开关一律停放，本页只留查看与紧急下架；开关只用于顶部说明。
  const hosting = useRecruitmentHosting()

  const listQuery = useMemo(() => ({
    page,
    pageSize,
    keyword: search.trim() || undefined,
    reviewStatus: REVIEW_FILTER_MAP[reviewFilter] ?? undefined,
    sourceOrgId: sourceOrgIdFilter || undefined,
  }), [page, pageSize, search, reviewFilter, sourceOrgIdFilter])

  const applyPage = useCallback((data: AdminFairSourceRecord[] | AdminSourcePage<AdminFairSourceRecord>) => {
    const pageData = requireAdminSourcePage(data)
    setSources(pageData.items)
    setTotal(pageData.total)
  }, [])

  useEffect(() => {
    let cancelled = false
    setError(false)
    getFairSources(listQuery)
      .then((data) => { if (!cancelled) applyPage(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [listQuery, applyPage])

  const reload = useCallback(() => {
    getFairSources(listQuery).then(applyPage).catch(() => setError(true))
  }, [listQuery, applyPage])

  if (loading) {
    return (
      <Page title="招聘会信息源" subtitle="第三方来源招聘会查看 · 紧急下架">
        <LoadingState text="加载招聘会信息源…" className="py-24" />
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="招聘会信息源" subtitle="第三方来源招聘会查看 · 紧急下架">
        <ErrorState title="加载失败" message="请检查网络或稍后重试" className="py-24" />
      </Page>
    )
  }

  const columns: ConsoleColumn<AdminFairSourceRecord>[] = [
    { id: 'col0', header: '来源机构', truncate: true, cellClassName: 'whitespace-nowrap  text-xs font-medium text-neutral-700', cell: (s) => s.sourceName },
    { id: 'col1', header: '外部编号', truncate: true, cellClassName: 'whitespace-nowrap  font-mono text-xs text-neutral-400', cell: (s) => s.externalId },
    { id: 'col2', header: '招聘会名称', cellClassName: 'font-medium text-neutral-800', cell: (s) => <><p className="line-clamp-2" title={s.name}>{s.name}</p>
                        {s.reviewStatus === 'rejected' && s.rejectReason && (
                          <p className="mt-0.5 text-xs text-error-fg">拒绝原因:{s.rejectReason}</p>
                        )}</> },
    { id: 'col3', header: '主办方', truncate: true, cellClassName: 'whitespace-nowrap  text-xs text-neutral-600', cell: (s) => s.organizer },
    { id: 'col4', header: '时间', cellClassName: 'whitespace-nowrap  text-xs text-neutral-500', cell: (s) => <><div>{formatDateTime(s.startTime)}</div>
                        <div className="text-neutral-300">至 {formatDateTime(s.endTime)}</div></> },
    { id: 'col5', header: '地点', truncate: true, cellClassName: 'text-xs text-neutral-500', cell: (s) => s.venue },
    { id: 'col6', header: '会议状态', cellClassName: '', cell: (s) => <><span className={`rounded px-2 py-0.5 text-xs font-medium ${FAIR_STATUS_STYLES[s.status]}`}>
                          {FAIR_STATUS_LABELS[s.status]}
                        </span></> },
    { id: 'col7', header: '同步时间', cellClassName: 'whitespace-nowrap  text-xs text-neutral-400', cell: (s) => formatDateTime(s.syncTime) },
    { id: 'col8', header: '审核状态', cellClassName: '', cell: (s) => <><StatusBadge dot status={REVIEW_MAP[s.reviewStatus].badge}  label={REVIEW_MAP[s.reviewStatus].label}  /></> },
    { id: 'col9', header: '发布状态', cellClassName: '', cell: (s) => <><StatusBadge dot status={PUBLISH_MAP[s.publishStatus].badge} label={PUBLISH_MAP[s.publishStatus].label} /></> },
    { id: 'col10', header: '操作', sticky: true, cellClassName: 'whitespace-nowrap', cell: (s) => <><div className="flex gap-2">
                          <button type="button" onClick={() => setViewing(s)} className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">查看</button>
                          <button
                            type="button"
                            className="rounded px-2 py-1 text-xs font-medium text-error-fg hover:bg-error-bg"
                            onClick={() => setTakedown({ targetType: 'job_fair', targetId: s.id, title: s.name, orgName: s.sourceName })}
                          >
                            紧急下架
                          </button>
                        </div></> },
  ]

  return (
    <Page
      title="招聘会信息源"
      subtitle="第三方来源招聘会查看 · 紧急下架"
    >
      <RecruitmentHostingNotice hosting={hosting} subject="招聘会" />
      {hosting.status === 'ready' && hosting.enabled && <p className="mb-4 text-xs text-neutral-500">{NO_PROXY_REVIEW_NOTE}</p>}
      {/* 来自 Excel 导入批次的上下文 banner */}
      {sourceOrgIdFilter && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning-bg px-4 py-2.5">
          <FilterIcon className="h-4 w-4 flex-shrink-0 text-warning" />
          <span className="text-sm text-warning-fg">
            正在按来源机构筛选招聘会（机构 ID：{sourceOrgIdFilter}
            {batchLabel ? ` · 来自导入文件 ${batchLabel}` : ''}
            ）。招聘会记录没有批次 ID，无法按 Excel 批次精确过滤。
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {REVIEW_FILTERS.map((f) => (
            <FilterChip
              key={f}
              active={reviewFilter === f}
              label={f}
              onClick={() => { setReviewFilter(f); setPage(1) }}
            />
          ))}
        </div>
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索招聘会名称…"
            className="h-8 w-56 rounded-lg border border-neutral-200 bg-surface pl-8 pr-3 text-xs text-neutral-700 placeholder:text-neutral-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200"
          />
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <ConsoleTable items={sources} columns={columns}
          empty={{ title: search ? '未找到匹配的招聘会' : '该分类暂无招聘会数据', description: search ? '请尝试其他关键词' : undefined }}
          page={page} pageSize={pageSize} total={total} onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1) }} />
      </Card>

      <p className="mt-3 text-xs text-neutral-400">
        仅展示第三方平台同步的招聘会信息，不参与招聘闭环。紧急下架只能下架、不能恢复，须写明事由，并会通知所属机构。
      </p>

      <EmergencyTakedownDialog target={takedown} onClose={() => setTakedown(null)} onDone={reload} />

      <Drawer
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title="招聘会来源详情"
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
            <DetailRow label="来源签到链接" value={viewing.checkinUrl ? <a href={viewing.checkinUrl} target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">查看来源签到入口</a> : '未配置'} />
            <DetailRow label="招聘会名称" value={viewing.name} />
            <DetailRow label="主办方" value={viewing.organizer} />
            <DetailRow label="开始时间" value={formatDateTime(viewing.startTime)} />
            <DetailRow label="结束时间" value={formatDateTime(viewing.endTime)} />
            <DetailRow label="举办场馆" value={viewing.venue} />
            <DetailRow label="活动状态" value={FAIR_STATUS_LABELS[viewing.status]} />
            <DetailRow label="参展企业数" value={viewing.boothCount !== undefined ? String(viewing.boothCount) : undefined} />
            <DetailRow label="描述" value={viewing.description} />
            <DetailRow label="同步时间" value={formatDateTime(viewing.syncTime)} />
            <DetailRow label="审核状态" value={REVIEW_MAP[viewing.reviewStatus].label} />
            <DetailRow label="发布状态" value={PUBLISH_MAP[viewing.publishStatus].label} />
            {viewing.reviewStatus === 'rejected' && viewing.rejectReason ? (
              <DetailRow label="拒绝原因" value={viewing.rejectReason} />
            ) : null}
            <p className="mt-4 text-xs text-neutral-400">仅展示第三方来源数据，不参与招聘闭环。资料打印由一体机现场提供；本平台不代审、不代发，此处只供查看与紧急下架。</p>
          </div>
        )}
      </Drawer>
    </Page>
  )
}
