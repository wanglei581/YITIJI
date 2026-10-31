import { useEffect, useRef } from 'react'
import { MeArt } from '../../touch/MeIllus'

export function SettingsConfirm({ title, description, confirmLabel, cancelLabel = '取消', confirmDetail, cancelDetail, labelledBy, describedBy, testId, danger, busy = false, error, onConfirm, onCancel, layout = 'dialog' }: {
  title: string
  description: string
  confirmLabel: string
  /** 左边那颗（按 Esc 也走它）。默认「取消」。 */
  cancelLabel?: string
  /** 卡片上标题下面那句。读屏会连同标题一起念出来。 */
  confirmDetail?: string
  cancelDetail?: string
  /** 卡片形态借用屏上已有标题时传入，避免再写一遍标题。 */
  labelledBy?: string
  describedBy?: string
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
  const cancelRef = useRef<HTMLButtonElement>(null)
  // 卡片形态按 Esc 等于「不是我」。处理函数放进 ref，父组件每次重绘换新函数也不会重绑监听、重抢焦点。
  const latestCancel = useRef(onCancel)
  useEffect(() => { latestCancel.current = onCancel })
  useEffect(() => {
    if (layout !== 'cards') return
    // 出现时焦点落在「不是我」那张卡上：误触回车只会结束使用，不会把上一位的资料亮出来。
    cancelRef.current?.focus()
  }, [layout])
  useEffect(() => {
    if (layout !== 'cards') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      latestCancel.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [layout, busy])
  useEffect(() => {
    if (layout === 'cards') return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => { previous?.focus() }
  }, [layout])
  if (layout === 'cards') {
    const labelId = labelledBy ?? 'account-action-title'
    const descId = describedBy ?? 'account-action-desc'
    return (
      <div data-testid={testId} role="alertdialog" aria-modal="true" aria-labelledby={labelId} aria-describedby={descId}>
        {labelledBy ? null : <h2 id="account-action-title">{title}</h2>}
        {describedBy ? null : <p id="account-action-desc">{description}</p>}
        {error ? <p role="alert" className="settings-error">{error}</p> : null}
        <div className="me-answers">
          <button type="button" data-variant="primary" disabled={busy} onClick={onConfirm}>
            <span className="me-answer-art" data-art="resume"><MeArt name="resume" width={380} /></span>
            <span>
              <b>{busy ? '处理中…' : confirmLabel}</b>
              {confirmDetail ? <small>{confirmDetail}</small> : null}
            </span>
          </button>
          <button type="button" ref={cancelRef} autoFocus disabled={busy} onClick={onCancel}>
            {/* 「不是我」配一叠纸：清掉这台机器上这一次的临时信息，同触屏稿「本机会清除」那张卡的用图。
                不用手机 + 「上传」的插画（10/29 本机走查 I-06：与「结束上一位的使用」的意思不搭）。 */}
            <span className="me-answer-art" data-art="stack"><MeArt name="stack" width={300} /></span>
            <span>
              <b>{cancelLabel}</b>
              {cancelDetail ? <small>{cancelDetail}</small> : null}
            </span>
          </button>
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
