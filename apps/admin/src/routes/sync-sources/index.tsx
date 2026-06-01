import { useEffect, useState, useCallback } from 'react'
import { Card, StatusBadge, EmptyState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { RefreshCwIcon, PlayIcon } from 'lucide-react'
import { API_BASE_URL, API_MODE } from '../../services/api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiSyncSourceItem {
  id: string
  name: string
  orgId: string
  syncFreq: string
  enabled: boolean
  lastSyncAt: string | null
  lastSyncStatus: string | null
  hasEndpoint: boolean
  hasCredential: boolean
  hasResponseConfig: boolean
}

type TriggerState = 'idle' | 'loading' | 'ok' | 'error'

const FREQ_LABELS: Record<string, string> = {
  manual:  '手动',
  hourly:  '每小时',
  daily:   '每天',
  weekly:  '每周',
  realtime:'实时',
}

const STATUS_BADGE: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  success: 'success',
  failed:  'error',
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const MOCK_SOURCES: ApiSyncSourceItem[] = [
  {
    id: 'mock-src-1',
    name: '示例岗位 API 数据源',
    orgId: 'org-1',
    syncFreq: 'hourly',
    enabled: true,
    lastSyncAt: null,
    lastSyncStatus: null,
    hasEndpoint: true,
    hasCredential: true,
    hasResponseConfig: false,
  },
]

async function fetchApiSources(): Promise<ApiSyncSourceItem[]> {
  if (API_MODE !== 'http') return MOCK_SOURCES
  const res = await fetch(`${API_BASE_URL}/admin/job-sync/sources`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as { data: ApiSyncSourceItem[] }
  return body.data ?? []
}

async function triggerApiSync(sourceId: string): Promise<void> {
  if (API_MODE !== 'http') {
    await new Promise((r) => setTimeout(r, 800))
    return
  }
  const res = await fetch(`${API_BASE_URL}/admin/job-sync/sources/${encodeURIComponent(sourceId)}/trigger`, {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `HTTP ${res.status}`)
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SyncSourcesPage() {
  const [sources,  setSources]  = useState<ApiSyncSourceItem[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(false)
  const [triggers, setTriggers] = useState<Record<string, TriggerState>>({})

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    fetchApiSources()
      .then(setSources)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleTrigger = async (sourceId: string) => {
    setTriggers((prev) => ({ ...prev, [sourceId]: 'loading' }))
    try {
      await triggerApiSync(sourceId)
      setTriggers((prev) => ({ ...prev, [sourceId]: 'ok' }))
      setTimeout(() => setTriggers((prev) => ({ ...prev, [sourceId]: 'idle' })), 3000)
    } catch {
      setTriggers((prev) => ({ ...prev, [sourceId]: 'error' }))
      setTimeout(() => setTriggers((prev) => ({ ...prev, [sourceId]: 'idle' })), 4000)
    }
  }

  if (loading) {
    return (
      <Page title="API 同步数据源" subtitle="管理 API 拉取模式的数据源及手动触发同步">
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="API 同步数据源" subtitle="管理 API 拉取模式的数据源及手动触发同步">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <RefreshCwIcon className="h-10 w-10 text-gray-200" />
          <p className="text-sm text-gray-400">加载失败，请稍后重试</p>
          <button onClick={load} className="rounded-lg bg-primary-600 px-4 py-1.5 text-xs text-white hover:bg-primary-700">
            重试
          </button>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="API 同步数据源"
      subtitle="管理 API 拉取模式的数据源及手动触发同步"
      actions={
        <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">
          <RefreshCwIcon className="h-3.5 w-3.5" />刷新
        </button>
      }
    >
      {/* 说明 */}
      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
        Worker 每 30 分钟自动检查 syncFreq 到期的数据源。此页可手动触发单个源立即同步。
        {API_MODE !== 'http' && <span className="ml-2 font-medium text-blue-500">（当前为 mock 模式，触发操作仅模拟）</span>}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['数据源名称', '机构 ID', '同步频率', '最后同步', '状态', '配置', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sources.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      title="暂无 API 模式数据源"
                      description="请在合作机构后台配置 accessMode=api 的数据源"
                      icon={RefreshCwIcon}
                      className="py-12"
                    />
                  </td>
                </tr>
              ) : (
                sources.map((s) => {
                  const trigState = triggers[s.id] ?? 'idle'
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-800">{s.name}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-400">{s.orgId.slice(0, 12)}…</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                        {FREQ_LABELS[s.syncFreq] ?? s.syncFreq}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString('zh-CN') : '从未'}
                      </td>
                      <td className="px-4 py-3">
                        {s.lastSyncStatus ? (
                          <StatusBadge
                            status={STATUS_BADGE[s.lastSyncStatus] ?? 'default'}
                            label={s.lastSyncStatus === 'success' ? '成功' : s.lastSyncStatus === 'failed' ? '失败' : s.lastSyncStatus}
                          />
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <span className={`rounded px-1.5 py-0.5 text-xs ${s.hasEndpoint ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                            {s.hasEndpoint ? 'URL ✓' : 'URL —'}
                          </span>
                          <span className={`rounded px-1.5 py-0.5 text-xs ${s.hasCredential ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
                            {s.hasCredential ? '凭证 ✓' : '凭证 —'}
                          </span>
                          <span className={`rounded px-1.5 py-0.5 text-xs ${s.hasResponseConfig ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                            {s.hasResponseConfig ? '映射 ✓' : '映射 auto'}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <button
                          disabled={trigState === 'loading' || !s.enabled || !s.hasEndpoint}
                          onClick={() => handleTrigger(s.id)}
                          className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                            trigState === 'ok'    ? 'bg-green-50 text-green-600' :
                            trigState === 'error' ? 'bg-red-50 text-red-500' :
                            'bg-primary-50 text-primary-600 hover:bg-primary-100'
                          }`}
                          title={!s.hasEndpoint ? '请先配置 endpoint' : !s.enabled ? '数据源已停用' : ''}
                        >
                          <PlayIcon className="h-3 w-3" />
                          {trigState === 'loading' ? '触发中…' :
                           trigState === 'ok'      ? '已入队' :
                           trigState === 'error'   ? '触发失败' :
                           '立即同步'}
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

      <p className="mt-3 text-xs text-gray-400">
        仅显示 accessMode=api 的数据源。同步结果在合作机构后台 "同步日志" 和 Admin "岗位信息源" 可查看。
      </p>
    </Page>
  )
}
