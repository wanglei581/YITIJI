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
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="同步日志" subtitle="加载失败">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <RefreshCwIcon className="h-10 w-10 text-gray-200" />
          <p className="text-sm text-gray-400">加载失败，请稍后重试</p>
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
              resultFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['日志编号', '数据源', '类型', '成功数', '失败数', '重复数', '异常字段', '失败原因', '结果', '同步时间', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-sm text-gray-400">
                    <RefreshCwIcon className="mx-auto mb-2 h-8 w-8 text-gray-200" />
                    当前筛选条件下无同步日志
                  </td>
                </tr>
              ) : (
                filtered.map((l) => {
                  const dt  = DATA_TYPE_MAP[l.dataType]
                  const res = RESULT_MAP[l.status]
                  return (
                    <tr key={l.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{l.no}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-700">{l.source}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${dt.style}`}>{dt.label}</span>
                      </td>
                      <td className="px-4 py-3 text-center font-medium text-green-600">{l.addedCount}</td>
                      <td className="px-4 py-3 text-center font-medium text-red-500">{l.errorCount}</td>
                      <td className="px-4 py-3 text-center text-gray-500">{l.dupCount}</td>
                      <td className="px-4 py-3 text-xs">
                        {l.errorFields
                          ? <span className="font-mono text-orange-500">{l.errorFields}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-xs text-gray-500">
                        {l.errorDetail
                          ? <span className="line-clamp-2 text-red-500">{l.errorDetail}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={res.badge} label={res.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{l.syncTime}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex gap-2">
                          <button className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">查看详情</button>
                          {(l.status === 'failed' || l.status === 'partial') && (
                            <button className="rounded px-2 py-1 text-xs font-medium text-orange-500 hover:bg-orange-50">重试</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-gray-400">
        本后台仅管理来源数据，不在本系统内接收求职者简历，不参与招聘闭环。
      </p>
    </Page>
  )
}
