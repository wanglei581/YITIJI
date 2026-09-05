import { useEffect, useState, useCallback } from 'react'
import { Card, StatusBadge, EmptyState, LoadingState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { RefreshCwIcon, PlayIcon, SettingsIcon } from 'lucide-react'
import { API_BASE_URL, API_MODE } from '../../services/api/client'
import { authHeader, redirectToLogin } from '../../services/auth'

/**
 * 统一鉴权 fetch:带 Bearer(authHeader)+ credentials,401 走全局 redirectToLogin。
 * 与其余 adapter 的鉴权机制保持一致(MEDIUM:此前仅 credentials:'include' 不带 Bearer,
 * 后端校验 Bearer 时会 401)。
 */
async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', ...authHeader(), ...(init.headers ?? {}) },
  })
  if (res.status === 401) {
    redirectToLogin()
    throw new Error('登录已过期')
  }
  return res
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ApiSyncSourceItem {
  id: string
  name: string
  orgId: string
  orgName: string
  sourceKind: string
  accessMode: string
  syncFreq: string
  enabled: boolean
  archived: boolean
  lastSyncAt: string | null
  lastSyncStatus: string | null
  hasEndpoint: boolean
  hasCredential: boolean
  hasResponseConfig: boolean
}

interface SourceImpact {
  content: {
    jobs: { total: number; published: number }
    fairs: { total: number; published: number }
  }
}

type TriggerState = 'idle' | 'loading' | 'ok' | 'error'

interface FieldMapping {
  std: string
  src: string
}

interface ConfigDraft {
  dataType: 'job' | 'fair'
  rootPath: string
  fields: FieldMapping[]
}

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
    orgName: '演示机构',
    sourceKind: 'aggregator',
    accessMode: 'api',
    syncFreq: 'hourly',
    enabled: true,
    archived: false,
    lastSyncAt: null,
    lastSyncStatus: null,
    hasEndpoint: true,
    hasCredential: true,
    hasResponseConfig: false,
  },
]

async function fetchApiSources(): Promise<ApiSyncSourceItem[]> {
  if (API_MODE !== 'http') return MOCK_SOURCES
  const res = await authFetch('/admin/job-sync/sources')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = (await res.json()) as { data: ApiSyncSourceItem[] }
  return body.data ?? []
}

async function triggerApiSync(sourceId: string): Promise<void> {
  if (API_MODE !== 'http') {
    await new Promise((r) => setTimeout(r, 800))
    return
  }
  const res = await authFetch(`/admin/job-sync/sources/${encodeURIComponent(sourceId)}/trigger`, {
    method: 'POST',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(body.error?.message ?? `HTTP ${res.status}`)
  }
}

async function setSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
  if (API_MODE !== 'http') return
  const res = await authFetch(`/admin/job-sync/sources/${encodeURIComponent(sourceId)}/enabled`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

async function fetchSourceImpact(sourceId: string): Promise<SourceImpact> {
  if (API_MODE !== 'http') {
    return { content: { jobs: { total: 3, published: 2 }, fairs: { total: 1, published: 1 } } }
  }
  const res = await authFetch(`/admin/job-sync/sources/${encodeURIComponent(sourceId)}/impact`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.json() as { data: SourceImpact }
  return body.data
}

async function unpublishSourceContent(sourceId: string): Promise<void> {
  if (API_MODE !== 'http') return
  const res = await authFetch(`/admin/job-sync/sources/${encodeURIComponent(sourceId)}/unpublish-content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'UNPUBLISH_SOURCE_CONTENT' }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SyncSourcesPage() {
  const [sources,      setSources]      = useState<ApiSyncSourceItem[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(false)
  const [triggers,     setTriggers]     = useState<Record<string, TriggerState>>({})
  const [configSrc,    setConfigSrc]    = useState<ApiSyncSourceItem | null>(null)
  const [configDraft,  setConfigDraft]  = useState<ConfigDraft | null>(null)
  const [configSaving, setConfigSaving] = useState(false)
  const [configErr,    setConfigErr]    = useState<string | null>(null)
  const [sourceActionId, setSourceActionId] = useState<string | null>(null)
  const [sourceActionError, setSourceActionError] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    fetchApiSources()
      .then(setSources)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const openConfig = async (src: ApiSyncSourceItem) => {
    // Bug 1 fix: reset stale draft and error BEFORE opening the drawer,
    // so the drawer never briefly shows the previous source's data.
    setConfigDraft(null)
    setConfigErr(null)
    setConfigSrc(src)
    if (API_MODE !== 'http') {
      setConfigDraft({ dataType: 'job', rootPath: '', fields: [] })
      return
    }
    try {
      const res = await authFetch('/admin/job-sync/sources/' + src.id)
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const body = (await res.json()) as { data?: { responseConfig?: { dataType?: string; rootPath?: string; fields?: Record<string, string> } } }
      const rc = body.data?.responseConfig
      setConfigDraft({
        dataType: (rc?.dataType === 'fair' ? 'fair' : 'job') as 'job' | 'fair',
        rootPath: rc?.rootPath ?? '',
        fields: rc?.fields ? Object.entries(rc.fields).map(([std, src]) => ({ std, src })) : [],
      })
    } catch {
      // Bug 2 fix: do NOT silently fall back to an empty draft (that risks
      // overwriting real mappings on save). Surface the error instead.
      setConfigErr('配置加载失败，请关闭后重试')
    }
  }

  const saveConfig = async () => {
    if (!configSrc || !configDraft) return
    setConfigSaving(true)
    setConfigErr(null)
    const dto = {
      dataType: configDraft.dataType,
      rootPath: configDraft.rootPath || undefined,
      fields: configDraft.fields.length
        ? Object.fromEntries(configDraft.fields.filter((f) => f.std && f.src).map((f) => [f.std, f.src]))
        : undefined,
    }
    try {
      if (API_MODE !== 'http') {
        await new Promise((r) => setTimeout(r, 600))
      } else {
        const res = await authFetch('/admin/job-sync/sources/' + configSrc.id + '/response-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dto),
        })
        if (!res.ok) throw new Error('HTTP ' + res.status)
      }
      setConfigSrc(null)
      load()
    } catch (e) {
      setConfigErr((e as Error).message || 'Save failed')
    } finally {
      setConfigSaving(false)
    }
  }

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

  const handleEnabled = async (source: ApiSyncSourceItem) => {
    if (source.archived) return
    setSourceActionId(source.id)
    setSourceActionError(null)
    try {
      await setSourceEnabled(source.id, !source.enabled)
      load()
    } catch {
      setSourceActionError(source.id)
    } finally {
      setSourceActionId(null)
    }
  }

  const handleBulkUnpublish = async (source: ApiSyncSourceItem) => {
    setSourceActionId(source.id)
    setSourceActionError(null)
    try {
      const impact = await fetchSourceImpact(source.id)
      const published = impact.content.jobs.published + impact.content.fairs.published
      if (published === 0) {
        window.alert('该来源当前没有已发布岗位或招聘会。')
        return
      }
      const confirmed = window.confirm(
        `将下架 ${impact.content.jobs.published} 个岗位和 ${impact.content.fairs.published} 场招聘会。` +
        '数据与审计记录会保留；此操作与“停用来源”相互独立。确认继续？',
      )
      if (!confirmed) return
      await unpublishSourceContent(source.id)
      load()
    } catch {
      setSourceActionError(source.id)
    } finally {
      setSourceActionId(null)
    }
  }

  if (loading) {
    return (
      <Page title="数据接入通道" subtitle="统一管理来源启停、同步配置和已发布内容影响">
        <div className="flex h-48 items-center justify-center">
          <LoadingState text="加载中…" className="py-12" />
        </div>
      </Page>
    )
  }

  if (error) {
    return (
      <Page title="数据接入通道" subtitle="统一管理来源启停、同步配置和已发布内容影响">
        <div className="flex h-48 flex-col items-center justify-center gap-3">
          <RefreshCwIcon className="h-10 w-10 text-neutral-200" />
          <p className="text-sm text-neutral-400">加载失败，请稍后重试</p>
          <button onClick={load} className="rounded-lg bg-primary-600 px-4 py-1.5 text-xs text-white hover:bg-primary-700">
            重试
          </button>
        </div>
      </Page>
    )
  }

  return (
    <Page
      title="数据接入通道"
      subtitle="API/Webhook 由管理员审批启用；停用通道不会自动下架既有内容"
      actions={
        <button onClick={load} className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-surface px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-50">
          <RefreshCwIcon className="h-3.5 w-3.5" />刷新
        </button>
      }
    >
      {/* 说明 */}
      <div className="mb-4 rounded-lg border border-info/20 bg-info-bg px-4 py-2.5 text-sm text-info-fg">
        停用通道只停止后续 API 拉取、Webhook 接收或文件使用，既有已发布内容保持不变；如需下架，请使用独立的“批量下架内容”操作。
        {API_MODE !== 'http' && <span className="ml-2 font-medium text-info">（当前为 mock 模式，触发操作仅模拟）</span>}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['数据源名称', '机构', '接入方式', '同步频率', '最后同步', '状态', '配置', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 bg-neutral-50/90 px-4 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {sources.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="暂无数据接入通道"
                      description="合作机构创建数据来源后将在此显示"
                      icon={RefreshCwIcon}
                      className="py-12"
                    />
                  </td>
                </tr>
              ) : (
                sources.map((s) => {
                  const trigState = triggers[s.id] ?? 'idle'
                  return (
                    <tr key={s.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3 font-medium text-neutral-800">{s.name}</td>
                      <td className="px-4 py-3 text-xs text-neutral-600">
                        <div>{s.orgName}</div>
                        <div className="font-mono text-[10px] text-neutral-400">{s.orgId.slice(0, 12)}…</div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">{s.accessMode.toUpperCase()}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-600">
                        {FREQ_LABELS[s.syncFreq] ?? s.syncFreq}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">
                        {s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString('zh-CN') : '从未'}
                      </td>
                      <td className="px-4 py-3">
                        {s.archived ? (
                          <StatusBadge dot status="default" label="已归档" />
                        ) : !s.enabled ? (
                          <StatusBadge dot status="warning" label="待启用 / 已停用" />
                        ) : s.lastSyncStatus ? (
                          <StatusBadge
                            dot
                            status={STATUS_BADGE[s.lastSyncStatus] ?? 'default'}
                            label={s.lastSyncStatus === 'success' ? '成功' : s.lastSyncStatus === 'failed' ? '失败' : s.lastSyncStatus}
                          />
                        ) : (
                          <span className="text-xs text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          <span className={`rounded px-1.5 py-0.5 text-xs ${s.hasEndpoint ? 'bg-success-bg text-success-fg' : 'bg-neutral-100 text-neutral-400'}`}>
                            {s.hasEndpoint ? 'URL ✓' : 'URL —'}
                          </span>
                          <span className={`rounded px-1.5 py-0.5 text-xs ${s.hasCredential ? 'bg-success-bg text-success-fg' : 'bg-neutral-100 text-neutral-400'}`}>
                            {s.hasCredential ? '凭证 ✓' : '凭证 —'}
                          </span>
                          <span className={`rounded px-1.5 py-0.5 text-xs ${s.hasResponseConfig ? 'bg-success-bg text-success-fg' : 'bg-warning-bg text-warning-fg'}`}>
                            {s.hasResponseConfig ? '映射 ✓' : '映射 auto'}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {s.accessMode === 'api' && <button
                            onClick={() => openConfig(s)}
                            className="flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                          >
                            <SettingsIcon className="h-3 w-3" />
                            mappings
                          </button>}
                          {s.accessMode === 'api' && <button
                            disabled={trigState === 'loading' || s.archived || !s.enabled || !s.hasEndpoint}
                            onClick={() => handleTrigger(s.id)}
                            className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                              trigState === 'ok'    ? 'bg-success-bg text-success-fg' :
                              trigState === 'error' ? 'bg-error-bg text-error-fg' :
                              'bg-primary-50 text-primary-600 hover:bg-primary-100'
                            }`}
                            title={s.archived ? '数据源已归档' : !s.hasEndpoint ? '请先配置 endpoint' : !s.enabled ? '数据源已停用' : ''}
                          >
                            <PlayIcon className="h-3 w-3" />
                            {trigState === 'loading' ? '触发中…' :
                             trigState === 'ok'      ? '已入队' :
                             trigState === 'error'   ? '触发失败' :
                             '立即同步'}
                          </button>}
                          <button
                            disabled={s.archived || sourceActionId === s.id}
                            onClick={() => void handleEnabled(s)}
                            className="rounded border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
                          >
                            {s.archived ? '已归档' : s.enabled ? '停用通道' : '审批并启用'}
                          </button>
                          <button
                            disabled={sourceActionId === s.id}
                            onClick={() => void handleBulkUnpublish(s)}
                            className="rounded px-2.5 py-1 text-xs font-medium text-error-fg hover:bg-error-bg disabled:opacity-50"
                          >
                            批量下架内容
                          </button>
                          {sourceActionError === s.id && <span className="text-xs text-error-fg">操作失败</span>}
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

      {configSrc && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setConfigSrc(null)} />
      )}
      {configSrc && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-[440px] flex-col bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
            <p className="text-sm font-semibold text-neutral-800">Configure response mapping</p>
            <button onClick={() => setConfigSrc(null)} className="rounded p-1 hover:bg-neutral-100 text-neutral-400">x</button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Bug 1: configDraft === null means load is in-flight — show spinner */}
            {configDraft === null && !configErr && (
              <LoadingState text="加载配置中…" className="py-8" />
            )}
            {/* Bug 2: load failed — show error, never render the editable form */}
            {configDraft === null && configErr && (
              <div className="rounded-lg border border-error/20 bg-error-bg px-4 py-3 text-sm text-error-fg">
                {configErr}
              </div>
            )}
            {configDraft !== null && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">Data type</label>
                  <select
                    value={configDraft.dataType}
                    onChange={(e) => setConfigDraft((d) => d ? { ...d, dataType: e.target.value as 'job' | 'fair' } : d)}
                    className="h-9 w-full rounded border border-neutral-200 px-3 text-sm"
                  >
                    <option value="job">Job (岗位)</option>
                    <option value="fair">Job fair (招聘会)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600">Root path (e.g. data.items)</label>
                  <input
                    value={configDraft.rootPath}
                    onChange={(e) => setConfigDraft((d) => d ? { ...d, rootPath: e.target.value } : d)}
                    placeholder="Leave empty for auto-detect"
                    className="h-9 w-full rounded border border-neutral-200 px-3 text-sm"
                  />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-neutral-600">Field mappings (standard -&gt; source field)</span>
                    <button
                      onClick={() => setConfigDraft((d) => d ? { ...d, fields: [...d.fields, { std: '', src: '' }] } : d)}
                      className="rounded px-2 py-1 text-xs text-primary-600 hover:bg-primary-50"
                    >
                      + Add
                    </button>
                  </div>
                  {configDraft.fields.map((f, i) => (
                    <div key={i} className="mb-2 flex items-center gap-2">
                      <input
                        value={f.std}
                        placeholder="standard field"
                        onChange={(e) => setConfigDraft((d) => d ? { ...d, fields: d.fields.map((ff, ii) => ii === i ? { ...ff, std: e.target.value } : ff) } : d)}
                        className="h-8 flex-1 rounded border border-neutral-200 px-2 text-xs"
                      />
                      <span className="text-neutral-400">-&gt;</span>
                      <input
                        value={f.src}
                        placeholder="source field"
                        onChange={(e) => setConfigDraft((d) => d ? { ...d, fields: d.fields.map((ff, ii) => ii === i ? { ...ff, src: e.target.value } : ff) } : d)}
                        className="h-8 flex-1 rounded border border-neutral-200 px-2 text-xs"
                      />
                      <button
                        onClick={() => setConfigDraft((d) => d ? { ...d, fields: d.fields.filter((_, ii) => ii !== i) } : d)}
                        className="text-xs text-error-fg hover:text-error-fg"
                      >
                        Del
                      </button>
                    </div>
                  ))}
                  {configDraft.fields.length === 0 && (
                    <p className="text-xs text-neutral-400">No mappings - auto-detect mode</p>
                  )}
                </div>
                {configErr && <p className="text-xs text-error-fg">{configErr}</p>}
              </>
            )}
          </div>
          <div className="border-t border-neutral-100 px-5 py-3 flex justify-end gap-2">
            <button onClick={() => setConfigSrc(null)} className="rounded px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
              Cancel
            </button>
            {/* Hide Save when draft is null (loading in-flight or load failed) to prevent accidental overwrites */}
            {configDraft !== null && (
              <button
                onClick={saveConfig}
                disabled={configSaving}
                className="rounded bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {configSaving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-neutral-400">
        所有操作写入审计。批量下架只改变岗位/招聘会发布状态，不删除来源、内容或历史记录。
      </p>
    </Page>
  )
}
