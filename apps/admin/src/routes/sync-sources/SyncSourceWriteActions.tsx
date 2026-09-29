// 【停放，2026-09-29，next-tasks 3.15】源码保留，不注册、不打包：本文件不被任何页面 import。
// 数据接入通道的四个写操作原本写在 sync-sources/index.tsx 的操作列里：
//   字段映射（mappings / 保存）、立即同步、停用通道 / 审批并启用、批量下架内容。
// 托管 a 下本平台不代为同步、启停或配置机构的数据来源，前端不论托管开关一律不给这组按钮；
// 服务端对这些接口目前仍只在托管关闭时回 403（本批不改服务端）。页面只保留查看与「按来源熔断」。
// b 版本恢复时由 sync-sources/index.tsx 引入 SyncSourceWriteActions，放回操作列「按来源熔断」之前。
// 是否删除本文件等产品负责人确认。
import { useState } from 'react'
import { LoadingState } from '@ai-job-print/ui'
import { PlayIcon, SettingsIcon } from 'lucide-react'
import { API_MODE } from '../../services/api/client'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { authFetch, throwIfNotOk, type ApiSyncSourceItem } from './syncSourcesApi'

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

async function triggerApiSync(sourceId: string): Promise<void> {
  if (API_MODE !== 'http') {
    await new Promise((r) => setTimeout(r, 800))
    return
  }
  const res = await authFetch(`/admin/job-sync/sources/${encodeURIComponent(sourceId)}/trigger`, {
    method: 'POST',
  })
  await throwIfNotOk(res)
}

async function setSourceEnabled(sourceId: string, enabled: boolean): Promise<void> {
  if (API_MODE !== 'http') return
  const res = await authFetch(`/admin/job-sync/sources/${encodeURIComponent(sourceId)}/enabled`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  await throwIfNotOk(res)
}

async function fetchSourceImpact(sourceId: string): Promise<SourceImpact> {
  if (API_MODE !== 'http') {
    return { content: { jobs: { total: 3, published: 2 }, fairs: { total: 1, published: 1 } } }
  }
  const res = await authFetch(`/admin/job-sync/sources/${encodeURIComponent(sourceId)}/impact`)
  await throwIfNotOk(res)
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
  await throwIfNotOk(res)
}

export function SyncSourceWriteActions({ source: s, onReload }: { source: ApiSyncSourceItem; onReload: () => void }) {
  const [trigState, setTrigState] = useState<TriggerState>('idle')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [configDraft, setConfigDraft] = useState<ConfigDraft | null>(null)
  const [configSaving, setConfigSaving] = useState(false)
  const [configErr, setConfigErr] = useState<string | null>(null)

  const openConfig = async () => {
    // 先清掉旧草稿与错误再开抽屉，抽屉不会闪出上一个来源的数据。
    setConfigDraft(null)
    setConfigErr(null)
    setConfigOpen(true)
    if (API_MODE !== 'http') {
      setConfigDraft({ dataType: 'job', rootPath: '', fields: [] })
      return
    }
    try {
      const res = await authFetch('/admin/job-sync/sources/' + s.id)
      await throwIfNotOk(res)
      const body = (await res.json()) as { data?: { responseConfig?: { dataType?: string; rootPath?: string; fields?: Record<string, string> } } }
      const rc = body.data?.responseConfig
      setConfigDraft({
        dataType: (rc?.dataType === 'fair' ? 'fair' : 'job') as 'job' | 'fair',
        rootPath: rc?.rootPath ?? '',
        fields: rc?.fields ? Object.entries(rc.fields).map(([std, src]) => ({ std, src })) : [],
      })
    } catch {
      // 加载失败不回落成空草稿（保存会覆盖真实映射），如实报错。
      setConfigErr('配置加载失败，请关闭后重试')
    }
  }

  const saveConfig = async () => {
    if (!configDraft) return
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
        const res = await authFetch('/admin/job-sync/sources/' + s.id + '/response-config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dto),
        })
        await throwIfNotOk(res)
      }
      setConfigOpen(false)
      onReload()
    } catch (e) {
      setConfigErr(userMessageOf(e, '保存失败，请稍后重试'))
    } finally {
      setConfigSaving(false)
    }
  }

  const handleTrigger = async () => {
    setTrigState('loading')
    setActionError(null)
    try {
      await triggerApiSync(s.id)
      setTrigState('ok')
      setTimeout(() => setTrigState('idle'), 3000)
    } catch (e) {
      setTrigState('error')
      setActionError(userMessageOf(e, '触发同步失败，请查看原因后重试'))
      setTimeout(() => setTrigState('idle'), 4000)
    }
  }

  const handleEnabled = async () => {
    if (s.archived) return
    setBusy(true)
    setActionError(null)
    try {
      await setSourceEnabled(s.id, !s.enabled)
      onReload()
    } catch (e) {
      setActionError(userMessageOf(e, '启停失败，请查看原因后重试'))
    } finally {
      setBusy(false)
    }
  }

  const handleBulkUnpublish = async () => {
    setBusy(true)
    setActionError(null)
    try {
      const impact = await fetchSourceImpact(s.id)
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
      await unpublishSourceContent(s.id)
      onReload()
    } catch (e) {
      setActionError(userMessageOf(e, '批量下架失败，请稍后重试'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {s.accessMode === 'api' && <button
        onClick={() => void openConfig()}
        className="flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
      >
        <SettingsIcon className="h-3 w-3" />
        mappings
      </button>}
      {s.accessMode === 'api' && <button
        disabled={trigState === 'loading' || s.archived || !s.enabled || !s.hasEndpoint}
        onClick={() => void handleTrigger()}
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
        disabled={s.archived || busy}
        onClick={() => void handleEnabled()}
        className="rounded border border-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
      >
        {s.archived ? '已归档' : s.enabled ? '停用通道' : '审批并启用'}
      </button>
      <button
        disabled={busy}
        onClick={() => void handleBulkUnpublish()}
        className="rounded px-2.5 py-1 text-xs font-medium text-error-fg hover:bg-error-bg disabled:opacity-50"
      >
        批量下架内容
      </button>
      {actionError && <span className="max-w-[16rem] text-xs text-error-fg">{actionError}。请修正后重试。</span>}

      {configOpen && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setConfigOpen(false)} />
      )}
      {configOpen && (
        <div className="fixed inset-y-0 right-0 z-50 flex w-[440px] flex-col bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
            <p className="text-sm font-semibold text-neutral-800">Configure response mapping</p>
            <button onClick={() => setConfigOpen(false)} className="rounded p-1 hover:bg-neutral-100 text-neutral-400">x</button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {configDraft === null && !configErr && (
              <LoadingState text="加载配置中…" className="py-8" />
            )}
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
            <button onClick={() => setConfigOpen(false)} className="rounded px-4 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
              Cancel
            </button>
            {/* 草稿为空（加载中或加载失败）时不给保存，免得误覆盖真实映射 */}
            {configDraft !== null && (
              <button
                onClick={() => void saveConfig()}
                disabled={configSaving}
                className="rounded bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {configSaving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
