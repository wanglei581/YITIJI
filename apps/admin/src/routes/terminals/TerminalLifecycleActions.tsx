import { useState } from 'react'
import { StatusBadge } from '@ai-job-print/ui'
import {
  updateTerminalLifecycle,
  type AdminTerminalRecord,
  type UpdateTerminalLifecycleResult,
} from '../../services/api/devices'

type Notice = { type: 'success' | 'error'; text: string }

const LIFECYCLE_VIEW = {
  planned: { status: 'warning' as const, label: '待安装' },
  commissioning: { status: 'default' as const, label: '安装中' },
  active: { status: 'success' as const, label: '运行中' },
  maintenance: { status: 'warning' as const, label: '维护中' },
  suspended: { status: 'error' as const, label: '已暂停' },
  retired: { status: 'default' as const, label: '已退役' },
}

interface TerminalLifecycleActionsProps {
  terminal: AdminTerminalRecord
  disabled?: boolean
  onBusyChange: (busy: boolean) => void
  onUpdated: (result: UpdateTerminalLifecycleResult) => void
  onNotice: (notice: Notice) => void
}

export function TerminalLifecycleActions({
  terminal,
  disabled,
  onBusyChange,
  onUpdated,
  onNotice,
}: TerminalLifecycleActionsProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const view = LIFECYCLE_VIEW[terminal.lifecycleStatus]
  const targetStatus = terminal.lifecycleStatus === 'active'
    ? 'maintenance'
    : terminal.lifecycleStatus === 'maintenance' ? 'active' : null
  const actionLabel = targetStatus === 'maintenance' ? '进入维护' : '恢复运行'
  const normalizedReason = reason.trim()
  const reasonIsValid = normalizedReason.length >= 8 && normalizedReason.length <= 500

  async function submit() {
    if (!targetStatus || !reasonIsValid) return
    if (terminal.lifecycleStatus !== 'active' && terminal.lifecycleStatus !== 'maintenance') return
    setSaving(true)
    onBusyChange(true)
    try {
      const result = await updateTerminalLifecycle(terminal.terminalCode, {
        targetStatus,
        expectedStatus: terminal.lifecycleStatus,
        expectedVersion: terminal.lifecycleVersion,
        reason: normalizedReason,
      })
      onUpdated(result)
      onNotice({
        type: 'success',
        text: `${terminal.terminalCode} 已${targetStatus === 'maintenance' ? '进入维护' : '恢复运行'}，当前在途任务 ${result.inFlightTaskCount} 个`,
      })
      setDialogOpen(false)
      setReason('')
    } catch (error) {
      onNotice({ type: 'error', text: error instanceof Error ? error.message : '设备运维状态更新失败' })
    } finally {
      setSaving(false)
      onBusyChange(false)
    }
  }

  return (
    <>
      <div className="flex flex-col items-start gap-1.5">
        <StatusBadge dot status={view.status} label={view.label} />
        {targetStatus ? (
          <button
            type="button"
            onClick={() => { setDialogOpen(true); setReason('') }}
            disabled={disabled || saving}
            className="h-7 whitespace-nowrap rounded-md border border-neutral-200 bg-surface px-2 text-xs font-medium text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>

      {dialogOpen && targetStatus ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`${actionLabel} ${terminal.terminalCode}`}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-neutral-900">{actionLabel}</h3>
            <p className="mt-1 text-xs text-neutral-500">
              终端 <span className="font-mono">{terminal.terminalCode}</span>
              {targetStatus === 'maintenance' ? ' 将停止领取新任务，但会继续回传在途任务。' : ' 将恢复领取新任务。'}
            </p>
            <label className="mt-4 block text-xs font-medium text-neutral-700">操作原因（必填）</label>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              autoFocus
              disabled={saving}
              placeholder={targetStatus === 'maintenance' ? '例如：更换主机前停止新任务' : '例如：维护完成并已核对设备'}
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-600/15"
            />
            <p className="mt-1 text-[11px] text-neutral-500">请填写 8–500 个字符，说明本次操作原因。</p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setDialogOpen(false)} className="h-9 rounded-md border border-neutral-200 px-4 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">取消</button>
              <button type="button" disabled={saving || !reasonIsValid} onClick={() => void submit()} className="h-9 rounded-md bg-primary-600 px-4 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {saving ? '提交中…' : `确认${actionLabel}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
