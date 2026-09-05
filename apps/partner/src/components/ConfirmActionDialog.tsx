import { Button } from '@ai-job-print/ui'

interface ConfirmActionDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  busy?: boolean
  tone?: 'warning' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}

/** 危险操作二次确认。取消必须不改数据。 */
export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  busy = false,
  tone = 'warning',
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="partner-confirm-title"
      aria-describedby="partner-confirm-desc"
    >
      <div className="w-full max-w-md rounded-xl bg-surface p-6 shadow-xl">
        <h2 id="partner-confirm-title" className="text-base font-semibold text-neutral-900">
          {title}
        </h2>
        <p id="partner-confirm-desc" className="mt-2 text-sm leading-relaxed text-neutral-600">
          {description}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            size="sm"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
