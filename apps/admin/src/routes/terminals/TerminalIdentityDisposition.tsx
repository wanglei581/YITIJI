import { useState } from 'react'
import { ApiHttpError } from '../../services/api/client'
import {
  acceptTerminalIdentity,
  confirmTerminalReplacement,
  type AdminTerminalRecord,
} from '../../services/api/devices'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { canRequestEmergencyRevoke, requestEmergencyRevoke } from './terminalEmergencyRevoke'

type Notice = { type: 'success' | 'error'; text: string }
type Pending = 'accept' | 'replace'

const EXPLAIN = {
  suspected_clone: '这个终端身份同时出现在另一台机器上，已暂停领打印任务。',
  suspected_replacement: '这台终端的硬件信息变了，可能换过主板或硬盘。',
} as const

const CONFIRM = {
  accept: { title: '放行', verb: '放行会', submit: '确认放行' },
  replace: { title: '确认换件', verb: '确认换件会', submit: '确认换件' },
} as const

/** 只有疑似克隆会暂停领任务；疑似换件只告警不停，不能说「解除暂停」。 */
function confirmBody(pending: 'accept' | 'replace', status: 'suspected_clone' | 'suspected_replacement'): string {
  const tail = status === 'suspected_clone' ? '覆盖存档，并恢复领打印任务。' : '覆盖存档，并清掉疑似换件的标记。'
  return `${CONFIRM[pending].verb}用最近一次上报的硬件信息${tail}`
}

/**
 * 疑似克隆 / 疑似换件才出现。吊销复用紧急吊销对话框。
 * 契约没给指纹对比数量，这里不显示指纹，也不编「几项一致」。
 */
export function TerminalIdentityDisposition({
  terminal,
  onConflict,
  onNotice,
}: {
  terminal: AdminTerminalRecord
  onConflict: () => void
  onNotice: (notice: Notice) => void
}) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const status = terminal.identityStatus
  if (status !== 'suspected_clone' && status !== 'suspected_replacement') return null

  const revokeAllowed = canRequestEmergencyRevoke(terminal.lifecycleStatus)
  const copy = pending ? CONFIRM[pending] : null

  async function submit() {
    if (!pending) return
    setSaving(true)
    setError(null)
    try {
      if (pending === 'accept') await acceptTerminalIdentity(terminal.id)
      else await confirmTerminalReplacement(terminal.id)
      onNotice({
        type: 'success',
        text: `${terminal.terminalCode} ${pending === 'accept' ? '已放行' : '已确认换件'}，硬件信息存档已更新。`,
      })
      setPending(null)
      onConflict()
    } catch (caught) {
      if (caught instanceof ApiHttpError && caught.code === 'TERMINAL_IDENTITY_NOTHING_PENDING') onConflict()
      const message = userMessageOf(caught, '身份处置失败，请稍后重试')
      setError(message)
      onNotice({ type: 'error', text: message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section data-testid="terminal-identity-disposition" className="rounded-lg border border-neutral-900/[0.08] px-4 py-3">
      <h3 className="text-[13px] font-bold text-neutral-800">身份处置</h3>
      <p className="mt-2 text-sm text-neutral-800">{EXPLAIN[status]}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => { setError(null); setPending('accept') }} className="h-9 rounded-md bg-primary-600 px-3 text-xs font-medium text-white hover:bg-primary-700">放行</button>
        <button type="button" onClick={() => { setError(null); setPending('replace') }} className="h-9 rounded-md border border-neutral-200 px-3 text-xs font-medium text-neutral-800 hover:bg-neutral-50">确认换件</button>
        <button
          type="button"
          disabled={!revokeAllowed}
          onClick={() => { setError(null); requestEmergencyRevoke(terminal.id) }}
          className="h-9 rounded-md border border-error/20 px-3 text-xs font-medium text-error-fg hover:bg-error-bg disabled:cursor-not-allowed disabled:opacity-50"
        >
          吊销
        </button>
      </div>
      {!revokeAllowed && <p className="mt-2 text-[11px] text-neutral-500">当前状态不能紧急吊销。</p>}
      {copy && (
        <div role="dialog" aria-modal="true" aria-label={`${copy.title} ${terminal.terminalCode}`} className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-neutral-900">{copy.title}</h3>
            <p className={`mt-2 rounded-md px-3 py-2 text-xs ${'bg-warning-bg text-warning-fg'}`}>{pending ? confirmBody(pending, status) : null}</p>
            {error && <p className="mt-3 rounded-md bg-error-bg px-3 py-2 text-xs text-error-fg">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" disabled={saving} onClick={() => setPending(null)} className="h-9 rounded-md border border-neutral-200 px-4 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">取消</button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void submit()}
                className={`h-9 rounded-md px-4 text-xs font-medium text-white disabled:opacity-50 ${'bg-primary-600 hover:bg-primary-700'}`}
              >
                {saving ? '提交中…' : copy.submit}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
