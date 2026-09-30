import { formatDate, formatDateTime, formatRelativeTime } from '@ai-job-print/shared'
import { Button, Drawer, StatusBadge } from '@ai-job-print/ui'
import { Building2Icon, CheckIcon, KeyRoundIcon, PencilIcon, XIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type {
  AdminOrganizationOption,
  AdminTerminalRecord,
  EmergencyRevokeTerminalResult,
  UpdateTerminalLifecycleResult,
  UpdateTerminalProfileInput,
} from '../../services/api/devices'
import { isParkedOrgType } from '../partners/orgTypeOptions'
import { ReleaseObservationPanel } from './ReleaseObservationPanel'
import { TerminalLifecycleActions } from './TerminalLifecycleActions'
import { TerminalNetworkDiagnostics } from './TerminalNetworkDiagnostics'
import { fmtDisk, lifecycleView, printerStatusView, scanInputView } from './terminalStatusViews'

type Notice = { type: 'success' | 'error'; text: string }

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-900/[0.08] px-4 py-3">
      <h3 className="text-[13px] font-bold text-neutral-800">{title}</h3>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  )
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt className="shrink-0 text-neutral-500">{label}</dt>
      <dd className="text-right font-medium text-neutral-900">{children}</dd>
    </div>
  )
}

function OfflineReportedStatus({ originalLabel, observedAt }: { originalLabel: string | null; observedAt: string | null }) {
  return (
    <div className="space-y-1">
      <StatusBadge dot status="default" label="终端离线" />
      {originalLabel && (
        <p className="text-[11px] text-neutral-500" title={observedAt ? formatDateTime(observedAt) : undefined}>
          离线前最后一次上报：{originalLabel}{observedAt ? `（${formatRelativeTime(observedAt)}）` : ''}
        </p>
      )}
    </div>
  )
}

const RELEASE_LABEL: Record<string, string> = {
  draft: '草稿',
  paused: '已暂停',
  expired: '观察结束',
  not_seen: '尚未看到',
  unverified: '版本未验证',
  current: '版本匹配（未验包）',
  mismatch: '版本不匹配',
  stale: '心跳陈旧',
}

export interface TerminalDetailDrawerProps {
  terminal: AdminTerminalRecord | null
  allTerminals: AdminTerminalRecord[]
  organizations: AdminOrganizationOption[]
  orgLoadError: string | null
  editingOrg: boolean
  editOrgValue: string
  savingOrg: boolean
  profileEditing: boolean
  profileDraft: UpdateTerminalProfileInput
  profileSaving: boolean
  statusSaving: boolean
  lifecycleSaving: boolean
  onClose: () => void
  onOpenBindCode: (terminal: AdminTerminalRecord) => void
  onStartProfileEdit: (terminal: AdminTerminalRecord) => void
  onCancelProfileEdit: () => void
  onSaveProfile: (terminal: AdminTerminalRecord) => void
  onProfileDraftChange: (patch: UpdateTerminalProfileInput) => void
  onStartOrgEdit: (terminal: AdminTerminalRecord) => void
  onCancelOrgEdit: () => void
  onSaveOrg: (terminal: AdminTerminalRecord) => void
  onOrgChange: (value: string) => void
  onToggleStatus: (terminal: AdminTerminalRecord) => void
  onLifecycleBusy: (busy: boolean) => void
  onLifecycleUpdated: (result: UpdateTerminalLifecycleResult | EmergencyRevokeTerminalResult) => void
  onLifecycleConflict: () => void
  onNotice: (notice: Notice | null) => void
}

export function TerminalDetailDrawer({
  terminal,
  allTerminals,
  organizations,
  orgLoadError,
  editingOrg,
  editOrgValue,
  savingOrg,
  profileEditing,
  profileDraft,
  profileSaving,
  statusSaving,
  lifecycleSaving,
  onClose,
  onOpenBindCode,
  onStartProfileEdit,
  onCancelProfileEdit,
  onSaveProfile,
  onProfileDraftChange,
  onStartOrgEdit,
  onCancelOrgEdit,
  onSaveOrg,
  onOrgChange,
  onToggleStatus,
  onLifecycleBusy,
  onLifecycleUpdated,
  onLifecycleConflict,
  onNotice,
}: TerminalDetailDrawerProps) {
  if (!terminal) return <Drawer open={false} onClose={onClose} title="终端详情"><div /></Drawer>

  const runtime = terminal.online
    ? { badge: 'success' as const, label: '在线' }
    : { badge: 'error' as const, label: '离线' }
  const lifecycle = lifecycleView(terminal.lifecycleStatus)
  const printer = printerStatusView(terminal.printerStatus ?? null)
  const scan = scanInputView(terminal)
  const canCreateBindCode = terminal.lifecycleStatus === 'planned' || terminal.lifecycleStatus === 'maintenance'
  const bindCodeTitle = !terminal.enabled
    ? '停用终端不可生成绑定码'
    : terminal.lifecycleStatus === 'active'
      ? '换机前请先进入维护，确认停止领取新任务后再生成绑定码'
      : canCreateBindCode
        ? terminal.lifecycleStatus === 'planned' ? '生成首次安装绑定码' : '生成换机绑定码'
        : `当前状态 ${terminal.lifecycleStatus} 不允许生成绑定码`

  return (
    <Drawer open onClose={onClose} title={`${terminal.displayName || terminal.terminalCode} · 终端详情`} size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge dot status={runtime.badge} label={runtime.label} />
          <StatusBadge dot status={terminal.enabled ? 'success' : 'error'} label={terminal.enabled ? '启用' : '停用'} />
          <StatusBadge dot status={lifecycle.badge} label={lifecycle.label} />
          <span className="font-mono text-xs text-neutral-500">{terminal.terminalCode}</span>
        </div>

        <Section title="基本信息">
          {profileEditing ? (
            <div className="space-y-2">
              <input value={profileDraft.displayName ?? ''} onChange={(e) => onProfileDraftChange({ displayName: e.target.value })} disabled={profileSaving} placeholder="设备名称" className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm" />
              <input value={profileDraft.macAddress ?? ''} onChange={(e) => onProfileDraftChange({ macAddress: e.target.value })} disabled={profileSaving} placeholder="MAC 地址" className="h-9 w-full rounded-md border border-neutral-200 px-3 font-mono text-xs" />
              <input value={profileDraft.locationLabel ?? ''} onChange={(e) => onProfileDraftChange({ locationLabel: e.target.value })} disabled={profileSaving} placeholder="摆放位置" className="h-9 w-full rounded-md border border-neutral-200 px-3 text-sm" />
              <label className="flex items-center gap-2 text-sm text-neutral-600"><input type="checkbox" checked={profileDraft.enabled ?? true} onChange={(e) => onProfileDraftChange({ enabled: e.target.checked })} disabled={profileSaving || terminal.lifecycleStatus === 'retired'} />启用终端</label>
              <div className="flex justify-end gap-2"><Button size="sm" variant="outline" onClick={onCancelProfileEdit} disabled={profileSaving}><XIcon className="mr-1 h-3.5 w-3.5" />取消</Button><Button size="sm" onClick={() => onSaveProfile(terminal)} disabled={profileSaving}><CheckIcon className="mr-1 h-3.5 w-3.5" />保存档案</Button></div>
            </div>
          ) : (
            <>
              <DetailRow label="设备名称">{terminal.displayName || '未命名终端'}</DetailRow>
              <DetailRow label="摆放位置">{terminal.locationLabel || '未设置摆放位置'}</DetailRow>
              <DetailRow label="MAC 地址"><span className="font-mono text-xs">{terminal.macAddress ?? '未上报'}</span></DetailRow>
              <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => onStartProfileEdit(terminal)} disabled={statusSaving}><PencilIcon className="mr-1 h-3.5 w-3.5" />编辑档案</Button></div>
            </>
          )}
        </Section>

        <Section title="所属机构">
          {editingOrg ? (
            <>
              {orgLoadError && <p className="text-xs text-error-fg">{orgLoadError}</p>}
              <div className="flex gap-2">
                <select value={editOrgValue} onChange={(e) => onOrgChange(e.target.value)} disabled={savingOrg} className="h-9 min-w-0 flex-1 rounded-md border border-neutral-200 bg-surface px-2 text-sm" aria-label={`设置 ${terminal.terminalCode} 所属机构`}>
                  <option value="">未绑定（解绑）</option>
                  {terminal.orgId && !organizations.some((item) => item.id === terminal.orgId) && <option value={terminal.orgId} disabled>{terminal.orgName ?? terminal.orgId}{isParkedOrgType(terminal.orgType) ? '（类型已停放，请改绑）' : '（当前不可选）'}</option>}
                  {organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
                <Button size="sm" onClick={() => onSaveOrg(terminal)} disabled={savingOrg} aria-label="保存归属"><CheckIcon className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" onClick={onCancelOrgEdit} disabled={savingOrg} aria-label="取消"><XIcon className="h-4 w-4" /></Button>
              </div>
            </>
          ) : (
            <>
              <DetailRow label="当前机构"><span className="inline-flex items-center gap-1 rounded-full bg-info-bg px-2 py-0.5 text-info-fg"><Building2Icon className="h-3 w-3" />{terminal.orgName ?? '未绑定'}</span></DetailRow>
              {isParkedOrgType(terminal.orgType) && <p className="text-xs text-warning-fg">该机构类型已停放，建议改绑到运营机构。</p>}
              <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => onStartOrgEdit(terminal)} disabled={statusSaving}>{terminal.orgName ? '更改机构' : '绑定机构'}</Button></div>
            </>
          )}
        </Section>

        <Section title="运行与网络">
          <DetailRow label="最近心跳"><span title={terminal.lastHeartbeatAt ? formatDateTime(terminal.lastHeartbeatAt) : undefined}>{terminal.lastHeartbeatAt ? formatRelativeTime(terminal.lastHeartbeatAt) : '从未连接'}</span></DetailRow>
          <DetailRow label="终端程序版本"><span className="font-mono text-xs">{terminal.agentVersion ?? '未上报'}</span></DetailRow>
          <DetailRow label="IP 地址"><span className="font-mono text-xs">{terminal.ipAddress ?? '未上报'}</span></DetailRow>
          <DetailRow label="磁盘可用">{fmtDisk(terminal.diskFreeGb)}</DetailRow>
          <div><p className="mb-1 text-xs text-neutral-500">链路诊断</p><TerminalNetworkDiagnostics online={terminal.online} wiredNetworkStatus={terminal.wiredNetworkStatus} printerNetworkStatus={terminal.printerNetworkStatus} /></div>
          <DetailRow label="打印机状态">{terminal.online ? <StatusBadge dot status={printer.badge} label={printer.label} /> : <OfflineReportedStatus originalLabel={terminal.printerStatus ? printer.label : null} observedAt={terminal.lastHeartbeatAt} />}</DetailRow>
          <div data-testid="terminal-scan-input"><p className="mb-1 text-xs text-neutral-500">扫描输入</p><div className="space-y-1">{terminal.online ? <><StatusBadge dot status={scan.badge} label={scan.label} />{scan.detail && <p className="text-xs text-warning-fg">{scan.detail}</p>}{scan.restart && <p className="text-xs text-warning-fg">需重启终端程序（Terminal Agent）恢复（不支持远程解除）</p>}{terminal.scanInputObservedAt && <p className="text-[11px] text-neutral-500" title={formatDateTime(terminal.scanInputObservedAt)}>{formatRelativeTime(terminal.scanInputObservedAt)}</p>}</> : <OfflineReportedStatus originalLabel={terminal.scanInputHealth ? scan.label : null} observedAt={terminal.scanInputObservedAt ?? terminal.lastHeartbeatAt} />}</div></div>
        </Section>

        <Section title="生命周期与启停">
          <div><p className="mb-2 text-sm text-neutral-500">生命周期操作</p><TerminalLifecycleActions terminal={terminal} disabled={statusSaving || lifecycleSaving || profileSaving || savingOrg} onBusyChange={onLifecycleBusy} onUpdated={onLifecycleUpdated} onConflict={onLifecycleConflict} onNotice={onNotice} /></div>
          <div className="border-t border-neutral-900/[0.06] pt-3"><button type="button" onClick={() => onOpenBindCode(terminal)} disabled={statusSaving || lifecycleSaving || !terminal.enabled || !canCreateBindCode} title={bindCodeTitle} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-3 text-xs font-medium text-primary-700 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50"><KeyRoundIcon className="h-3.5 w-3.5" />生成绑定码</button><p className="mt-1 text-[11px] text-neutral-500">{bindCodeTitle}</p></div>
          <div className="flex items-center justify-between gap-3"><span className="text-sm text-neutral-500">启停状态</span><div className="flex items-center gap-2"><StatusBadge dot status={terminal.enabled ? 'success' : 'error'} label={terminal.enabled ? '启用' : '停用'} /><button type="button" onClick={() => onToggleStatus(terminal)} disabled={statusSaving || profileSaving || savingOrg || lifecycleSaving || terminal.lifecycleStatus === 'retired'} className={`rounded-md border px-2 py-1 text-xs font-medium ${terminal.enabled ? 'border-error/20 text-error-fg hover:bg-error-bg' : 'border-success/20 text-success-fg hover:bg-success-bg'}`}>{statusSaving ? '保存中' : terminal.enabled ? '停用' : '启用'}</button></div></div>
        </Section>

        <Section title="更新观察与注册信息">
          <DetailRow label="更新观察">{terminal.releaseObservation ? <span>{RELEASE_LABEL[terminal.releaseObservation.state] ?? '未知'}{terminal.releaseObservation.targetVersion ? ` · 目标 ${terminal.releaseObservation.targetVersion}` : ''}</span> : '无计划'}</DetailRow>
          <DetailRow label="注册时间"><span title={formatDateTime(terminal.registeredAt)}>{formatDate(terminal.registeredAt)}</span></DetailRow>
        </Section>

        <ReleaseObservationPanel terminals={allTerminals} onNotice={onNotice} />
      </div>
    </Drawer>
  )
}
