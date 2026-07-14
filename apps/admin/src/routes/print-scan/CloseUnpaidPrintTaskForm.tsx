import { useState } from 'react'
import { adminPrintScanService } from '../../services/api/printScan'

const MIN_REASON_LENGTH = 10
const MAX_REASON_LENGTH = 500

export function CloseUnpaidPrintTaskForm({
  taskId,
  expectedUpdatedAt,
  onClosed,
}: {
  taskId: string
  expectedUpdatedAt: string
  onClosed: () => Promise<void> | void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedReason = reason.trim()
  const reasonValid = trimmedReason.length >= MIN_REASON_LENGTH && trimmedReason.length <= MAX_REASON_LENGTH

  const close = () => {
    if (busy) return
    setOpen(false)
    setConfirmed(false)
    setError(null)
  }

  const submit = async () => {
    if (busy || !reasonValid || !confirmed) return
    setBusy(true)
    setError(null)
    try {
      await adminPrintScanService.cancelUnpaidPrintTask(taskId, {
        reason: trimmedReason,
        expectedUpdatedAt,
      })
      setReason('')
      setConfirmed(false)
      setOpen(false)
      await onClosed()
    } catch (e) {
      setError(e instanceof Error ? e.message : '取消失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <div className="border-t border-neutral-900/10 pt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-10 w-full rounded-lg border border-error-text/30 bg-error-bg text-[13px] font-bold text-error-text"
        >
          取消未支付待打印任务
        </button>
      </div>
    )
  }

  return (
    <section className="space-y-3 border-t border-error-text/20 pt-3" aria-label="取消未支付打印任务">
      <div className="rounded-lg border border-error-text/20 bg-error-bg px-3 py-2 text-[12.5px] leading-relaxed text-error-text">
        此操作会取消当前未支付且尚未被领取的打印任务，无法恢复。请填写真实处置原因并确认后继续。
      </div>

      <label className="block text-[12.5px] font-bold text-neutral-700" htmlFor={`close-unpaid-reason-${taskId}`}>
        取消原因（10–500 字）
      </label>
      <textarea
        id={`close-unpaid-reason-${taskId}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        minLength={MIN_REASON_LENGTH}
        maxLength={MAX_REASON_LENGTH}
        disabled={busy}
        placeholder="例如：用户确认不再继续本次未支付打印，按运营流程关闭任务。"
        className="min-h-24 w-full resize-y rounded-lg border border-neutral-900/15 bg-surface px-3 py-2 text-[13px] text-neutral-800 placeholder:text-neutral-400 focus:border-error-text focus:outline-none focus:ring-1 focus:ring-error-text disabled:bg-neutral-100"
      />
      <div className="flex items-center justify-between text-[11.5px] text-neutral-500">
        <span>{reason.length} / {MAX_REASON_LENGTH}</span>
        {!reasonValid && reason.length > 0 && <span className="text-error-text">请填写 {MIN_REASON_LENGTH}–{MAX_REASON_LENGTH} 字的原因</span>}
      </div>

      <label className="flex items-start gap-2 rounded-lg border border-error-text/20 px-3 py-2 text-[12.5px] text-neutral-700">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={busy}
          onChange={(event) => setConfirmed(event.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-neutral-300"
        />
        <span>我确认该任务符合「未支付且尚未领取」的取消条件，并了解取消后不可恢复。</span>
      </label>

      {error && <div className="rounded-lg bg-error-bg px-3 py-2 text-[12.5px] font-bold text-error-text">{error}</div>}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={close}
          className="h-10 flex-1 rounded-lg border border-neutral-900/15 bg-surface text-[13px] font-bold text-neutral-700 disabled:opacity-50"
        >
          取消
        </button>
        <button
          type="button"
          disabled={busy || !reasonValid || !confirmed}
          onClick={() => void submit()}
          className="h-10 flex-1 rounded-lg bg-error-text text-[13px] font-bold text-white disabled:opacity-50"
        >
          {busy ? '取消中…' : '确认取消任务'}
        </button>
      </div>
    </section>
  )
}
