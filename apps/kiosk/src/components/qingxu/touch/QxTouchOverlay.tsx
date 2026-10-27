import { useEffect, useId, type ReactNode } from 'react'

export function QxTouchOverlay({
  kind,
  title,
  children,
  onClose,
  dismissOnScrim = true,
  actions,
}: {
  kind: 'dialog' | 'sheet'
  title: string
  children?: ReactNode
  onClose: () => void
  dismissOnScrim?: boolean
  actions?: ReactNode
}) {
  const titleId = useId()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const closeScrim = () => {
    if (dismissOnScrim) onClose()
  }

  if (kind === 'sheet') {
    return (
      <>
        <div className="qxt-scrim" onClick={closeScrim} />
        <div className="qxt-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
          <div className="qxt-grab" />
          <h2 id={titleId}>{title}</h2>
          {children}
          {actions}
        </div>
      </>
    )
  }

  return (
    <div className="qxt-overlay" onClick={closeScrim}>
      <div
        className="qxt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
        {actions ? <div className="qxt-dialog-btns">{actions}</div> : null}
      </div>
    </div>
  )
}
