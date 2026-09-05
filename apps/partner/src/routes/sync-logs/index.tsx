import { useEffect, useState } from 'react'
import { formatDateTime } from '@ai-job-print/shared'
import { Card, StatusBadge, LoadingState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { RefreshCwIcon } from 'lucide-react'
import type { PartnerDataSource, PartnerSyncLog, SyncDataType, SyncResult } from '../../services/api'
import { getDataSources, getSyncLogs } from '../../services/api'

// ─── Display maps ─────────────────────────────────────────────────────────────

const DATA_TYPE_MAP: Record<SyncDataType, { label: string; style: string }> = {
  job:    { label: '岗位',   style: 'bg-info-bg text-info-fg'     },
  fair:   { label: '招聘会', style: 'bg-purple-50 text-purple-600' },
  policy: { label: '政策',   style: 'bg-teal-50 text-teal-600'     },
}

const RESULT_MAP: Record<SyncResult, { badge: 'success' | 'warning' | 'error'; label: string }> = {
  success: { badge: 'success', label: '成功'    },
  partial: { badge: 'warning', label: '部分失败' },
  failed:  { badge: 'error',   label: '失败'    },
}

const RESULT_FILTERS = ['全部', '成功', '部分失败', '失败'] as const
const RESULT_FILTER_MAP: Record<string, SyncResult | null> = {
  全部: null, 成功: 'success', 部分失败: 'partial', 失败: 'failed',
}

const PAGE_SIZE = 20

// ─── Component ────────────────────────────────────────────────────────────────

export default function SyncLogsPage() {
  const [logs,         setLogs]         = useState<PartnerSyncLog[]>([])
  const [sources,      setSources]      = useState<PartnerDataSource[]>([])
  const [loading,      setLoading]      = useState(true)
  const [detail, setDetail] = useState<PartnerSyncLog | null>(null)
  const [error,        setError]        = useState(false)
  const [resultFilter, setResultFilter] = useState('全部')
  const [sourceId,     setSourceId]     = useState('')
  const [page,         setPage]         = useState(1)
  const [total,        setTotal]        = useState(0)
  const [totalPages,   setTotalPages]   = useState(1)

  useEffect(() => {
    getDataSources().then(setSources).catch(() => undefined)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getSyncLogs({
      page,
      pageSize: PAGE_SIZE,
      sourceId: sourceId || undefined,
      result: RESULT_FILTER_MAP[resultFilter] ?? undefined,
    })
      .then((res) => {
        if (cancelled) return
        setLogs(res.data)
        setTotal(res.pagination.total)
        setTotalPages(res.pagination.totalPages)
        setError(false)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [page, resultFilter, sourceId])

  if (loading && logs.length === 0) {
    return (
      <Page title="同步日志" subtitle="加载中...">
        <div className="flex h-48 items-center justify-center">
          <LoadingState text="加载中…" className="py-12" />
        </div>
      </Page>
    )
  }

  if (error && logs.length === 0) {
    return (
      <Page title="同步日志" subtitle="加载失败">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <RefreshCwIcon className="h-10 w-10 text-neutral-200" />
          <p className="text-sm text-neutral-400">加载失败，请稍后重试</p>
        </div>
      </Page>
    )
  }

  return (
    <Page title="同步日志" subtitle="数据源同步任务记录">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className="h-9 rounded-lg border border-neutral-200 bg-surface px-3 text-sm text-neutral-700"
          value={sourceId}
          onChange={(e) => { setSourceId(e.target.value); setPage(1) }}
        >
          <option value="">全部数据源</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <div className="flex gap-2">
          {RESULT_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => { setResultFilter(f); setPage(1) }}
              className={`rounded-full border px-[13px] py-1.5 text-[12.5px] font-bold transition-colors ${
                resultFilter === f ? 'border-primary-600 bg-primary-600 text-white' : 'border-neutral-900/10 bg-surface text-neutral-700 hover:border-primary-600/40'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['日志编号', '数据源', '类型', '成功数', '失败数', '重复数', '异常字段', '失败原因', '结果', '同步时间', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 bg-neutral-50/90 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-sm text-neutral-400">
                    <RefreshCwIcon className="mx-auto mb-2 h-8 w-8 text-neutral-200" />
                    当前筛选条件下无同步日志
                  </td>
                </tr>
              ) : (
                logs.map((l) => {
                  const dt  = DATA_TYPE_MAP[l.dataType] ?? DATA_TYPE_MAP.job
                  const res = RESULT_MAP[l.status]
                  return (
                    <tr key={l.id} className="hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-500">{l.no}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-700">{l.source}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${dt.style}`}>{dt.label}</span>
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-success-fg">{l.addedCount}</td>
                      <td className="px-4 py-3 text-center font-medium text-error-fg">{l.errorCount}</td>
                      <td className="px-4 py-3 text-center text-neutral-500">{l.dupCount}</td>
                      <td className="px-4 py-3 text-xs">
                        {l.errorFields
                          ? <span className="font-mono text-warning-fg">{l.errorFields}</span>
                          : <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-xs text-neutral-500">
                        {l.errorDetail
                          ? <span className="line-clamp-2 text-error-fg">{l.errorDetail}</span>
                          : <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="px-4 py-3"><StatusBadge dot status={res.badge} label={res.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-400">{formatDateTime(l.syncTime)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <button
                          className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                          onClick={() => setDetail(l)}
                        >
                          查看详情
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
        <p>共 {total} 条 · 第 {page} / {totalPages} 页</p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-neutral-200 px-3 py-1.5 disabled:opacity-40"
          >
            上一页
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-neutral-200 px-3 py-1.5 disabled:opacity-40"
          >
            下一页
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-neutral-400">
        本后台仅管理来源数据，不在本系统内接收求职者简历，不参与招聘闭环。日志编号为稳定记录 ID，不随列表位置变化。
      </p>

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true">
          <Card className="w-full max-w-lg p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-semibold text-neutral-900">同步详情 · {detail.no}</h3>
              <button type="button" onClick={() => setDetail(null)} aria-label="关闭" className="rounded p-1 text-neutral-400 hover:bg-neutral-100">✕</button>
            </div>
            <div className="space-y-2 text-sm">
              <DetailRow label="数据源" value={detail.source} />
              <DetailRow label="数据类型" value={DATA_TYPE_MAP[detail.dataType]?.label ?? detail.dataType} />
              <DetailRow label="结果" value={RESULT_MAP[detail.status]?.label ?? detail.status} />
              <DetailRow label="新增 / 更新" value={`${detail.addedCount} / ${detail.updatedCount}`} />
              <DetailRow label="失败 / 重复" value={`${detail.errorCount} / ${detail.dupCount}`} />
              <DetailRow label="同步时间" value={formatDateTime(detail.syncTime)} />
              {detail.errorFields && (
                <div>
                  <p className="mb-1 text-xs text-neutral-400">异常字段</p>
                  <code className="block break-all rounded bg-warning-bg px-3 py-2 font-mono text-xs text-warning-fg">{detail.errorFields}</code>
                </div>
              )}
              {detail.errorDetail && (
                <div>
                  <p className="mb-1 text-xs text-neutral-400">失败原因(完整)</p>
                  <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-error-bg px-3 py-2 text-xs leading-relaxed text-error-fg">{detail.errorDetail}</p>
                </div>
              )}
              <p className="pt-1 text-xs text-neutral-400">失败数据请在来源侧修正后重新导入;Excel 来源可在「数据源管理」重新上传。</p>
            </div>
          </Card>
        </div>
      )}
    </Page>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-20 shrink-0 text-xs text-neutral-400">{label}</span>
      <span className="text-xs text-neutral-700">{value}</span>
    </div>
  )
}
