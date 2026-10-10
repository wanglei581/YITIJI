import { Card, ConsoleTable, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import { formatDateTime } from '@ai-job-print/shared'
import type {
  PartnerFairRecord,
  JobFairStatus,
  ReviewStatus,
  PublishStatus,
} from '../../services/api'
import { RejectReason } from '../../components/RejectReason'

const FAIR_STATUS_MAP: Record<JobFairStatus, { style: string; label: string }> = {
  upcoming: { style: 'bg-info-bg text-info-fg', label: '未开始' },
  ongoing: { style: 'bg-success-bg text-success-fg', label: '进行中' },
  ended: { style: 'bg-neutral-100 text-neutral-500', label: '已结束' },
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

const PUBLISH_MAP: Record<
  PublishStatus,
  { badge: 'success' | 'warning' | 'default'; label: string }
> = {
  draft: { badge: 'warning', label: '待发布' },
  published: { badge: 'success', label: '已发布' },
  unpublished: { badge: 'default', label: '已下架' },
  expired: { badge: 'default', label: '已过期' },
}

interface Props {
  rows: PartnerFairRecord[]
  openEdit: (row: PartnerFairRecord) => void
  setConfirmUnpublish: (row: PartnerFairRecord) => void
  page: number
  total: number
  onPageChange: (page: number) => void
  busyId: string | null
  setConfiguring: (row: PartnerFairRecord) => void
}

export function FairsTable({
  rows,
  openEdit,
  setConfirmUnpublish,
  page,
  total,
  onPageChange,
  busyId,
  setConfiguring,
}: Props) {
  const columns: ConsoleColumn<PartnerFairRecord>[] = [
    {
      id: 'col0',
      header: '外部编号',
      truncate: true,
      cellClassName: 'whitespace-nowrap  font-mono text-xs text-neutral-400',
      cell: (f) => f.externalId,
    },
    {
      id: 'col1',
      header: '招聘会名称',
      truncate: true,
      cellClassName: 'font-medium text-neutral-800',
      cell: (f) => f.name,
    },
    {
      id: 'col2',
      header: '主办方',
      truncate: true,
      cellClassName: 'whitespace-nowrap  text-xs text-neutral-600',
      cell: (f) => f.organizer,
    },
    {
      id: 'col3',
      header: '时间',
      cellClassName: 'whitespace-nowrap  text-xs text-neutral-500',
      cell: (f) => (
        <>
          <div>{formatDateTime(f.startTime)}</div>
          <div className="text-neutral-300">至 {formatDateTime(f.endTime)}</div>
        </>
      ),
    },
    {
      id: 'col4',
      header: '地点',
      truncate: true,
      cellClassName: 'text-xs text-neutral-500',
      cell: (f) => f.venue,
    },
    {
      id: 'col5',
      header: '会议状态',
      cellClassName: '',
      cell: (f) => (
        <>
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${FAIR_STATUS_MAP[f.status].style}`}
          >
            {FAIR_STATUS_MAP[f.status].label}
          </span>
        </>
      ),
    },
    {
      id: 'col6',
      header: '来源预约链接',
      cellClassName: 'whitespace-nowrap  font-mono text-xs text-primary-600',
      cell: (f) => (
        <>
          <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="hover:underline">
            查看来源
          </a>
        </>
      ),
    },
    {
      id: 'col7',
      header: '来源签到链接',
      cellClassName: 'whitespace-nowrap  font-mono text-xs',
      cell: (f) => (
        <>
          {f.checkinUrl ? (
            <a
              href={f.checkinUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary-600 hover:underline"
            >
              查看签到源
            </a>
          ) : (
            <span className="text-neutral-300">未配置</span>
          )}
        </>
      ),
    },
    {
      id: 'col8',
      header: '同步时间',
      cellClassName: 'whitespace-nowrap  text-xs text-neutral-400',
      cell: (f) => formatDateTime(f.syncTime),
    },
    {
      id: 'col9',
      header: '审核状态',
      cellClassName: '',
      cell: (f) => (
        <>
          <StatusBadge
            dot
            status={REVIEW_MAP[f.reviewStatus].badge}
            label={REVIEW_MAP[f.reviewStatus].label}
          />
          <RejectReason reviewStatus={f.reviewStatus} reason={f.rejectReason} />
        </>
      ),
    },
    {
      id: 'col10',
      header: '发布状态',
      cellClassName: '',
      cell: (f) => (
        <>
          <StatusBadge
            dot
            status={PUBLISH_MAP[f.publishStatus].badge}
            label={PUBLISH_MAP[f.publishStatus].label}
          />
        </>
      ),
    },
    {
      id: 'col11',
      header: '操作',
      sticky: true,
      cellClassName: 'whitespace-nowrap',
      cell: (f) => (
        <>
          <div className="flex gap-2">
            <button
              className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
              onClick={() => openEdit(f)}
            >
              编辑
            </button>
            <button
              className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
              onClick={() => setConfiguring(f)}
            >
              配置
            </button>
            {f.publishStatus === 'published' && (
              <button
                disabled={busyId === f.id}
                className="rounded px-2 py-1 text-xs font-medium text-warning-fg hover:bg-warning-bg"
                onClick={() => setConfirmUnpublish(f)}
              >
                {busyId === f.id ? '处理中…' : '下架'}
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
        empty={{ title: '当前筛选条件下无招聘会', description: '请调整筛选条件后重试。' }}
        page={page}
        pageSize={20}
        total={total}
        onPageChange={onPageChange}
      />
    </Card>
  )
}
