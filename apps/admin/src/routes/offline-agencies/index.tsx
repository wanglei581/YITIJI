import { useCallback, useEffect, useState } from 'react'
import { Card, EmptyState, StatusBadge } from '@ai-job-print/ui'
import { BuildingIcon, PlusIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { Page } from '../Page'
import { AgencyForm } from './AgencyForm'
import { JobsDrawer } from './JobsDrawer'
import { ReviewDialog } from './ReviewDialog'
import {
  offlineAgenciesAdminService,
  ORG_TYPE_LABELS,
  type AdminOfflineAgencyDetail,
  type AdminOfflineAgencyListItem,
  type OfflineAgencyListFilters,
} from '../../services/api/offlineAgenciesAdmin'
import { Pagination, useTableState } from '../components/DataTable'

// ─── 展示常量 ─────────────────────────────────────────────────────────────────

const REVIEW_BADGE: Record<string, { status: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  pending:   { status: 'warning', label: '待审核' },
  reviewing: { status: 'info',    label: '审核中' },
  approved:  { status: 'success', label: '已通过' },
  rejected:  { status: 'error',   label: '已驳回' },
}

const PUBLISH_BADGE: Record<string, { status: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  draft:       { status: 'default', label: '草稿' },
  published:   { status: 'success', label: '已发布' },
  unpublished: { status: 'warning', label: '已下架' },
  expired:     { status: 'default', label: '已过期' },
}

const ORG_TYPE_FILTER_OPTIONS = [
  { value: '', label: '全部类型' },
  ...Object.entries(ORG_TYPE_LABELS).map(([v, l]) => ({ value: v, label: l })),
]

const REVIEW_FILTER_OPTIONS = [
  { value: '', label: '全部审核状态' },
  { value: 'pending',   label: '待审核' },
  { value: 'reviewing', label: '审核中' },
  { value: 'approved',  label: '已通过' },
  { value: 'rejected',  label: '已驳回' },
]

const PUBLISH_FILTER_OPTIONS = [
  { value: '', label: '全部发布状态' },
  { value: 'draft',       label: '草稿' },
  { value: 'published',   label: '已发布' },
  { value: 'unpublished', label: '已下架' },
]

const selectCls =
  'rounded-lg border border-neutral-200 bg-surface px-3 py-2 text-sm text-neutral-700 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

// ─── Component ───────────────────────────────────────────────────────────────

export default function OfflineAgenciesPage() {
  const [rows,         setRows]         = useState<AdminOfflineAgencyListItem[]>([])
  const [listState,    setListState]    = useState<'loading' | 'error' | 'ready'>('loading')
  const [orgType,      setOrgType]      = useState('')
  const [reviewStatus, setReviewStatus] = useState('')
  const [publishStatus,setPublishStatus]= useState('')
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword,      setKeyword]      = useState('')

  // 表单 Drawer
  const [formOpen,     setFormOpen]     = useState(false)
  const [editingDetail,setEditingDetail]= useState<AdminOfflineAgencyDetail | null>(null)

  // 岗位管理 Drawer
  const [jobsOpen,     setJobsOpen]     = useState(false)
  const [jobsAgency,   setJobsAgency]   = useState<{ id: string; name: string } | null>(null)

  // 审核 Dialog
  const [reviewOpen,   setReviewOpen]   = useState(false)
  const [reviewTarget, setReviewTarget] = useState<AdminOfflineAgencyListItem | null>(null)

  // 删除中
  const [deletingId,   setDeletingId]   = useState<string | null>(null)

  const { page, pageSize, setPage, setPageSize } = useTableState(20)

  const loadList = useCallback(async () => {
    setListState('loading')
    const filters: OfflineAgencyListFilters = {
      orgType: orgType || undefined,
      reviewStatus: reviewStatus || undefined,
      publishStatus: publishStatus || undefined,
      keyword: keyword || undefined,
    }
    try {
      const data = await offlineAgenciesAdminService.listAgencies(filters)
      setRows(data)
      setListState('ready')
    } catch {
      setListState('error')
    }
  }, [orgType, reviewStatus, publishStatus, keyword])

  useEffect(() => { void loadList() }, [loadList])

  // ── 操作回调 ──────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingDetail(null)
    setFormOpen(true)
  }

  const openEdit = async (id: string) => {
    try {
      const detail = await offlineAgenciesAdminService.getAgency(id)
      setEditingDetail(detail)
      setFormOpen(true)
    } catch {
      alert('获取机构详情失败，请重试')
    }
  }

  const openReview = (row: AdminOfflineAgencyListItem) => {
    setReviewTarget(row)
    setReviewOpen(true)
  }

  const openJobs = (row: AdminOfflineAgencyListItem) => {
    setJobsAgency({ id: row.id, name: row.name })
    setJobsOpen(true)
  }

  const handlePublish = async (id: string) => {
    try {
      await offlineAgenciesAdminService.publishAgency(id, true)
      void loadList()
    } catch (e) {
      alert(e instanceof Error ? e.message : '发布失败')
    }
  }

  const handleUnpublish = async (id: string) => {
    try {
      await offlineAgenciesAdminService.publishAgency(id, false)
      void loadList()
    } catch (e) {
      alert(e instanceof Error ? e.message : '下架失败')
    }
  }

  const handleDelete = async (row: AdminOfflineAgencyListItem) => {
    if (!window.confirm(`确定删除机构「${row.name}」？此操作不可撤销。`)) return
    setDeletingId(row.id)
    try {
      await offlineAgenciesAdminService.deleteAgency(row.id)
      void loadList()
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeletingId(null)
    }
  }

  const handleReviewApprove = async () => {
    if (!reviewTarget) return
    await offlineAgenciesAdminService.reviewAgency(reviewTarget.id, 'approve')
    void loadList()
  }

  const handleReviewReject = async (reason: string) => {
    if (!reviewTarget) return
    await offlineAgenciesAdminService.reviewAgency(reviewTarget.id, 'reject', reason)
    void loadList()
  }

  // ── 分页 ──────────────────────────────────────────────────────────────────

  const total     = rows.length
  const paginated = rows.slice((page - 1) * pageSize, page * pageSize)

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Page
      title="线下机构管理"
      subtitle="线下招聘机构信息管理 — 审核 · 发布 · 岗位维护（仅信息展示，不参与招聘闭环）"
      actions={
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
        >
          <PlusIcon className="h-4 w-4" />
          新建机构
        </button>
      }
    >
      {/* 筛选条 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select className={selectCls} value={orgType} onChange={(e) => { setOrgType(e.target.value); setPage(1) }}>
          {ORG_TYPE_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className={selectCls} value={reviewStatus} onChange={(e) => { setReviewStatus(e.target.value); setPage(1) }}>
          {REVIEW_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className={selectCls} value={publishStatus} onChange={(e) => { setPublishStatus(e.target.value); setPage(1) }}>
          {PUBLISH_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex flex-1 gap-2 sm:max-w-sm">
          <div className="relative flex-1">
            <input
              className="w-full rounded-lg border border-neutral-200 bg-surface py-2 pl-8 pr-3 text-sm text-neutral-700 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="按机构名搜索"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { setKeyword(keywordInput.trim()); setPage(1) } }}
            />
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
          </div>
          <button
            onClick={() => { setKeyword(keywordInput.trim()); setPage(1) }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 bg-surface px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            <SearchIcon className="h-4 w-4" />
            搜索
          </button>
        </div>
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['机构名称', '类型', '地址', '联系人', '审核状态', '发布状态', '岗位数', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {listState === 'loading' && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-neutral-400">加载中…</td>
                </tr>
              )}
              {listState === 'error' && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-red-500">加载失败，请刷新重试</td>
                </tr>
              )}
              {listState === 'ready' && paginated.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="暂无线下机构"
                      description="点击右上角「新建机构」添加"
                      icon={BuildingIcon}
                      className="py-14"
                    />
                  </td>
                </tr>
              )}
              {listState === 'ready' && paginated.map((row) => {
                const rv = REVIEW_BADGE[row.reviewStatus]
                const pv = PUBLISH_BADGE[row.publishStatus]
                const canPublish   = row.reviewStatus === 'approved' && row.publishStatus !== 'published'
                const canUnpublish = row.publishStatus === 'published'
                return (
                  <tr key={row.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-800">{row.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
                      {ORG_TYPE_LABELS[row.orgType] ?? row.orgType}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-xs text-neutral-500" title={row.address ?? '—'}>
                      {row.address ?? <span className="text-neutral-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
                      {row.contactName
                        ? <span>{row.contactName}{row.contactPhone ? <span className="ml-1 text-neutral-400">{row.contactPhone}</span> : null}</span>
                        : <span className="text-neutral-300">—</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge dot status={rv?.status ?? 'default'} label={rv?.label ?? row.reviewStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge dot status={pv?.status ?? 'default'} label={pv?.label ?? row.publishStatus} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
                      <button
                        onClick={() => openJobs(row)}
                        className="rounded px-1.5 py-0.5 text-primary-600 hover:bg-primary-50"
                        title="管理岗位"
                      >
                        {row.jobCount} 个
                      </button>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => void openEdit(row.id)}
                          className="rounded px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
                        >
                          编辑
                        </button>
                        {row.reviewStatus !== 'approved' && (
                          <button
                            onClick={() => openReview(row)}
                            className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                          >
                            审核
                          </button>
                        )}
                        {row.reviewStatus === 'approved' && row.publishStatus !== 'published' && (
                          <button
                            onClick={() => openReview(row)}
                            className="rounded px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100"
                          >
                            审核
                          </button>
                        )}
                        {canPublish && (
                          <button
                            onClick={() => void handlePublish(row.id)}
                            className="rounded px-2 py-1 text-xs font-medium text-success-fg hover:bg-success-bg"
                          >
                            发布
                          </button>
                        )}
                        {canUnpublish && (
                          <button
                            onClick={() => void handleUnpublish(row.id)}
                            className="rounded px-2 py-1 text-xs font-medium text-warning-fg hover:bg-warning-bg"
                          >
                            下架
                          </button>
                        )}
                        <button
                          onClick={() => void handleDelete(row)}
                          disabled={deletingId === row.id}
                          className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                          title="删除"
                        >
                          <Trash2Icon className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Pagination
          total={total}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1) }}
        />
      </Card>

      <p className="mt-3 text-xs text-neutral-400">
        线下机构仅作信息展示，不参与简历投递或招聘闭环。
      </p>

      {/* 新建/编辑抽屉 */}
      <AgencyForm
        open={formOpen}
        editing={editingDetail}
        onClose={() => setFormOpen(false)}
        onSaved={() => void loadList()}
      />

      {/* 岗位管理抽屉 */}
      <JobsDrawer
        open={jobsOpen}
        agencyId={jobsAgency?.id ?? null}
        agencyName={jobsAgency?.name ?? ''}
        onClose={() => setJobsOpen(false)}
        onJobCountChange={(count) => {
          if (jobsAgency) {
            setRows((prev) => prev.map((r) => r.id === jobsAgency.id ? { ...r, jobCount: count } : r))
          }
        }}
      />

      {/* 审核对话框 */}
      <ReviewDialog
        open={reviewOpen}
        agencyName={reviewTarget?.name ?? ''}
        currentStatus={reviewTarget?.reviewStatus ?? 'pending'}
        onClose={() => { setReviewOpen(false); setReviewTarget(null) }}
        onApprove={handleReviewApprove}
        onReject={handleReviewReject}
      />
    </Page>
  )
}
