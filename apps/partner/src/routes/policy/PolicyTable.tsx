import { Fragment } from 'react'
import { Card, ConsoleTable, StatusBadge } from '@ai-job-print/ui'
import { ClipboardListIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { isPolicyEmergencyHeld, type PartnerPolicyRecord } from '../../services/api/policies'
import type { ReviewStatus } from '../../services/api'
import { RejectReason } from '../../components/RejectReason'
import { PolicyEmergencyNote } from './PolicyEmergencyNote'

import { KIND_LABELS, AUDIENCE_LABELS, CATEGORY_LABELS } from './policyLabels'

const REVIEW_MAP: Record<
  string,
  { badge: 'warning' | 'info' | 'success' | 'error'; label: string }
> = {
  pending: { badge: 'warning', label: '待审核' },
  reviewing: { badge: 'info', label: '审核中' },
  approved: { badge: 'success', label: '已通过' },
  rejected: { badge: 'error', label: '已拒绝' },
}

const PUBLISH_MAP: Record<string, { badge: 'success' | 'warning' | 'default'; label: string }> = {
  draft: { badge: 'warning', label: '待发布' },
  published: { badge: 'success', label: '已发布' },
  unpublished: { badge: 'default', label: '已下架' },
  expired: { badge: 'default', label: '已过期' },
}

interface Props {
  rows: PartnerPolicyRecord[]
  page: number
  total: number
  onPageChange: (page: number) => void
  reviewFilter: string
  canCreate: boolean
  cannotCreateHint: string
  busyId: string | null
  openEdit: (row: PartnerPolicyRecord) => void
  setRulesFor: (row: PartnerPolicyRecord) => void
  handleApprove: (row: PartnerPolicyRecord) => Promise<void>
  setReleasing: (row: PartnerPolicyRecord) => void
  setConfirmUnpublish: (row: PartnerPolicyRecord) => void
  setConfirmDelete: (row: PartnerPolicyRecord) => void
}

export function PolicyTable({
  rows,
  page,
  total,
  onPageChange,
  reviewFilter,
  canCreate,
  cannotCreateHint,
  busyId,
  openEdit,
  setRulesFor,
  handleApprove,
  setReleasing,
  setConfirmUnpublish,
  setConfirmDelete,
}: Props) {
  return (
    <Card className="overflow-hidden p-0">
      <ConsoleTable
        items={rows}
        page={page}
        pageSize={20}
        total={total}
        onPageChange={onPageChange}
        empty={{
          title: reviewFilter === '全部' ? '暂无政策内容' : '当前筛选条件下无政策',
          description:
            reviewFilter === '全部'
              ? canCreate
                ? '点击右上角"新增政策内容",录入就业政策说明与公告(本机构审核通过并确认发布后在一体机展示)'
                : cannotCreateHint
              : '请调整审核状态后重试',
        }}
        renderHeader={() => (
          <tr>
            {['类型', '标题', '分组/标签', '展示日期', '审核状态', '发布状态', '操作'].map((h) => (
              <th
                key={h}
                className="whitespace-nowrap border-b border-neutral-900/10 bg-neutral-50/90 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500"
              >
                {h}
              </th>
            ))}
          </tr>
        )}
        renderRow={(r) => {
          const review = REVIEW_MAP[r.reviewStatus] ?? REVIEW_MAP.pending
          const publish = PUBLISH_MAP[r.publishStatus] ?? PUBLISH_MAP.draft
          const held = isPolicyEmergencyHeld(r)
          return (
            <Fragment key={r.id}>
              <tr className={held ? 'border-b-0 hover:bg-neutral-50' : 'hover:bg-neutral-50'}>
                <td className="whitespace-nowrap px-4 py-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${r.kind === 'policy_guide' ? 'bg-info-bg text-info-fg' : 'bg-purple-50 text-purple-600'}`}
                  >
                    {KIND_LABELS[r.kind] ?? r.kind}
                  </span>
                </td>
                <td className="min-w-56 max-w-96 px-4 py-3">
                  <p className="line-clamp-2 font-medium text-neutral-800" title={r.title}>
                    {r.title}
                  </p>
                  {r.summary && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-neutral-400" title={r.summary}>
                      {r.summary}
                    </p>
                  )}
                  {typeof r.contentVersion === 'number' && (
                    <p className="mt-0.5 text-xs text-neutral-400">
                      内容版本 v{r.contentVersion}
                      {r.publishStatus === 'published' &&
                      typeof r.publishConfirmedContentVersion === 'number'
                        ? ` · 已由本机构确认发布 v${r.publishConfirmedContentVersion}`
                        : ''}
                    </p>
                  )}
                  <RejectReason
                    reviewStatus={r.reviewStatus as ReviewStatus}
                    reason={r.rejectReason}
                  />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                  {r.kind === 'policy_guide'
                    ? r.audience
                      ? (AUDIENCE_LABELS[r.audience] ?? r.audience)
                      : '—'
                    : r.category
                      ? (CATEGORY_LABELS[r.category] ?? r.category)
                      : '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                  {r.publishedDate ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge dot status={review.badge} label={review.label} />
                </td>
                <td className="px-4 py-3">
                  {held ? (
                    <StatusBadge dot status="error" label="平台已紧急下架" />
                  ) : (
                    <StatusBadge dot status={publish.badge} label={publish.label} />
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {!held && (
                      <button
                        type="button"
                        aria-label="编辑"
                        onClick={() => openEdit(r)}
                        className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!held && r.kind === 'policy_guide' && (
                      <button
                        onClick={() => setRulesFor(r)}
                        title="录入可机械比对的申领条件"
                        className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                      >
                        <ClipboardListIcon className="h-3.5 w-3.5" />
                        申领条件
                      </button>
                    )}
                    {!held && (r.reviewStatus === 'pending' || r.reviewStatus === 'reviewing') && (
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void handleApprove(r)}
                        className="rounded px-2 py-1 text-xs font-medium text-success-fg hover:bg-success-bg disabled:opacity-50"
                      >
                        审核通过
                      </button>
                    )}
                    {!held && r.reviewStatus === 'approved' && r.publishStatus !== 'published' && (
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => setReleasing(r)}
                        className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-50"
                      >
                        发布
                      </button>
                    )}
                    {r.publishStatus === 'published' && (
                      <button
                        disabled={busyId === r.id}
                        onClick={() => setConfirmUnpublish(r)}
                        className="rounded px-2 py-1 text-xs font-medium text-warning-fg hover:bg-warning-bg disabled:opacity-50"
                      >
                        下架
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="删除"
                      disabled={busyId === r.id}
                      onClick={() => setConfirmDelete(r)}
                      className="rounded px-2 py-1 text-xs font-medium text-error-fg hover:bg-error-bg disabled:opacity-50"
                    >
                      <Trash2Icon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
              {held && (
                <tr>
                  <td colSpan={7} className="px-4 pb-3 pt-0">
                    <PolicyEmergencyNote row={r} />
                  </td>
                </tr>
              )}
            </Fragment>
          )
        }}
      />
    </Card>
  )
}
