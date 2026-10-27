import { useEffect, useRef } from 'react'

export function SettingsConfirm({ title, description, confirmLabel, cancelLabel = '取消', testId, danger, busy = false, error, onConfirm, onCancel, layout = 'dialog' }: {
  title: string
  description: string
  confirmLabel: string
  /** 左边那颗（按 Esc 也走它）。默认「取消」。 */
  cancelLabel?: string
  testId?: string
  danger?: boolean
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
  /** 默认仍是对话框。cards 只给「还是你吗？」整屏两张大按钮，其它确认框不变。 */
  layout?: 'dialog' | 'cards'
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (layout === 'cards') return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { previous?.focus() }
  }, [layout])
  if (layout === 'cards') {
    return (
      <div data-testid={testId} role="group" aria-labelledby="account-action-title">
        <h2 id="account-action-title">{title}</h2>
        <p id="account-action-desc">{description}</p>
        {error ? <p role="alert" className="settings-error">{error}</p> : null}
        <div className="qxt-handover-cards">
          <button type="button" data-variant="primary" disabled={busy} onClick={onConfirm}>{busy ? '处理中…' : confirmLabel}</button>
          <button type="button" disabled={busy} onClick={onCancel}>{cancelLabel}</button>
        </div>
      </div>
    )
  }
  return (
    <dialog ref={dialog} className="settings-confirm" data-testid={testId} aria-labelledby="account-action-title" aria-describedby="account-action-desc"
      onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}>
      <h2 id="account-action-title">{title}</h2>
      <p id="account-action-desc">{description}</p>
      {error ? <p role="alert" className="settings-error">{error}</p> : null}
      <div className="settings-actions">
        <button type="button" className="qx-btn" data-variant="ghost" disabled={busy} onClick={onCancel} autoFocus>{cancelLabel}</button>
        <button type="button" className="qx-btn" data-variant={danger ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>
          {busy ? '处理中…' : confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
