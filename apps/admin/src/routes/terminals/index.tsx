import { formatDateTime, formatRelativeTime } from '@ai-job-print/shared'
import { useEffect, useMemo, useState } from 'react'
import { mergeById, useInteractionLock, useRefreshable } from '@ai-job-print/refresh'
import { Card, ConsoleTable, StatusBadge, type ConsoleColumn } from '@ai-job-print/ui'
import { PlusIcon, RefreshCwIcon, SearchIcon } from 'lucide-react'
import { useTableState } from '../components/DataTable'
import { FilterChip } from '../components/FilterChip'
import { API_MODE, ApiHttpError } from '../../services/api/client'
import {
  assignTerminalOrg,
  getOrgOptions,
  getTerminals,
  revokeTerminalBatchBindCodes,
  type AdminOrganizationOption,
  type AdminTerminalRecord,
  type EmergencyRevokeTerminalResult,
  type TerminalLifecycleStatus,
  type UpdateTerminalLifecycleResult,
  type UpdateTerminalProfileInput,
  updateTerminalProfile,
} from '../../services/api/devices'
import type { TerminalBatchBindCodeResult, TerminalBatchSelectionInput } from '../../services/api/terminalBatch'
import { CreatePlannedTerminalDialog } from './CreatePlannedTerminalDialog'
import { TerminalBatchCodeDialog, TerminalBatchCreateDialog, requestBatchCodes } from './TerminalBatchDialogs'
import { TerminalBindCodeDialog } from './TerminalBindCodeDialog'
import {
  applyHomeFreeBadgePatch,
  dropHomeFreeBadgePatchAfterList,
  nextHomeFreeBadgeClock,
  type HomeFreeBadgePatchEntry,
} from './homeFreeBadgePatch'
import {
  applyChargeSettingsPatch,
  dropChargeSettingsPatchAfterList,
  nextChargeSettingsClock,
  type ChargeSettingsPatchEntry,
} from './chargeSettingsPatch'
import { chargeSummary, type TerminalChargeSettingsView } from '../../services/api/terminalCharge'
import { TerminalDetailDrawer } from './TerminalDetailDrawer'
import { ReleaseObservationPanel } from './ReleaseObservationPanel'
import { lifecycleView } from './terminalStatusViews'

const TERMINALS_REFRESH_KEY = 'admin:terminals'
const FILTERS = ['全部', '在线', '离线'] as const
type Notice = { type: 'success' | 'error'; text: string }

function runtimeStatusView(terminal: AdminTerminalRecord) {
  if (!terminal.online) return { badge: 'error' as const, label: '离线', detail: null }
  if (terminal.agentStatus === 'agent_degraded' || terminal.localTaskDatabaseAvailable === false) {
    return { badge: 'warning' as const, label: '降级', detail: '本地任务库不可用，已暂停领取打印任务' }
  }
  return { badge: 'success' as const, label: '在线', detail: null }
}

export default function TerminalsPage() {
  const [filter, setFilter] = useState<string>('全部')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)
  const [orgOptions, setOrgOptions] = useState<AdminOrganizationOption[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [profileEditingId, setProfileEditingId] = useState<string | null>(null)
  const [profileDraft, setProfileDraft] = useState<UpdateTerminalProfileInput>({})
  const [profileSaving, setProfileSaving] = useState(false)
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null)
  const [lifecycleSavingId, setLifecycleSavingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [bindCodeTerminal, setBindCodeTerminal] = useState<AdminTerminalRecord | null>(null)
  const [creatingPlannedTerminal, setCreatingPlannedTerminal] = useState(false)
  const [creatingBatch, setCreatingBatch] = useState(false)
  const [batchIdFilter, setBatchIdFilter] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchCodes, setBatchCodes] = useState<TerminalBatchBindCodeResult | null>(null)
  const [orgLoadError, setOrgLoadError] = useState<string | null>(null)
  const [orgLicenseError, setOrgLicenseError] = useState<string | null>(null)
  const [localOrgPatch, setLocalOrgPatch] = useState<Record<string, { orgId: string | null; orgName: string | null }>>({})
  const [localProfilePatch, setLocalProfilePatch] = useState<Record<string, UpdateTerminalProfileInput>>({})
  const [localLifecyclePatch, setLocalLifecyclePatch] = useState<Record<string, {
    status: TerminalLifecycleStatus
    version: number
    credentialGeneration?: number
    hasActiveCredential?: boolean
  }>>({})
  const [homeFreeBadgePatch, setHomeFreeBadgePatch] = useState<Record<string, HomeFreeBadgePatchEntry>>({})
  const [chargePatch, setChargePatch] = useState<Record<string, ChargeSettingsPatchEntry>>({})
  const [chargeResetNotice, setChargeResetNotice] = useState<string | null>(null)

  const { data: terminalData, status, refresh } = useRefreshable(TERMINALS_REFRESH_KEY, async () => {
    // 序号在请求发出时拿走。保存成功若晚于这一下，回来的仍是旧列表，不能拿它冲掉补丁。
    const listIssuedAt = nextHomeFreeBadgeClock()
    const chargeListIssuedAt = nextChargeSettingsClock()
    const result = await getTerminals()
    return { terminals: result.terminals, listIssuedAt, chargeListIssuedAt }
  }, {
    intervalMs: 30_000,
    merge: (current, incoming) => {
      const terminals = mergeById<AdminTerminalRecord>((item) => item.id)(current?.terminals, incoming.terminals)
      if (
        current
        && terminals === current.terminals
        && current.listIssuedAt === incoming.listIssuedAt
        && current.chargeListIssuedAt === incoming.chargeListIssuedAt
      ) return current
      return { terminals, listIssuedAt: incoming.listIssuedAt, chargeListIssuedAt: incoming.chargeListIssuedAt }
    },
    failPolicy: 'keep-last',
  })

  useInteractionLock(
    editingId !== null || saving || profileEditingId !== null || profileSaving || statusSavingId !== null || lifecycleSavingId !== null || creatingPlannedTerminal || creatingBatch || batchBusy || batchCodes !== null,
    [TERMINALS_REFRESH_KEY],
    'hard',
  )

  const effectiveHomeFreeBadgePatch = terminalData
    ? dropHomeFreeBadgePatchAfterList(homeFreeBadgePatch, terminalData.terminals, terminalData.listIssuedAt)
    : homeFreeBadgePatch
  const effectiveChargePatch = terminalData
    ? dropChargeSettingsPatchAfterList(chargePatch, terminalData.terminals, terminalData.chargeListIssuedAt)
    : chargePatch

  const terminals = useMemo(
    () => applyChargeSettingsPatch(applyHomeFreeBadgePatch((terminalData?.terminals ?? []).map((terminal) => {
      const lifecyclePatch = localLifecyclePatch[terminal.id]
      return {
        ...terminal,
        ...localOrgPatch[terminal.id],
        ...localProfilePatch[terminal.id],
        ...(lifecyclePatch ? {
          lifecycleStatus: lifecyclePatch.status,
          lifecycleVersion: lifecyclePatch.version,
          ...(lifecyclePatch.credentialGeneration === undefined ? {} : { credentialGeneration: lifecyclePatch.credentialGeneration }),
          ...(lifecyclePatch.hasActiveCredential === undefined ? {} : { hasActiveCredential: lifecyclePatch.hasActiveCredential }),
        } : {}),
      }
    }), effectiveHomeFreeBadgePatch), effectiveChargePatch),
    [effectiveChargePatch, effectiveHomeFreeBadgePatch, localLifecyclePatch, localOrgPatch, localProfilePatch, terminalData?.terminals],
  )
  const selected = terminals.find((terminal) => terminal.id === selectedId) ?? null
  const loading = status === 'loading' && terminals.length === 0
  const failed = status === 'error' && terminals.length === 0

  useEffect(() => {
    getOrgOptions().then((response) => setOrgOptions(response.organizations)).catch(() => setOrgLoadError('机构列表加载失败，请刷新页面重试'))
  }, [])

  useEffect(() => {
    if (!terminalData) return
    setLocalOrgPatch((current) => {
      const next = { ...current }
      let changed = false
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

  useEffect(() => {
    if (effectiveHomeFreeBadgePatch !== homeFreeBadgePatch) setHomeFreeBadgePatch(effectiveHomeFreeBadgePatch)
  }, [effectiveHomeFreeBadgePatch, homeFreeBadgePatch])

  useEffect(() => {
    if (effectiveChargePatch !== chargePatch) setChargePatch(effectiveChargePatch)
  }, [effectiveChargePatch, chargePatch])

  function handleHomeFreeBadgeSaved(terminalId: string, enabled: boolean) {
    const savedAt = nextHomeFreeBadgeClock()
    setHomeFreeBadgePatch((current) => ({ ...current, [terminalId]: { enabled, savedAt } }))
  }

  function handleChargeSaved(terminalId: string, view: TerminalChargeSettingsView) {
    const savedAt = nextChargeSettingsClock()
    setChargePatch((current) => ({ ...current, [terminalId]: { charge: chargeSummary(view), savedAt } }))
  }

  function openBindCodeModal(terminal: AdminTerminalRecord) {
    const canCreate = terminal.lifecycleStatus === 'planned' || terminal.lifecycleStatus === 'maintenance'
    if (statusSavingId !== null || lifecycleSavingId !== null || !terminal.enabled || !canCreate) return
    setBindCodeTerminal(terminal)
    setNotice(null)
  }

  function startProfileEdit(terminal: AdminTerminalRecord) {
    if (statusSavingId !== null) return
    setProfileEditingId(terminal.id)
    setEditingId(null)
    setProfileDraft({ displayName: terminal.displayName ?? '', macAddress: terminal.macAddress ?? '', locationLabel: terminal.locationLabel ?? '', enabled: terminal.enabled })
    setNotice(null)
  }

  function cancelProfileEdit() {
    setProfileEditingId(null)
    setProfileDraft({})
  }

  async function saveProfile(terminal: AdminTerminalRecord) {
    setProfileSaving(true)
    setNotice(null)
    try {
      const payload: UpdateTerminalProfileInput = {
        displayName: profileDraft.displayName === '' ? null : profileDraft.displayName,
        macAddress: profileDraft.macAddress === '' ? null : profileDraft.macAddress,
        locationLabel: profileDraft.locationLabel === '' ? null : profileDraft.locationLabel,
        enabled: profileDraft.enabled ?? true,
      }
      const result = await updateTerminalProfile(terminal.terminalCode, payload)
      setLocalProfilePatch((current) => ({ ...current, [terminal.id]: { displayName: result.displayName, macAddress: result.macAddress, locationLabel: result.locationLabel, enabled: result.enabled } }))
      cancelProfileEdit()
      void refresh().catch(() => undefined)
      setNotice({ type: 'success', text: `已更新终端 ${terminal.terminalCode} 的设备档案，一体机下一轮配置刷新后生效` })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '设备档案保存失败，请稍后重试' })
    } finally {
      setProfileSaving(false)
    }
  }

  function startOrgEdit(terminal: AdminTerminalRecord) {
    if (statusSavingId !== null) return
    setEditingId(terminal.id)
    setEditValue(terminal.orgId ?? '')
    setOrgLicenseError(null)
    setProfileEditingId(null)
    setNotice(null)
  }

  function cancelOrgEdit() {
    setOrgLicenseError(null)
    setEditingId(null)
    setEditValue('')
  }

  async function saveOrg(terminal: AdminTerminalRecord) {
    setSaving(true)
    setOrgLicenseError(null)
    setNotice(null)
    try {
      const result = await assignTerminalOrg(terminal.terminalCode, editValue === '' ? null : editValue)
      setLocalOrgPatch((current) => ({ ...current, [terminal.id]: { orgId: result.newOrgId, orgName: result.orgName } }))
      setChargeResetNotice(result.chargeSettingsReset ? '改绑机构，收费设置已复位' : null)
      cancelOrgEdit()
      void refresh().catch(() => undefined)
      setNotice({ type: 'success', text: result.newOrgId ? `已绑定终端 ${terminal.terminalCode} → ${result.orgName ?? result.newOrgId}（保存成功，一体机下一轮拉取后生效）` : `已解绑终端 ${terminal.terminalCode}（保存成功）` })
    } catch (error) {
      if (error instanceof ApiHttpError && ['LICENSE_TERMINAL_QUOTA_EXCEEDED', 'LICENSE_NOT_AVAILABLE_FOR_BINDING'].includes(error.code)) setOrgLicenseError(error.message)
      else setNotice({ type: 'error', text: error instanceof Error ? error.message : '保存失败，请稍后重试' })
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(terminal: AdminTerminalRecord) {
    const nextEnabled = !terminal.enabled
    if (!nextEnabled && !window.confirm(`确定停用终端 ${terminal.terminalCode}？停用后一体机敏感模块会在下一轮配置刷新后关闭。`)) return
    setStatusSavingId(terminal.id)
    setNotice(null)
    try {
      const result = await updateTerminalProfile(terminal.terminalCode, { enabled: nextEnabled })
      setLocalProfilePatch((current) => ({ ...current, [terminal.id]: { ...current[terminal.id], displayName: result.displayName, macAddress: result.macAddress, locationLabel: result.locationLabel, enabled: result.enabled } }))
      void refresh().catch(() => undefined)
      setNotice({ type: 'success', text: `已${result.enabled ? '启用' : '停用'}终端 ${terminal.terminalCode}，一体机下一轮配置刷新后生效` })
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '终端状态更新失败，请稍后重试' })
    } finally {
      setStatusSavingId(null)
    }
  }

  function handleLifecycleUpdated(terminal: AdminTerminalRecord, result: UpdateTerminalLifecycleResult | EmergencyRevokeTerminalResult) {
    setLocalLifecyclePatch((current) => ({ ...current, [terminal.id]: { status: result.newStatus, version: result.lifecycleVersion, ...('credentialGeneration' in result ? { credentialGeneration: result.credentialGeneration, hasActiveCredential: false } : {}) } }))
    void refresh().then(() => setLocalLifecyclePatch((current) => { if (!current[terminal.id]) return current; const next = { ...current }; delete next[terminal.id]; return next })).catch(() => undefined)
  }

  const filtered = useMemo(() => {
    const lower = search.trim().toLowerCase()
    const batchId = batchIdFilter.trim()
    return terminals.filter((terminal) => {
      if (batchId && terminal.provisionBatchId !== batchId) return false
      if (filter !== '全部' && (filter === '在线' ? !terminal.online : terminal.online)) return false
      if (!lower) return true
      return [terminal.terminalCode, terminal.displayName, terminal.macAddress, terminal.locationLabel, terminal.ipAddress, terminal.agentVersion].some((value) => value?.toLowerCase().includes(lower))
    })
  }, [batchIdFilter, filter, search, terminals])
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)
  const counts = { 全部: terminals.length, 在线: terminals.filter((terminal) => terminal.online).length, 离线: terminals.filter((terminal) => !terminal.online).length }
  const trimmedBatchId = batchIdFilter.trim()
  const visibleSelectedIds = paginated.filter((terminal) => selectedIds.includes(terminal.id)).map((terminal) => terminal.id)
  const currentBatchCount = trimmedBatchId
    ? terminals.filter((terminal) => terminal.provisionBatchId === trimmedBatchId).length
    : 0
  const batchScopeLabel = visibleSelectedIds.length > 0
    ? `已选 ${visibleSelectedIds.length} 台`
    : trimmedBatchId
      ? `本批 ${currentBatchCount} 台`
      : ''

  function closeDetail() {
    setOrgLicenseError(null)
    setSelectedId(null)
    setEditingId(null)
    setEditValue('')
    setProfileEditingId(null)
    setProfileDraft({})
    setChargeResetNotice(null)
  }

  function batchSelection(): TerminalBatchSelectionInput | null {
    if (visibleSelectedIds.length > 0) return { terminalIds: visibleSelectedIds }
    return trimmedBatchId ? { batchId: trimmedBatchId } : null
  }

  function batchActionTitle(action: string): string {
    return batchScopeLabel ? `${action}（${batchScopeLabel}）` : action
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  async function runBatchCodes(kind: 'issue' | 'reissue') {
    const selection = batchSelection()
    if (!selection) {
      setNotice({ type: 'error', text: '先勾选终端，或填写批次号' })
      return
    }
    setBatchBusy(true)
    setNotice(null)
    try {
      setBatchCodes(await requestBatchCodes(kind, selection))
      void refresh().catch(() => undefined)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '绑定码操作失败，请稍后重试' })
    } finally {
      setBatchBusy(false)
    }
  }

  async function runBatchRevoke() {
    const selection = batchSelection()
    if (!selection) {
      setNotice({ type: 'error', text: '先勾选终端，或填写批次号' })
      return
    }
    if (!window.confirm('确定作废这些终端尚未使用的绑定码？')) return
    setBatchBusy(true)
    setNotice(null)
    try {
      const result = await revokeTerminalBatchBindCodes(selection)
      setNotice({ type: 'success', text: `已作废 ${result.revokedCount} 个未使用的绑定码` })
      void refresh().catch(() => undefined)
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : '作废绑定码失败，请稍后重试' })
    } finally {
      setBatchBusy(false)
    }
  }

  const columns: ConsoleColumn<AdminTerminalRecord>[] = [
    { id: 'select', header: '选择', cell: (t) => <input type="checkbox" aria-label={`选择 ${t.terminalCode}`} checked={selectedIds.includes(t.id)} onChange={() => toggleSelected(t.id)} className="h-4 w-4" /> },
    { id: 'terminal', header: '终端', truncate: true, title: (t) => `${t.terminalCode} · ${t.displayName ?? '未命名终端'} · ${t.locationLabel ?? '未设置摆放位置'}`, cell: (t) => <div><p className="truncate font-semibold text-neutral-900">{t.displayName || '未命名终端'}</p><p className="truncate text-xs text-neutral-500"><span className="font-mono">{t.terminalCode}</span> · {t.locationLabel || '未设置摆放位置'}</p></div> },
    { id: 'activation', header: '激活', cell: (t) => <div className="text-xs leading-5 text-neutral-700"><p>{t.activationStatusLabel || '未上报'}</p><p>首次激活：{t.firstActivatedAt ? formatDateTime(t.firstActivatedAt) : '未上报'}</p><p>最后心跳：{t.lastHeartbeatAt ? formatDateTime(t.lastHeartbeatAt) : '未上报'}</p><p>程序版本：{t.agentVersion?.trim() ? t.agentVersion : '未上报'}</p></div> },
    { id: 'org', header: '所属机构', truncate: true, cell: (t) => <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-info-bg px-2 py-0.5 text-xs text-info-fg"><span className="truncate">{t.orgName ?? '未绑定'}</span></span> },
    { id: 'runtime', header: '运行状态', cell: (t) => { const view = runtimeStatusView(t); return <div><StatusBadge dot status={view.badge} label={view.label} /><p className="mt-1 text-[11px] text-neutral-500" title={t.lastHeartbeatAt ? formatDateTime(t.lastHeartbeatAt) : undefined}>{t.lastHeartbeatAt ? formatRelativeTime(t.lastHeartbeatAt) : '从未连接'}</p>{view.detail && <p className="mt-1 text-[11px] text-warning-fg">{view.detail}</p>}</div> } },
    { id: 'lifecycle', header: '启停与生命周期', cell: (t) => { const view = lifecycleView(t.lifecycleStatus); return <div className="flex flex-wrap gap-1.5"><StatusBadge dot status={t.enabled ? 'success' : 'error'} label={t.enabled ? '启用' : '停用'} /><StatusBadge dot status={view.badge} label={view.label} /></div> } },
    { id: 'actions', header: '操作', sticky: true, align: 'right', cell: (t) => <button type="button" onClick={() => setSelectedId(t.id)} className="inline-flex h-8 items-center rounded-md bg-primary-600 px-3 text-xs font-semibold text-white hover:bg-primary-700" aria-label={`管理 ${t.terminalCode}`}>管理</button> },
  ]

  return (
    <>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <div className="flex h-[34px] min-w-[280px] items-center gap-2 rounded-[9px] border border-neutral-900/10 bg-surface px-3"><SearchIcon className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" /><input value={search} onChange={(event) => { setSearch(event.target.value); setSelectedIds([]) }} placeholder="搜索编号、设备名、MAC、位置、IP..." className="min-w-0 flex-1 bg-transparent text-[13px] text-neutral-900 outline-none placeholder:text-neutral-500" /></div>
        {FILTERS.map((item) => <FilterChip key={item} active={filter === item} label={item} count={counts[item]} onClick={() => { setFilter(item); setPage(1); setSelectedIds([]) }} />)}
        <input aria-label="按批次号筛选" value={batchIdFilter} onChange={(event) => { setBatchIdFilter(event.target.value.trim()); setPage(1); setSelectedIds([]) }} placeholder="批次号" className="h-[34px] w-40 rounded-[9px] border border-neutral-900/10 bg-surface px-3 font-mono text-[13px] text-neutral-900 outline-none" />
        <div className="ml-auto flex flex-wrap items-center gap-2"><span className="text-[12.5px] text-neutral-500">共 {filtered.length} 台终端</span><span className="text-[12.5px] text-neutral-500" data-testid="terminal-batch-selected-count">已勾选 {visibleSelectedIds.length} 台</span><button type="button" onClick={() => { setCreatingBatch(true); setNotice(null) }} className="inline-flex h-[30px] items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50">批量预建</button><button type="button" disabled={batchBusy} onClick={() => void runBatchCodes('issue')} className="inline-flex h-[30px] items-center rounded-[9px] border border-neutral-200 bg-surface px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">{batchActionTitle('批量生成绑定码')}</button><button type="button" disabled={batchBusy} onClick={() => void runBatchRevoke()} className="inline-flex h-[30px] items-center rounded-[9px] border border-neutral-200 bg-surface px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">{batchActionTitle('作废绑定码')}</button><button type="button" disabled={batchBusy} onClick={() => void runBatchCodes('reissue')} className="inline-flex h-[30px] items-center rounded-[9px] border border-neutral-200 bg-surface px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">{batchActionTitle('重新生成绑定码')}</button><button type="button" onClick={() => { setCreatingPlannedTerminal(true); setNotice(null) }} className="inline-flex h-[30px] items-center gap-1.5 rounded-[9px] bg-primary-600 px-3 text-xs font-bold text-white hover:bg-primary-700"><PlusIcon className="h-3.5 w-3.5" aria-hidden="true" />预创建设备</button><button type="button" onClick={() => void refresh()} className="inline-flex h-[30px] items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-3 text-xs font-bold text-neutral-700 hover:bg-neutral-50"><RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />刷新</button></div>
      </div>
      {notice && <div className={`mb-3 rounded-[9px] border px-4 py-3 text-sm ${notice.type === 'success' ? 'border-success/20 bg-success-bg text-success-fg' : 'border-error/20 bg-error-bg text-error-fg'}`}>{notice.text}</div>}
      <Card className="overflow-hidden p-0">
        <ConsoleTable items={paginated} columns={columns} loading={loading} error={failed ? { title: '终端数据加载失败', message: '请稍后重试', onRetry: () => void refresh() } : null} empty={{ title: search ? '未找到匹配的终端' : '该分类暂无终端', description: search ? '请尝试其他关键词' : undefined }} page={page} pageSize={pageSize} total={filtered.length} onPageChange={(next) => { setPage(next); setSelectedIds([]) }} onPageSizeChange={(size) => { setPageSize(size); setPage(1); setSelectedIds([]) }} />
      </Card>
      <ReleaseObservationPanel terminals={terminals} onNotice={setNotice} />
      <p className="mt-3 text-xs text-neutral-500">终端在线状态、链路诊断、打印机状态、扫描输入、版本、IP、磁盘均来自终端程序（Terminal Agent）的定时上报；链路诊断不展示 WiFi 名称、密码、网关或打印机地址{API_MODE !== 'http' && '（当前为 mock 演示数据，归属变更不写数据库）'}</p>
      <p className="mt-1 text-xs text-neutral-500">「扫描输入」锁死后只能到现场重启终端程序恢复，后台不提供远程解除；显示「未上报」表示这台终端还没报这一组字段，不等于正常。</p>
      <p className="mt-1 text-xs text-neutral-500">「所属机构」决定该终端归属；学校账号在合作机构后台只能配置归属本校的智慧校园开关。绑定/解绑仅管理员可操作，变更写入审计日志。</p>
      <TerminalDetailDrawer terminal={selected} organizations={orgOptions} orgLoadError={orgLoadError} orgLicenseError={orgLicenseError} notice={notice} editingOrg={selected ? editingId === selected.id : false} editOrgValue={editValue} savingOrg={saving} profileEditing={selected ? profileEditingId === selected.id : false} profileDraft={profileDraft} profileSaving={profileSaving} statusSaving={selected ? statusSavingId === selected.id : false} lifecycleSaving={selected ? lifecycleSavingId === selected.id : false} onClose={closeDetail} onOpenBindCode={openBindCodeModal} onStartProfileEdit={startProfileEdit} onCancelProfileEdit={cancelProfileEdit} onSaveProfile={(terminal) => void saveProfile(terminal)} onProfileDraftChange={(patch) => setProfileDraft((current) => ({ ...current, ...patch }))} onStartOrgEdit={startOrgEdit} onCancelOrgEdit={cancelOrgEdit} onSaveOrg={(terminal) => void saveOrg(terminal)} onOrgChange={(value) => { setEditValue(value); setOrgLicenseError(null) }} onToggleStatus={(terminal) => void toggleStatus(terminal)} onLifecycleBusy={(busy) => setLifecycleSavingId(busy && selected ? selected.id : null)} onLifecycleUpdated={(result) => { if (selected) handleLifecycleUpdated(selected, result) }} onLifecycleConflict={() => { void refresh().catch(() => undefined) }} onNotice={setNotice} serverListIssuedAt={terminalData?.listIssuedAt ?? 0} onHomeFreeBadgeSaved={handleHomeFreeBadgeSaved} onChargeSaved={handleChargeSaved} chargeResetNotice={chargeResetNotice} />
      {bindCodeTerminal && <TerminalBindCodeDialog terminal={bindCodeTerminal} onClose={() => setBindCodeTerminal(null)} onNotice={setNotice} />}
      {creatingPlannedTerminal && <CreatePlannedTerminalDialog organizations={orgOptions} onClose={() => setCreatingPlannedTerminal(false)} onCreated={(code) => { setCreatingPlannedTerminal(false); setNotice({ type: 'success', text: `已预创建设备 ${code}；请在设备列表中生成一次性绑定码完成安装。` }); void refresh() }} onError={(message) => setNotice({ type: 'error', text: message })} />}
      {creatingBatch && <TerminalBatchCreateDialog organizations={orgOptions} onClose={() => setCreatingBatch(false)} onCreated={(batchId, count) => { setCreatingBatch(false); setBatchIdFilter(batchId); setPage(1); setSelectedIds([]); setNotice({ type: 'success', text: `已预建 ${count} 台，批次号 ${batchId}` }); void refresh() }} onError={(message) => setNotice({ type: 'error', text: message })} />}
      {batchCodes && <TerminalBatchCodeDialog title="绑定码只显示这一次" result={batchCodes} onClose={() => setBatchCodes(null)} />}
    </>
  )
}
