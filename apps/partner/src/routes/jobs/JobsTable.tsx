import { Card, ConsoleTable, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import { formatDateTime } from '@ai-job-print/shared'
import type { PartnerJobRecord, JobCategory, ReviewStatus, PublishStatus } from '../../services/api'
import { RejectReason } from '../../components/RejectReason'

const CATEGORY_MAP: Record<JobCategory, { label: string; style: string }> = {
  fulltime: { label: '全职', style: 'bg-blue-50 text-blue-700' },
  intern: { label: '实习', style: 'bg-violet-50 text-violet-700' },
  campus: { label: '校招', style: 'bg-emerald-50 text-emerald-700' },
  parttime: { label: '兼职', style: 'bg-orange-50 text-orange-700' },
}

const REVIEW_MAP: Record<
  ReviewStatus,
  { badge: 'warning' | 'info' | 'success' | 'error'; label: string }
> = {
  pending: { badge: 'warning', label: '待审核' },
  reviewing: { badge: 'info', label: '审核中' },
  approved: { badge: 'success', label: '已通过' },
  rejected: { badge: 'error', label: '已拒绝' },
}

const PUBLISH_MAP: Record<PublishStatus, { dot: string; label: string }> = {
  draft: { dot: 'bg-warning', label: '待发布' },
  published: { dot: 'bg-success', label: '已发布' },
  unpublished: { dot: 'bg-neutral-300', label: '已下架' },
  expired: { dot: 'bg-neutral-300', label: '已过期' },
}

interface Props {
  rows: PartnerJobRecord[]
  openEdit: (row: PartnerJobRecord) => void
  setConfirmUnpublish: (row: PartnerJobRecord) => void
  page: number
  total: number
  onPageChange: (page: number) => void
  busyId: string | null
}

export function JobsTable({
  rows,
  openEdit,
  setConfirmUnpublish,
  page,
  total,
  onPageChange,
  busyId,
}: Props) {
  const columns: ConsoleColumn<PartnerJobRecord>[] = [
    {
      id: 'col0',
      header: '外部编号',
      truncate: true,
      cellClassName: 'whitespace-nowrap  font-mono text-xs text-neutral-400',
      cell: (j) => j.externalId,
    },
    {
      id: 'col1',
      header: '岗位标题',
      truncate: true,
      cellClassName: 'font-medium text-neutral-800',
      cell: (j) => j.title,
    },
    {
      id: 'col2',
      header: '公司',
      truncate: true,
      cellClassName: 'whitespace-nowrap  text-xs text-neutral-600',
      cell: (j) => j.company,
    },
    {
      id: 'col3',
      header: '城市',
      cellClassName: 'whitespace-nowrap  text-xs text-neutral-500',
      cell: (j) => j.city,
    },
    {
      id: 'col4',
      header: '类型',
      cellClassName: '',
      cell: (j) => (
        <>
          {CATEGORY_MAP[j.category!] ? (
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${CATEGORY_MAP[j.category!].style}`}
            >
              {CATEGORY_MAP[j.category!].label}
            </span>
          ) : (
            <span className="text-neutral-300">—</span>
          )}
        </>
      ),
    },
    {
      id: 'col5',
      header: '来源链接',
      cellClassName: 'whitespace-nowrap  font-mono text-xs text-primary-600',
      cell: (j) => (
        <>
          <a href={j.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
            查看来源
          </a>
        </>
      ),
    },
    {
      id: 'col6',
      header: '同步时间',
      cellClassName: 'whitespace-nowrap  text-xs text-neutral-400',
      cell: (j) => formatDateTime(j.syncTime),
    },
    {
      id: 'col7',
      header: '审核状态',
      cellClassName: '',
      cell: (j) => (
        <>
          <StatusBadge
            dot
            status={REVIEW_MAP[j.reviewStatus].badge}
            label={REVIEW_MAP[j.reviewStatus].label}
          />
          <RejectReason reviewStatus={j.reviewStatus} reason={j.rejectReason} />
        </>
      ),
    },
    {
      id: 'col8',
      header: '发布状态',
      cellClassName: '',
      cell: (j) => (
        <>
          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
            <span
              className={`h-1.5 w-1.5 rounded-full ${PUBLISH_MAP[j.publishStatus].dot}`}
              aria-hidden="true"
            />
            {PUBLISH_MAP[j.publishStatus].label}
          </span>
        </>
      ),
    },
    {
      id: 'col9',
      header: '操作',
      sticky: true,
      cellClassName: 'whitespace-nowrap',
      cell: (j) => (
        <>
          <div className="flex gap-2">
            <button
              className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
              onClick={() => openEdit(j)}
            >
              编辑
            </button>
            {j.publishStatus === 'published' && (
              <button
                disabled={busyId === j.id}
                className="rounded px-2 py-1 text-xs font-medium text-warning-fg hover:bg-warning-bg"
                onClick={() => setConfirmUnpublish(j)}
              >
                {busyId === j.id ? '处理中…' : '下架'}
              </button>
            )}
          </div>
        </>
      ),
    },
  ]
  return (
    <Card className="overflow-hidden p-0">
      <ConsoleTable
        items={rows}
        columns={columns}
        empty={{ title: '当前筛选条件下无岗位', description: '请调整筛选条件后重试。' }}
        page={page}
        pageSize={20}
        total={total}
        onPageChange={onPageChange}
      />
    </Card>
  )
}
