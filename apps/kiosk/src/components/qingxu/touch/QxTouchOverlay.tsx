import { useEffect, useId, useRef, type ReactNode } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusableIn(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.getAttribute('aria-disabled') === 'true') return false
    if (el.closest('[aria-hidden="true"]')) return false
    return el.tabIndex >= 0
  })
}

/**
 * 弹层。遮罩默认不关闭（公共大屏手掌容易碰到）。
 * Esc 只在允许点遮罩关闭时才关。打开时焦点进弹层，Tab 在弹层内循环，关闭后还给原处。
 */
export function QxTouchOverlay({
  kind,
  title,
  children,
  onClose,
  dismissOnScrim = false,
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
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const dismissRef = useRef(dismissOnScrim)
  onCloseRef.current = onClose
  dismissRef.current = dismissOnScrim

  useEffect(() => {
    const panel = panelRef.current
    const previous = document.activeElement
    const restore = previous instanceof HTMLElement && panel && !panel.contains(previous) ? previous : null
    panel?.focus({ preventScroll: true })

    const onKey = (event: KeyboardEvent) => {
      const current = panelRef.current
      if (event.key === 'Escape') {
        if (!dismissRef.current) return
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !current) return
      const items = focusableIn(current)
      if (items.length === 0) {
        event.preventDefault()
        current.focus({ preventScroll: true })
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      const inside = active instanceof Node && current.contains(active)
      if (event.shiftKey) {
        if (!inside || active === first || active === current) {
          event.preventDefault()
          last.focus({ preventScroll: true })
        }
        return
      }
      if (!inside || active === last || active === current) {
        event.preventDefault()
        first.focus({ preventScroll: true })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (restore?.isConnected) restore.focus({ preventScroll: true })
    }
  }, [])

  const closeScrim = () => {
    if (dismissRef.current) onCloseRef.current()
  }
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation()

  if (kind === 'sheet') {
    return (
      <>
        <div className="qxt-scrim" onClick={closeScrim} />
        <div
          ref={panelRef}
          className="qxt-sheet"
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onClick={stop}
        >
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
        ref={panelRef}
        className="qxt-dialog"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={stop}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
        {actions ? <div className="qxt-dialog-btns">{actions}</div> : null}
      </div>
    </div>
  )
}
