import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDateTime, formatCount } from '@ai-job-print/shared'
import { Card, ConsoleTable, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import { Page } from '../Page'
import { SearchIcon } from 'lucide-react'
import type { AdminImportBatch } from '../../services/api'
import { getImportBatches } from '../../services/api'
import { useRecruitmentHosting } from '../components/recruitment/useRecruitmentHosting'
import { RecruitmentHostingNotice } from '../components/recruitment/RecruitmentHostingNotice'

// ─── Display maps ─────────────────────────────────────────────────────────────

type BatchStatus = AdminImportBatch['status']

const STATUS_MAP: Record<BatchStatus, { badge: 'success' | 'warning' | 'error' | 'default'; label: string }> = {
  pending:   { badge: 'warning', label: '待确认' },
  confirmed: { badge: 'success', label: '已确认' },
  cancelled: { badge: 'default', label: '已取消' },
  failed:    { badge: 'error',   label: '失败'   },
}

const DATA_TYPE_LABEL: Record<'job' | 'fair', string> = {
  job:  '岗位',
  fair: '招聘会',
}

const STATUS_FILTERS = ['全部', '待确认', '已确认', '已取消', '失败'] as const
const STATUS_FILTER_MAP: Record<string, BatchStatus | null> = {
  全部: null, 待确认: 'pending', 已确认: 'confirmed', 已取消: 'cancelled', 失败: 'failed',
}

const DATA_TYPE_FILTERS = ['全部', '岗位', '招聘会'] as const
const DATA_TYPE_FILTER_MAP: Record<string, 'job' | 'fair' | null> = {
  全部: null, 岗位: 'job', 招聘会: 'fair',
}

const PAGE_SIZE = 15

function fmtDate(iso: string | null): string {
  return formatDateTime(iso)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ImportBatchesPage() {
  const navigate = useNavigate()

  const [reloadKey, setReloadKey] = useState(0)
  const [batches,     setBatches]     = useState<AdminImportBatch[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(false)
  const [search,      setSearch]      = useState('')
  const [statusFlt,   setStatusFlt]   = useState('全部')
  const [typeFlt,     setTypeFlt]     = useState('全部')
  const [page,        setPage]        = useState(1)
  // 本页本来只读（没有导入 / 确认 / 撤回按钮）。托管关闭时如实说明导入已停止，
  // 处置入口在两个信息源页（逐条紧急下架）与数据接入通道（按来源熔断）；这里不做按批次的批量下架。
  const hosting = useRecruitmentHosting()
  const hostingOff = hosting.status === 'ready' && !hosting.enabled
  const hostingOn = hosting.status === 'ready' && hosting.enabled
  // 开关没读到时两种说法都不下：既不说「导入已停止」，也不说导入后怎样。
  // 3.15：托管打开时管理员同样不再审核发布导入内容（信息源页只留查看与紧急下架），这里不能再说「在信息源中审核发布」。
  const footnote = hostingOff
    ? '机构的 Excel 导入已停止，这里只保留历史批次。要处置某条内容，点「查看岗位 / 查看招聘会」到对应信息源页做紧急下架；要整体停用一个来源，到「数据接入通道」按来源熔断。'
    : hostingOn
      ? '导入后数据默认"待审核 + 草稿"。本平台不代审、不代发导入的岗位与招聘会；要处置某条内容，点「查看岗位 / 查看招聘会」到对应信息源页做紧急下架。'
      : null

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getImportBatches()
      .then((data) => { if (!cancelled) setBatches(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadKey])

  // ── Filter chain ─────────────────────────────────────────────────────────────

  const byStatus = STATUS_FILTER_MAP[statusFlt]
    ? batches.filter((b) => b.status === STATUS_FILTER_MAP[statusFlt])
    : batches

  const byType = DATA_TYPE_FILTER_MAP[typeFlt]
    ? byStatus.filter((b) => b.dataType === DATA_TYPE_FILTER_MAP[typeFlt])
    : byStatus

  const searched = search.trim()
    ? byType.filter((b) =>
        b.fileName.includes(search) ||
        b.orgName.includes(search) ||
        b.sourceName.includes(search)
      )
    : byType

  const total  = searched.length
  const paged  = searched.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const counts: Record<string, number> = {
    全部:   batches.length,
    待确认: batches.filter((b) => b.status === 'pending').length,
    已确认: batches.filter((b) => b.status === 'confirmed').length,
    已取消: batches.filter((b) => b.status === 'cancelled').length,
    失败:   batches.filter((b) => b.status === 'failed').length,
  }

  const handleStatusChange = (f: string) => { setStatusFlt(f); setPage(1) }
  const handleTypeChange   = (f: string) => { setTypeFlt(f);   setPage(1) }
  const handleSearch       = (v: string) => { setSearch(v);    setPage(1) }

  // ── Render ───────────────────────────────────────────────────────────────────

  const columns: ConsoleColumn<AdminImportBatch>[] = [
    { id: 'org', header: '机构', truncate: true, cell: (b) => b.orgName },
    { id: 'source', header: '数据源', truncate: true, cell: (b) => b.sourceName },
    { id: 'file', header: '文件名', truncate: true, cell: (b) => b.fileName },
    { id: 'type', header: '类型', cellClassName: 'whitespace-nowrap', cell: (b) => DATA_TYPE_LABEL[b.dataType] },
    { id: 'total', header: '总行数', align: 'right', cell: (b) => formatCount(b.totalRows) },
    { id: 'valid', header: '有效', align: 'right', cellClassName: 'text-success-fg', cell: (b) => formatCount(b.validRows) },
    { id: 'invalid', header: '无效', align: 'right', cellClassName: 'text-error-fg', cell: (b) => formatCount(b.invalidRows) },
    { id: 'duplicate', header: '重复', align: 'right', cellClassName: 'text-warning-fg', cell: (b) => formatCount(b.dupRows) },
    { id: 'status', header: '状态', cell: (b) => <StatusBadge dot status={STATUS_MAP[b.status].badge} label={STATUS_MAP[b.status].label} /> },
    { id: 'created', header: '创建时间', cellClassName: 'whitespace-nowrap tabular-nums', cell: (b) => fmtDate(b.createdAt) },
    { id: 'confirmed', header: '确认时间', cellClassName: 'whitespace-nowrap tabular-nums', cell: (b) => fmtDate(b.confirmedAt) },
    { id: 'actions', header: '操作', sticky: true, align: 'right', cell: (b) => <button type="button"
      className="whitespace-nowrap rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
      onClick={() => navigate(b.dataType === 'job'
        ? `/job-sources?sourceId=${encodeURIComponent(b.sourceId)}&batchLabel=${encodeURIComponent(b.fileName)}&filterScope=source`
        : `/fair-sources?sourceOrgId=${encodeURIComponent(b.orgId)}&batchLabel=${encodeURIComponent(b.fileName)}&filterScope=org`)}>
      查看{DATA_TYPE_LABEL[b.dataType]}
    </button> },
  ]

  return (
    <Page
      title="Excel 导入记录"
      subtitle={hostingOff
        ? '合作机构 Excel 批量导入的历史批次（导入已停止，只读）'
        : hostingOn
          ? '合作机构 Excel 批量导入的历史批次（本平台不代审、不代发）'
          : '合作机构 Excel 批量导入的历史批次'}
    >
      <RecruitmentHostingNotice
        hosting={hosting}
        detail="机构的 Excel 导入已停止，本平台也不代审、不代发导入的岗位与招聘会。本页只保留历史批次，供查看与追溯。"
      />

      {/* 搜索 + 状态筛选 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="搜索文件名、机构名、数据源…"
            className="h-9 w-72 rounded-lg border border-neutral-200 bg-surface pl-9 pr-3 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20"
          />
        </div>

        {/* 状态筛选 */}
        <div className="flex gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => handleStatusChange(f)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                statusFlt === f ? 'border-primary-600 bg-primary-600 text-white' : 'border-neutral-900/10 bg-surface text-neutral-700 hover:border-primary-600/40'
              }`}
            >
              {f}
              <span className="ml-1 text-xs opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>

        {/* 数据类型筛选 */}
        <div className="flex gap-2">
          {DATA_TYPE_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => handleTypeChange(f)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                typeFlt === f ? 'bg-neutral-800 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <ConsoleTable items={paged} columns={columns} loading={loading}
          error={error ? { message: '加载失败，请重试', onRetry: () => setReloadKey((key) => key + 1) } : null}
          empty={{ title: '暂无导入记录', description: search ? `未找到包含"${search}"的导入批次` : '当前筛选条件下没有导入记录' }}
          total={total} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </Card>

      {footnote && <p className="mt-3 text-xs text-neutral-400">{footnote}</p>}
    </Page>
  )
}
