import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, EmptyState, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { FileSpreadsheetIcon, SearchIcon } from 'lucide-react'
import type { AdminImportBatch } from '../../services/api'
import { getImportBatches } from '../../services/api'
import { Pagination } from '../components/DataTable'

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
  if (!iso) return '—'
  return iso.replace('T', ' ').slice(0, 16)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ImportBatchesPage() {
  const navigate = useNavigate()

  const [batches,     setBatches]     = useState<AdminImportBatch[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(false)
  const [search,      setSearch]      = useState('')
  const [statusFlt,   setStatusFlt]   = useState('全部')
  const [typeFlt,     setTypeFlt]     = useState('全部')
  const [page,        setPage]        = useState(1)

  useEffect(() => {
    let cancelled = false
    getImportBatches()
      .then((data) => { if (!cancelled) setBatches(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

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

  if (loading) {
    return (
      <Page title="Excel 导入记录" subtitle="合作机构 Excel 批量导入的历史批次">
        <Card className="flex h-40 items-center justify-center">
          <span className="text-sm text-neutral-400">加载中…</span>
        </Card>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="Excel 导入记录" subtitle="合作机构 Excel 批量导入的历史批次">
        <Card className="flex h-40 items-center justify-center">
          <span className="text-sm text-red-500">加载失败，请刷新重试</span>
        </Card>
      </Page>
    )
  }

  return (
    <Page title="Excel 导入记录" subtitle="合作机构 Excel 批量导入的历史批次，确认后进入审核队列">

      {/* 搜索 + 状态筛选 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="搜索文件名、机构名、数据源…"
            className="h-9 w-72 rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20"
          />
        </div>

        {/* 状态筛选 */}
        <div className="flex gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => handleStatusChange(f)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                statusFlt === f ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
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
        {paged.length === 0 ? (
          <EmptyState
            title="暂无导入记录"
            description={
              search
                ? `未找到包含"${search}"的导入批次`
                : '当前筛选条件下没有导入记录'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-100 bg-neutral-50">
                <tr>
                  {['机构', '数据源', '文件名', '类型', '总行数', '有效', '无效', '重复', '状态', '创建时间', '确认时间', '操作'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-neutral-500">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {paged.map((b) => {
                  const s = STATUS_MAP[b.status]
                  return (
                    <tr key={b.id} className="hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-neutral-800">
                        {b.orgName}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                        {b.sourceName}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <FileSpreadsheetIcon className="h-3.5 w-3.5 flex-shrink-0 text-green-500" />
                          <span className="max-w-[200px] truncate text-xs text-neutral-700" title={b.fileName}>
                            {b.fileName}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          b.dataType === 'job'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-purple-50 text-purple-700'
                        }`}>
                          {DATA_TYPE_LABEL[b.dataType]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-sm font-medium text-neutral-700">
                        {b.totalRows}
                      </td>
                      <td className="px-4 py-3 text-center text-sm font-medium text-green-600">
                        {b.validRows}
                      </td>
                      <td className="px-4 py-3 text-center text-sm font-medium text-red-500">
                        {b.invalidRows > 0 ? b.invalidRows : <span className="text-neutral-300">0</span>}
                      </td>
                      <td className="px-4 py-3 text-center text-sm font-medium text-amber-500">
                        {b.dupRows > 0 ? b.dupRows : <span className="text-neutral-300">0</span>}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={s.badge} label={s.label} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                        {fmtDate(b.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                        {fmtDate(b.confirmedAt)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <button
                          className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                          onClick={() => navigate(
                            b.dataType === 'job'
                              ? `/job-sources?search=${encodeURIComponent(b.orgName)}`
                              : `/fair-sources?search=${encodeURIComponent(b.orgName)}`
                          )}
                        >
                          查看{DATA_TYPE_LABEL[b.dataType]}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          total={total}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          onPageSizeChange={() => setPage(1)}
        />
      </Card>

      <p className="mt-3 text-xs text-neutral-400">
        导入后数据默认"待审核 + 草稿"，需在岗位信息源或招聘会信息源中审核发布后才会在 Kiosk 展示
      </p>
    </Page>
  )
}
