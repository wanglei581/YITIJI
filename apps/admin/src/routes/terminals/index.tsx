import { useEffect, useMemo, useState } from 'react'
import { mergeById, useInteractionLock, useRefreshable } from '@ai-job-print/refresh'
import { Card, StatusBadge, EmptyState } from '@ai-job-print/ui'
import { MonitorIcon, RefreshCwIcon, PencilIcon, CheckIcon, XIcon, Building2Icon, SearchIcon } from 'lucide-react'
import { Pagination, useTableState } from '../components/DataTable'
import { FilterChip } from '../components/FilterChip'
import { API_MODE } from '../../services/api/client'
import {
  getTerminals,
  getOrgOptions,
  assignTerminalOrg,
  updateTerminalProfile,
  type AdminTerminalRecord,
  type AdminOrganizationOption,
  type UpdateTerminalProfileInput,
} from '../../services/api/devices'

const TABLE_COLS = 12
const TERMINALS_REFRESH_KEY = 'admin:terminals'

// ─── 打印机状态映射(契约 C1 printerStatus 枚举)──────────────────────────────

const PRINTER_STATUS_MAP: Record<string, { badge: 'success' | 'error' | 'warning' | 'default'; label: string }> = {
  ok:          { badge: 'success', label: '正常' },
  offline:     { badge: 'error',   label: '离线' },
  paper_empty: { badge: 'warning', label: '缺纸' },
  error:       { badge: 'error',   label: '故障' },
  not_found:   { badge: 'warning', label: '未检测到' },
}

function printerStatusView(status: string | null) {
  if (!status) return { badge: 'default' as const, label: '未知' }
  return PRINTER_STATUS_MAP[status] ?? { badge: 'default' as const, label: status }
}

// 在线/离线由 online 字段决定(契约 C1:lastSeenAt 距今 < 3 分钟)
const ONLINE_VIEW = { badge: 'success' as const, label: '在线' }
const OFFLINE_VIEW = { badge: 'error' as const, label: '离线' }
const DEGRADED_VIEW = { badge: 'warning' as const, label: '降级' }

const FILTERS = ['全部', '在线', '离线'] as const

function relativeTime(iso: string | null): string {
  if (!iso) return '从未'
  const t = new Date(iso).getTime()
  if (isNaN(t)) return '—'
  const diffMin = Math.floor((Date.now() - t) / 60_000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

function fmtDisk(gb: number | null): string {
  if (gb === null || gb === undefined) return '—'
  return `${gb.toFixed(1)} GB`
}

function runtimeStatusView(t: AdminTerminalRecord) {
  if (!t.online) return { ...OFFLINE_VIEW, detail: null }
  if (t.agentStatus === 'agent_degraded' || t.localTaskDatabaseAvailable === false) {
    return { ...DEGRADED_VIEW, detail: '本地任务库不可用，已暂停领取打印任务' }
  }
  return { ...ONLINE_VIEW, detail: null }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TerminalsPage() {
  const [filter, setFilter] = useState<string>('全部')
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  // 终端机构归属编辑态
  const [orgOptions, setOrgOptions] = useState<AdminOrganizationOption[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState<string>('') // '' = 未绑定/解绑
  const [saving, setSaving] = useState(false)
  const [profileEditingId, setProfileEditingId] = useState<string | null>(null)
  const [profileDraft, setProfileDraft] = useState<UpdateTerminalProfileInput>({})
  const [profileSaving, setProfileSaving] = useState(false)
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [localOrgPatch, setLocalOrgPatch] = useState<Record<string, { orgId: string | null; orgName: string | null }>>({})
  const [localProfilePatch, setLocalProfilePatch] = useState<Record<string, UpdateTerminalProfileInput>>({})

  const {
    data: terminalData,
    status,
    refresh,
  } = useRefreshable(
    TERMINALS_REFRESH_KEY,
    getTerminals,
    {
      intervalMs: 30_000,
      merge: (current, incoming) => {
        const terminals = mergeById<AdminTerminalRecord>((item) => item.id)(
          current?.terminals,
          incoming.terminals,
        )
        if (current && terminals === current.terminals) return current
        return { terminals }
      },
      failPolicy: 'keep-last',
    },
  )

  useInteractionLock(
    editingId !== null || saving || profileEditingId !== null || profileSaving || statusSavingId !== null,
    [TERMINALS_REFRESH_KEY],
    'hard',
  )

  const terminals = useMemo(
    () => (terminalData?.terminals ?? []).map((terminal) => {
      const orgPatch = localOrgPatch[terminal.id]
      const profilePatch = localProfilePatch[terminal.id]
      return { ...terminal, ...orgPatch, ...profilePatch }
    }),
    [localOrgPatch, localProfilePatch, terminalData?.terminals],
  )

  const loading = status === 'loading' && terminals.length === 0
  const error = status === 'error' && terminals.length === 0

  // 机构下拉选项（绑定用）。失败不阻断页面，仍可解绑。
  useEffect(() => {
    getOrgOptions().then((r) => setOrgOptions(r.organizations)).catch(() => { /* ignore */ })
  }, [])

  useEffect(() => {
    if (!terminalData) return
    setLocalOrgPatch((current) => {
      let changed = false
      const next = { ...current }
      for (const terminal of terminalData.terminals) {
        const patch = next[terminal.id]
        if (patch && patch.orgId === terminal.orgId && patch.orgName === terminal.orgName) {
          delete next[terminal.id]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [terminalData])

  function startEdit(t: AdminTerminalRecord) {
    if (statusSavingId !== null) return
    setEditingId(t.id)
    setEditValue(t.orgId ?? '')
    setProfileEditingId(null)
    setNotice(null)
  }
  function cancelEdit() {
    setEditingId(null)
    setEditValue('')
  }
  async function saveEdit(t: AdminTerminalRecord) {
    setSaving(true)
    setNotice(null)
    try {
      const orgId = editValue === '' ? null : editValue
      const res = await assignTerminalOrg(t.terminalCode, orgId)
      setLocalOrgPatch((current) => ({
        ...current,
        [t.id]: { orgId: res.newOrgId, orgName: res.orgName },
      }))
      setEditingId(null)
      setEditValue('')
      void refresh()
        .catch(() => undefined)
        .then(() => refresh())
        .then(() => {
          setLocalOrgPatch((current) => {
            if (!current[t.id]) return current
            const next = { ...current }
            delete next[t.id]
            return next
          })
        })
        .catch(() => {
          /* keep optimistic patch until a later successful refresh reconciles */
        })
      setNotice({
        type: 'success',
        text: res.newOrgId
          ? `已绑定终端 ${t.terminalCode} → ${res.orgName ?? res.newOrgId}（保存成功，Kiosk 下一轮拉取后生效）`
          : `已解绑终端 ${t.terminalCode}（保存成功）`,
      })
    } catch (e) {
      setNotice({ type: 'error', text: e instanceof Error ? e.message : '保存失败，请稍后重试' })
    } finally {
      setSaving(false)
    }
  }

  function startProfileEdit(t: AdminTerminalRecord) {
    if (statusSavingId !== null) return
    setProfileEditingId(t.id)
    setEditingId(null)
    setProfileDraft({
      displayName: t.displayName ?? '',
      macAddress: t.macAddress ?? '',
      locationLabel: t.locationLabel ?? '',
      enabled: t.enabled,
    })
    setNotice(null)
  }

  function cancelProfileEdit() {
    setProfileEditingId(null)
    setProfileDraft({})
  }

  async function saveProfile(t: AdminTerminalRecord) {
    setProfileSaving(true)
    setNotice(null)
    try {
      const payload: UpdateTerminalProfileInput = {
        displayName: profileDraft.displayName === '' ? null : profileDraft.displayName,
        macAddress: profileDraft.macAddress === '' ? null : profileDraft.macAddress,
        locationLabel: profileDraft.locationLabel === '' ? null : profileDraft.locationLabel,
        enabled: profileDraft.enabled ?? true,
      }
      const res = await updateTerminalProfile(t.terminalCode, payload)
      setLocalProfilePatch((current) => ({
        ...current,
        [t.id]: {
          displayName: res.displayName,
          macAddress: res.macAddress,
          locationLabel: res.locationLabel,
          enabled: res.enabled,
        },
      }))
      setProfileEditingId(null)
      setProfileDraft({})
      void refresh().catch(() => undefined)
      setNotice({ type: 'success', text: `已更新终端 ${t.terminalCode} 的设备档案，Kiosk 下一轮配置刷新后生效` })
    } catch (e) {
      setNotice({ type: 'error', text: e instanceof Error ? e.message : '设备档案保存失败，请稍后重试' })
    } finally {
      setProfileSaving(false)
    }
  }

  async function toggleTerminalStatus(t: AdminTerminalRecord) {
    const nextEnabled = !t.enabled
    if (!nextEnabled && !window.confirm(`确定停用终端 ${t.terminalCode}？停用后该终端的 Kiosk 敏感模块会在下一轮配置刷新后关闭。`)) {
      return
    }

    setStatusSavingId(t.id)
    setNotice(null)
    try {
      const res = await updateTerminalProfile(t.terminalCode, { enabled: nextEnabled })
      setLocalProfilePatch((current) => ({
        ...current,
        [t.id]: {
          ...current[t.id],
          displayName: res.displayName,
          macAddress: res.macAddress,
          locationLabel: res.locationLabel,
          enabled: res.enabled,
        },
      }))
      void refresh().catch(() => undefined)
      setNotice({
        type: 'success',
        text: `已${res.enabled ? '启用' : '停用'}终端 ${t.terminalCode}，Kiosk 下一轮配置刷新后生效`,
      })
    } catch (e) {
      setNotice({ type: 'error', text: e instanceof Error ? e.message : '终端状态更新失败，请稍后重试' })
    } finally {
      setStatusSavingId(null)
    }
  }

  const byStatus = filter === '全部'
    ? terminals
    : terminals.filter((t) => (filter === '在线' ? t.online : !t.online))

  const searched = search.trim()
    ? byStatus.filter((t) =>
        t.terminalCode.toLowerCase().includes(search.toLowerCase()) ||
        (t.displayName ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (t.macAddress ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (t.locationLabel ?? '').toLowerCase().includes(search.toLowerCase()) ||
        (t.ipAddress ?? '').includes(search) ||
        (t.agentVersion ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : byStatus

  const total = searched.length
  const paginated = searched.slice((page - 1) * pageSize, page * pageSize)

  const counts = {
    全部: terminals.length,
    在线: terminals.filter((t) => t.online).length,
    离线: terminals.filter((t) => !t.online).length,
  }

  return (
    <>
      {/* 工具条：搜索 + 状态 chips + 刷新 */}
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <div className="flex h-[34px] min-w-[280px] items-center gap-2 rounded-[9px] border border-neutral-900/10 bg-surface px-3">
          <SearchIcon className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索编号、设备名、MAC、位置、IP..."
            className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-900 outline-none placeholder:text-neutral-500"
          />
        </div>
        {FILTERS.map((f) => (
          <FilterChip
            key={f}
            active={filter === f}
            label={f}
            count={counts[f]}
            onClick={() => { setFilter(f); setPage(1) }}
          />
        ))}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12.5px] text-neutral-500">共 {total} 台终端</span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-3 text-xs font-bold text-neutral-700 transition-colors hover:bg-neutral-50"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />刷新
          </button>
        </div>
      </div>

      {/* 归属保存提示 */}
      {notice && (
        <div
          className={`mb-3 rounded-[9px] border px-4 py-3 text-sm ${
            notice.type === 'success'
              ? 'border-success/20 bg-success-bg text-success-fg'
              : 'border-error/20 bg-error-bg text-error-fg'
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {['终端编号', '设备档案', 'MAC', '所属机构', '启停', '状态', '打印机状态', '最近心跳', 'Agent 版本', 'IP 地址', '磁盘可用', '注册时间'].map((h) => (
                  <th key={h} className="whitespace-nowrap border-b border-neutral-900/10 px-3 py-2.5 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-900/[0.06]">
              {loading ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    {Array.from({ length: TABLE_COLS }).map((_, j) => (
                      <td key={j} className="px-3 py-4"><div className="h-3 w-3/4 animate-pulse rounded bg-neutral-100" /></td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={TABLE_COLS}>
                    <div className="flex flex-col items-center gap-3 py-12">
                      <p className="text-sm text-neutral-500">终端数据加载失败,请稍后重试</p>
                      <button onClick={() => void refresh()} className="rounded-[9px] bg-primary-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-primary-700">重试</button>
                    </div>
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_COLS}>
                    <EmptyState title={search ? '未找到匹配的终端' : '该分类暂无终端'} description={search ? '请尝试其他关键词' : undefined} icon={MonitorIcon} className="py-12" />
                  </td>
                </tr>
              ) : (
                paginated.map((t) => {
                  const runtimeView = runtimeStatusView(t)
                  const printerView = printerStatusView(t.printerStatus ?? null)
                  return (
                    <tr key={t.id} className="hover:bg-neutral-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-700">{t.terminalCode}</td>
                      <td className="min-w-[260px] px-4 py-3 text-xs">
                        {profileEditingId === t.id ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                value={profileDraft.displayName ?? ''}
                                onChange={(e) => setProfileDraft((d) => ({ ...d, displayName: e.target.value }))}
                                disabled={profileSaving}
                                placeholder="设备名称"
                                className="h-7 rounded-md border border-neutral-200 px-2 text-xs text-neutral-700 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600/15"
                              />
                              <input
                                value={profileDraft.macAddress ?? ''}
                                onChange={(e) => setProfileDraft((d) => ({ ...d, macAddress: e.target.value }))}
                                disabled={profileSaving}
                                placeholder="MAC 地址"
                                className="h-7 rounded-md border border-neutral-200 px-2 font-mono text-xs text-neutral-700 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600/15"
                              />
                            </div>
                            <input
                              value={profileDraft.locationLabel ?? ''}
                              onChange={(e) => setProfileDraft((d) => ({ ...d, locationLabel: e.target.value }))}
                              disabled={profileSaving}
                              placeholder="摆放位置"
                              className="h-7 w-full rounded-md border border-neutral-200 px-2 text-xs text-neutral-700 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600/15"
                            />
                            <div className="flex items-center justify-between gap-2">
                              <label className="inline-flex items-center gap-1.5 text-xs text-neutral-500">
                                <input
                                  type="checkbox"
                                  checked={profileDraft.enabled ?? true}
                                  onChange={(e) => setProfileDraft((d) => ({ ...d, enabled: e.target.checked }))}
                                  disabled={profileSaving}
                                  className="h-3.5 w-3.5 rounded border-neutral-300 text-primary-600"
                                />
                                启用终端
                              </label>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => saveProfile(t)}
                                  disabled={profileSaving}
                                  title="保存设备档案"
                                  aria-label="保存设备档案"
                                  className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                                >
                                  <CheckIcon className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelProfileEdit}
                                  disabled={profileSaving}
                                  title="取消"
                                  aria-label="取消"
                                  className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-neutral-50 disabled:opacity-50"
                                >
                                  <XIcon className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-medium text-neutral-900">{t.displayName || '未命名终端'}</p>
                              <p className="mt-0.5 max-w-[220px] truncate text-neutral-500">{t.locationLabel || '未设置摆放位置'}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => startProfileEdit(t)}
                              disabled={statusSavingId !== null}
                              title="编辑设备档案"
                              aria-label={`编辑 ${t.terminalCode} 设备档案`}
                              className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-neutral-200 bg-surface px-2 text-xs font-medium text-neutral-600 hover:border-primary-600/40 hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <PencilIcon className="h-3.5 w-3.5" />
                              编辑档案
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-500">{t.macAddress ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">
                        {editingId === t.id ? (
                          <div className="flex items-center gap-1.5">
                            <select
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              disabled={saving}
                              className="h-7 max-w-[180px] rounded-md border border-neutral-200 bg-surface px-2 text-xs text-neutral-700 focus:border-primary-600 focus:outline-none focus:ring-2 focus:ring-primary-600/15"
                              aria-label={`设置 ${t.terminalCode} 所属机构`}
                            >
                              <option value="">未绑定（解绑）</option>
                              {orgOptions.map((o) => (
                                <option key={o.id} value={o.id}>{o.name}</option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => saveEdit(t)}
                              disabled={saving}
                              title="保存归属"
                              aria-label="保存归属"
                              className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                            >
                              <CheckIcon className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={cancelEdit}
                              disabled={saving}
                              title="取消"
                              aria-label="取消"
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 text-neutral-500 hover:bg-neutral-50 disabled:opacity-50"
                            >
                              <XIcon className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {t.orgName ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-info-bg px-2 py-0.5 text-info-fg">
                                <Building2Icon className="h-3 w-3" />{t.orgName}
                              </span>
                            ) : (
                              <span className="text-neutral-500">未绑定</span>
                            )}
                            <button
                              type="button"
                              onClick={() => startEdit(t)}
                              disabled={statusSavingId !== null}
                              title="编辑所属机构"
                              aria-label={`编辑 ${t.terminalCode} 所属机构`}
                              className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md border border-neutral-200 bg-surface px-2 text-xs font-medium text-neutral-600 hover:border-primary-600/40 hover:bg-primary-50 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <PencilIcon className="h-3.5 w-3.5" />
                              {t.orgName ? '更改机构' : '绑定机构'}
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge dot status={t.enabled ? 'success' : 'error'} label={t.enabled ? '启用' : '停用'} />
                          <button
                            type="button"
                            onClick={() => toggleTerminalStatus(t)}
                            disabled={statusSavingId !== null || profileSaving || saving || profileEditingId === t.id || editingId === t.id}
                            aria-label={`${t.enabled ? '停用' : '启用'} ${t.terminalCode}`}
                            className={`inline-flex h-7 items-center whitespace-nowrap rounded-md border px-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                              t.enabled
                                ? 'border-error/20 bg-surface text-error-fg hover:bg-error-bg'
                                : 'border-success/20 bg-surface text-success-fg hover:bg-success-bg'
                            }`}
                          >
                            {statusSavingId === t.id
                              ? '保存中'
                              : profileEditingId === t.id || editingId === t.id
                                ? '编辑中'
                                : t.enabled ? '停用' : '启用'}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <StatusBadge dot status={runtimeView.badge} label={runtimeView.label} />
                          {runtimeView.detail && (
                            <span className="text-xs text-warning-fg">{runtimeView.detail}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3"><StatusBadge dot status={printerView.badge} label={printerView.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{relativeTime(t.lastHeartbeatAt ?? t.lastSeenAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-500">{t.agentVersion ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-500">{t.ipAddress ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{fmtDisk(t.diskFreeGb)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{t.registeredAt ? new Date(t.registeredAt).toLocaleDateString('zh-CN') : '—'}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }} />
      </Card>

      <p className="mt-3 text-xs text-neutral-500">
        终端在线状态、打印机状态、版本、IP、磁盘均来自 Windows Terminal Agent 的心跳上报
        {API_MODE !== 'http' && '（当前为 mock 演示数据，归属变更不写数据库）'}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        「所属机构」决定该终端归哪所学校；学校账号在合作机构后台只能配置归属本校的智慧校园开关。绑定/解绑仅管理员可操作，变更写入审计日志。
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        「设备档案」用于商用部署的机器识别和权限绑定；MAC 地址建议由 Terminal Agent 上报，也可由管理员人工校正。停用终端后，Kiosk 统一配置会关闭敏感模块。
      </p>
    </>
  )
}
