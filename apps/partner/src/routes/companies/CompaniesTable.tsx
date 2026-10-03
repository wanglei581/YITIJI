import { Card, ConsoleTable, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import { formatCount, formatDateTime } from '@ai-job-print/shared'
import type { PartnerCompanyRecord } from '../../services/api/partnerCompanies'
import { RejectReason } from '../../components/RejectReason'
import type { ReviewStatus, PublishStatus } from '../../services/api'
import { COMPANY_TYPES, COMPANY_INDUSTRIES } from '@ai-job-print/shared'

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
  draft: { dot: 'bg-orange-400', label: '草稿' },
  published: { dot: 'bg-green-500', label: '已发布' },
  unpublished: { dot: 'bg-neutral-300', label: '已下架' },
  expired: { dot: 'bg-neutral-300', label: '已过期' },
}

function industryLabel(v: string | null): string {
  if (!v) return ''
  return (COMPANY_INDUSTRIES as Record<string, string>)[v] ?? v
}

function companyTypeLabel(v: string | null): string {
  if (!v) return ''
  return (COMPANY_TYPES as Record<string, string>)[v] ?? v
}

function regionText(c: PartnerCompanyRecord): string {
  return [c.province, c.city, c.district].filter(Boolean).join(' / ')
}

function fmtTime(iso: string): string {
  return formatDateTime(iso, { fallback: iso })
}

// ─── Form ─────────────────────────────────────────────────────────────────────

interface Props {
  rows: PartnerCompanyRecord[]
  hasAny: boolean
  openEdit: (row: PartnerCompanyRecord) => void
  setConfirmUnpublish: (row: PartnerCompanyRecord) => void
}

export function CompaniesTable({ rows, hasAny, openEdit, setConfirmUnpublish }: Props) {
  const columns: ConsoleColumn<PartnerCompanyRecord>[] = [
    {
      id: 'col0',
      header: '外部编号',
      truncate: true,
      cellClassName: 'whitespace-nowrap  font-mono text-xs text-neutral-400',
      cell: (c) => c.externalId,
    },
    {
      id: 'col1',
      header: '企业名称',
      truncate: true,
      cellClassName: 'font-medium text-neutral-800',
      cell: (c) => c.name,
    },
    {
      id: 'col2',
      header: '行业',
      truncate: true,
      cellClassName: 'whitespace-nowrap  text-xs text-neutral-600',
      cell: (c) => industryLabel(c.industry) || '—',
    },
    {
      id: 'col3',
      header: '企业类型',
      truncate: true,
      cellClassName: 'whitespace-nowrap  text-xs text-neutral-600',
      cell: (c) => companyTypeLabel(c.companyType) || '—',
    },
    {
      id: 'col4',
      header: '地区',
      truncate: true,
      cellClassName: 'whitespace-nowrap  text-xs text-neutral-500',
      cell: (c) => regionText(c) || '—',
    },
    {
      id: 'col5',
      header: '招聘会参展',
      truncate: true,
      cellClassName: 'whitespace-nowrap  text-xs text-neutral-600',
      cell: (c) => (c.fairParticipant ? '参展' : '—'),
    },
    {
      id: 'col6',
      header: '关联岗位数',
      align: 'right',
      cellClassName: 'whitespace-nowrap  text-xs text-neutral-600',
      cell: (c) => formatCount(c.linkedJobCount),
    },
    {
      id: 'col7',
      header: '同步时间',
      cellClassName: 'whitespace-nowrap  text-xs text-neutral-400',
      cell: (c) => fmtTime(c.syncTime),
    },
    {
      id: 'col8',
      header: '审核状态',
      cellClassName: '',
      cell: (c) => (
        <>
          <StatusBadge
            dot
            status={REVIEW_MAP[c.reviewStatus].badge}
            label={REVIEW_MAP[c.reviewStatus].label}
          />
          <RejectReason reviewStatus={c.reviewStatus} reason={c.rejectReason} />
        </>
      ),
    },
    {
      id: 'col9',
      header: '发布状态',
      cellClassName: '',
      cell: (c) => (
        <>
          <span className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
            <span
              className={`h-1.5 w-1.5 rounded-full ${PUBLISH_MAP[c.publishStatus].dot}`}
              aria-hidden="true"
            />
            {PUBLISH_MAP[c.publishStatus].label}
          </span>
        </>
      ),
    },
    {
      id: 'col10',
      header: '操作',
      sticky: true,
      cellClassName: 'whitespace-nowrap',
      cell: (c) => (
        <>
          <div className="flex gap-2">
            <button
              className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
              onClick={() => openEdit(c)}
            >
              编辑
            </button>
            {c.publishStatus === 'published' && (
              <button
                className="rounded px-2 py-1 text-xs font-medium text-warning-fg hover:bg-warning-bg"
                onClick={() => setConfirmUnpublish(c)}
              >
                下架
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
        empty={{
          title: hasAny ? '当前筛选条件下无企业' : '暂无匹配的企业资料',
          description: '可调整审核状态；新增企业仍从右上角录入本机构来源的展示信息。',
        }}
        page={1}
        pageSize={Math.max(rows.length, 1)}
        total={rows.length}
        onPageChange={() => undefined}
      />
    </Card>
  )
}
