import { useEffect, useState } from 'react'
import { Card, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { RefreshCwIcon } from 'lucide-react'
import type { PartnerSyncLog, SyncDataType, SyncResult } from '../../services/api'
import { getSyncLogs } from '../../services/api'

// ─── Display maps ─────────────────────────────────────────────────────────────

const DATA_TYPE_MAP: Record<SyncDataType, { label: string; style: string }> = {
  job:    { label: '岗位',   style: 'bg-blue-50 text-blue-600'     },
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function SyncLogsPage() {
  const [logs,         setLogs]         = useState<PartnerSyncLog[]>([])
  const [loading,      setLoading]      = useState(true)
  // 日志详情抽屉(审计修复:原「查看详情」死按钮)
  const [detail, setDetail] = useState<(typeof logs)[number] | null>(null)
  const [error,        setError]        = useState(false)
  const [resultFilter, setResultFilter] = useState('全部')

  useEffect(() => {
    let cancelled = false
    getSyncLogs()
      .then((data) => { if (!cancelled) setLogs(data) })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const filtered = resultFilter === '全部'
    ? logs
    : logs.filter((l) => l.status === RESULT_FILTER_MAP[resultFilter])

  const counts = {
    全部:   logs.length,
    成功:   logs.filter((l) => l.status === 'success').length,
    部分失败: logs.filter((l) => l.status === 'partial').length,
    失败:   logs.filter((l) => l.status === 'failed').length,
  }

  if (loading) {
    return (
      <Page title="同步日志" subtitle="加载中...">
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-neutral-400">加载中...</p>
        </div>
      </Page>
    )
  }

  if (error) {
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
      {/* 筛选标签 */}
      <div className="mb-4 flex gap-2">
        {RESULT_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setResultFilter(f)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              resultFilter === f ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            {f}
            <span className="ml-1.5 text-xs opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-100 bg-neutral-50">
              <tr>
                {['日志编号', '数据源', '类型', '成功数', '失败数', '重复数', '异常字段', '失败原因', '结果', '同步时间', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-sm text-neutral-400">
                    <RefreshCwIcon className="mx-auto mb-2 h-8 w-8 text-neutral-200" />
                    当前筛选条件下无同步日志
                  </td>
                </tr>
              ) : (
                filtered.map((l) => {
                  const dt  = DATA_TYPE_MAP[l.dataType]
                  const res = RESULT_MAP[l.status]
                  return (
                    <tr key={l.id} className="hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-500">{l.no}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-700">{l.source}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${dt.style}`}>{dt.label}</span>
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-green-600">{l.addedCount}</td>
                      <td className="px-4 py-3 text-center font-medium text-red-500">{l.errorCount}</td>
                      <td className="px-4 py-3 text-center text-neutral-500">{l.dupCount}</td>
                      <td className="px-4 py-3 text-xs">
                        {l.errorFields
                          ? <span className="font-mono text-orange-500">{l.errorFields}</span>
                          : <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-xs text-neutral-500">
                        {l.errorDetail
                          ? <span className="line-clamp-2 text-red-500">{l.errorDetail}</span>
                          : <span className="text-neutral-300">—</span>}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={res.badge} label={res.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-400">{l.syncTime}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {/* 「重试」已移除:后端暂无按日志重放端点,失败数据请修正后重新导入(审计修复) */}
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

      <p className="mt-3 text-xs text-neutral-400">
        本后台仅管理来源数据，不在本系统内接收求职者简历，不参与招聘闭环。
      </p>

      {/* 同步日志详情(展示该行全部字段,含完整失败原因) */}
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
              <DetailRow label="同步时间" value={detail.syncTime} />
              {detail.errorFields && (
                <div>
                  <p className="mb-1 text-xs text-neutral-400">异常字段</p>
                  <code className="block break-all rounded bg-orange-50 px-3 py-2 font-mono text-xs text-orange-600">{detail.errorFields}</code>
                </div>
              )}
              {detail.errorDetail && (
                <div>
                  <p className="mb-1 text-xs text-neutral-400">失败原因(完整)</p>
                  <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-600">{detail.errorDetail}</p>
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
