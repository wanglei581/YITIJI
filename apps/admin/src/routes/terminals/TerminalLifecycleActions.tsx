import { useState } from 'react'
import { StatusBadge } from '@ai-job-print/ui'
import { ApiHttpError } from '../../services/api/client'
import {
  emergencyRevokeTerminal,
  updateTerminalLifecycle,
  type AdminTerminalRecord,
  type EmergencyRevokeTerminalResult,
  type TerminalLifecycleStatus,
  type UpdateTerminalLifecycleResult,
} from '../../services/api/devices'

type Notice = { type: 'success' | 'error'; text: string }
type LifecycleAction = 'maintenance' | 'resume' | 'suspend' | 'retire' | 'emergency-revoke'

const LIFECYCLE_VIEW = {
  planned: { status: 'warning' as const, label: '待安装' },
  commissioning: { status: 'default' as const, label: '安装中' },
  active: { status: 'success' as const, label: '运行中' },
  maintenance: { status: 'warning' as const, label: '维护中' },
  suspended: { status: 'error' as const, label: '已暂停' },
  retired: { status: 'default' as const, label: '已退役（不可恢复）' },
}

const ACTION_LABEL: Record<LifecycleAction, string> = {
  maintenance: '进入维护',
  resume: '恢复运行',
  suspend: '暂停服务',
  retire: '永久退役设备',
  'emergency-revoke': '紧急吊销凭证',
}

interface TerminalLifecycleActionsProps {
  terminal: AdminTerminalRecord
  disabled?: boolean
  onBusyChange: (busy: boolean) => void
  onUpdated: (result: UpdateTerminalLifecycleResult | EmergencyRevokeTerminalResult) => void
  onConflict: () => void
  onNotice: (notice: Notice) => void
}

function availableActions(status: TerminalLifecycleStatus, hasActiveCredential: boolean): LifecycleAction[] {
  if (status === 'retired' || status === 'planned') return []
  const actions: LifecycleAction[] = []
  if (status === 'active') actions.push('maintenance')
  if (status === 'maintenance' || status === 'suspended') actions.push('resume')
  if (status === 'commissioning' || status === 'active' || status === 'maintenance') actions.push('suspend')
  if (status === 'maintenance' || status === 'suspended') actions.push('retire')
  if (hasActiveCredential) actions.push('emergency-revoke')
  return actions
}

export function TerminalLifecycleActions({
  terminal,
  disabled,
  onBusyChange,
  onUpdated,
  onConflict,
  onNotice,
}: TerminalLifecycleActionsProps) {
  const [action, setAction] = useState<LifecycleAction | null>(null)
  const [reason, setReason] = useState('')
  const [confirmationText, setConfirmationText] = useState('')
  const [saving, setSaving] = useState(false)
  const view = LIFECYCLE_VIEW[terminal.lifecycleStatus]
  const actions = availableActions(terminal.lifecycleStatus, terminal.hasActiveCredential)
  const normalizedReason = reason.trim()
  const reasonIsValid = normalizedReason.length >= 8 && normalizedReason.length <= 500
  const requiredConfirmation = action === 'retire'
    ? terminal.terminalCode
    : action === 'emergency-revoke' ? `吊销 ${terminal.terminalCode}` : null
  const confirmationIsValid = requiredConfirmation === null || confirmationText === requiredConfirmation

  function openAction(nextAction: LifecycleAction) {
    setAction(nextAction)
    setReason('')
    setConfirmationText('')
  }

  async function submit() {
    if (!action || !reasonIsValid || !confirmationIsValid) return
    setSaving(true)
    onBusyChange(true)
    try {
      if (action === 'emergency-revoke') {
        const result = await emergencyRevokeTerminal(terminal.terminalCode, {
          expectedStatus: terminal.lifecycleStatus as Exclude<TerminalLifecycleStatus, 'planned' | 'retired'>,
          expectedVersion: terminal.lifecycleVersion,
          expectedCredentialGeneration: terminal.credentialGeneration,
          reason: normalizedReason,
          confirmationText,
        })
        onUpdated(result)
        onNotice({
          type: 'success',
          text: `${terminal.terminalCode} 已紧急吊销凭证并转为暂停，吊销凭证 ${result.revokedCredentialCount} 个`,
        })
      } else {
        const targetStatus: UpdateTerminalLifecycleResult['newStatus'] = action === 'maintenance'
          ? 'maintenance'
          : action === 'resume' ? (terminal.lifecycleStatus === 'suspended' ? 'maintenance' : 'active')
            : action === 'suspend' ? 'suspended' : 'retired'
        const result = await updateTerminalLifecycle(terminal.terminalCode, {
          targetStatus,
          expectedStatus: terminal.lifecycleStatus,
          expectedVersion: terminal.lifecycleVersion,
          reason: normalizedReason,
          ...(action === 'retire' ? { confirmationText } : {}),
        })
        onUpdated(result)
        onNotice({
          type: 'success',
          text: `${terminal.terminalCode} 已${ACTION_LABEL[action]}，当前在途任务 ${result.inFlightTaskCount} 个`,
        })
      }
      setAction(null)
    } catch (error) {
      if (error instanceof ApiHttpError && error.status === 409) {
        onNotice({ type: 'error', text: '终端状态已变化，列表已刷新，请核对后重试。' })
        setAction(null)
        onConflict()
      } else {
        onNotice({ type: 'error', text: error instanceof Error ? error.message : '设备运维操作失败' })
      }
    } finally {
      setSaving(false)
      onBusyChange(false)
    }
  }

  return (
    <>
      <div className="flex min-w-[132px] flex-col items-start gap-1.5">
        <StatusBadge dot status={view.status} label={view.label} />
        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {actions.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => openAction(item)}
                disabled={disabled || saving}
                className={`h-7 whitespace-nowrap rounded-md border px-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
                  item === 'retire' || item === 'emergency-revoke'
                    ? 'border-error/20 bg-surface text-error-fg hover:bg-error-bg'
                    : 'border-neutral-200 bg-surface text-neutral-600 hover:bg-neutral-50'
                }`}
              >
                {ACTION_LABEL[item]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {action ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`${ACTION_LABEL[action]} ${terminal.terminalCode}`}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-neutral-900">{ACTION_LABEL[action]}</h3>
            <p className={`mt-2 rounded-md px-3 py-2 text-xs ${action === 'retire' || action === 'emergency-revoke' ? 'bg-error-bg text-error-fg' : 'bg-warning-bg text-warning-fg'}`}>
              {action === 'maintenance' && '设备将停止领取新任务，但会继续回传在途任务。'}
              {action === 'resume' && (terminal.lifecycleStatus === 'suspended' ? '设备将先恢复到维护状态，校验完成后才可再恢复运行。' : '设备将恢复领取新任务。')}
              {action === 'suspend' && '设备将停止领取新任务，保留凭证以继续心跳、诊断和在途回传。'}
              {action === 'emergency-revoke' && 'Agent 将立即失去认证能力并转为暂停；在途任务状态可能需要人工核查。'}
              {action === 'retire' && '这是不可逆操作。退役后不能恢复、重新绑定或领取任务。'}
            </p>
            <label className="mt-4 block text-xs font-medium text-neutral-700">操作原因（必填）</label>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              autoFocus
              disabled={saving}
              placeholder="请说明本次运维操作原因"
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600/15"
            />
            <p className="mt-1 text-[11px] text-neutral-500">请填写 8–500 个字符，当前 {normalizedReason.length} 个。</p>
            {requiredConfirmation ? (
              <label className="mt-3 block text-xs font-medium text-neutral-700">
                请输入 <code className="rounded bg-neutral-100 px-1">{requiredConfirmation}</code> 确认
                <input
                  value={confirmationText}
                  onChange={(event) => setConfirmationText(event.target.value)}
                  disabled={saving}
                  autoComplete="off"
                  className="mt-1 h-9 w-full rounded-md border border-neutral-200 px-3 font-mono text-sm outline-none focus:border-error"
                />
              </label>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setAction(null)} className="h-9 rounded-md border border-neutral-200 px-4 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">取消</button>
              <button type="button" disabled={saving || !reasonIsValid || !confirmationIsValid} onClick={() => void submit()} className={`h-9 rounded-md px-4 text-xs font-medium text-white disabled:opacity-50 ${action === 'retire' || action === 'emergency-revoke' ? 'bg-error hover:bg-error/90' : 'bg-primary-600 hover:bg-primary-700'}`}>
                {saving ? '提交中…' : `确认${ACTION_LABEL[action]}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
