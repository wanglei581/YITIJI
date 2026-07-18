import { useEffect, useRef, useState } from 'react'
import { StatusBadge } from '@ai-job-print/ui'
import { Field, GhostButton, PrimaryButton } from '../../components/form'

// ─── 样式常量 ─────────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ReviewDialogProps {
  open: boolean
  agencyName: string
  currentStatus: string
  onClose: () => void
  onApprove: () => Promise<void>
  onReject: (reason: string) => Promise<void>
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ReviewDialog({
  open,
  agencyName,
  currentStatus,
  onClose,
  onApprove,
  onReject,
}: ReviewDialogProps) {
  const [mode, setMode]           = useState<'idle' | 'rejecting'>('idle')
  const [rejectReason, setReason] = useState('')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const firstFocusRef             = useRef<HTMLButtonElement>(null)

  // 打开时重置状态
  useEffect(() => {
    if (open) {
      setMode('idle')
      setReason('')
      setError(null)
      setTimeout(() => firstFocusRef.current?.focus(), 50)
    }
  }, [open])

  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, busy, onClose])

  if (!open) return null

  const run = async (op: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await op()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label="审核机构"
      >
        {/* Header */}
        <div className="border-b border-neutral-100 px-6 py-4">
          <h2 className="text-base font-semibold text-neutral-800">审核机构</h2>
          <p className="mt-0.5 text-sm text-neutral-500 truncate">{agencyName}</p>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-center gap-2 text-sm text-neutral-600">
            <span>当前状态：</span>
            <StatusBadge dot status={STATUS_BADGE[currentStatus]?.status ?? 'default'} label={STATUS_BADGE[currentStatus]?.label ?? currentStatus} />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          {mode === 'rejecting' ? (
            <div className="space-y-3 rounded-lg border border-red-100 bg-red-50/60 p-4">
              <Field label="驳回原因" required>
                <textarea
                  className={`${inputCls} h-20 resize-none`}
                  placeholder="请填写驳回原因（将记录在审核日志中）"
                  value={rejectReason}
                  onChange={(e) => setReason(e.target.value)}
                  autoFocus
                />
              </Field>
              <div className="flex justify-end gap-2">
                <GhostButton disabled={busy} onClick={() => setMode('idle')}>取消</GhostButton>
                <button
                  disabled={busy || !rejectReason.trim()}
                  onClick={() => void run(() => onReject(rejectReason.trim()))}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? '提交中…' : '确认驳回'}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-neutral-600">
              选择审核操作。通过后机构可发布至一体机展示；驳回后机构回到草稿状态。
            </p>
          )}
        </div>

        {/* Footer */}
        {mode === 'idle' && (
          <div className="flex items-center justify-end gap-2 border-t border-neutral-100 px-6 py-4">
            <GhostButton disabled={busy} onClick={onClose}>取消</GhostButton>
            <button
              ref={firstFocusRef}
              disabled={busy || currentStatus === 'rejected'}
              onClick={() => setMode('rejecting')}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              驳回…
            </button>
            <PrimaryButton
              disabled={busy || currentStatus === 'approved'}
              onClick={() => void run(onApprove)}
            >
              {busy ? '提交中…' : '通过审核'}
            </PrimaryButton>
          </div>
        )}
      </div>
    </div>
  )
}

const STATUS_BADGE: Record<string, { status: 'success' | 'warning' | 'error' | 'info' | 'default'; label: string }> = {
  pending:   { status: 'warning', label: '待审核' },
  reviewing: { status: 'info',    label: '审核中' },
  approved:  { status: 'success', label: '已通过' },
  rejected:  { status: 'error',   label: '已驳回' },
}
