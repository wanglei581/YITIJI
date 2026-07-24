import { X } from 'lucide-react'
import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface KioskModalProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  actions?: ReactNode
  closeLabel?: string
  closeOnBackdrop?: boolean
  closeOnEscape?: boolean
  className?: string
}

export function KioskModal(props: KioskModalProps) {
  const {
    open,
    onClose,
    title,
    description,
    children,
    actions,
    closeLabel = '关闭',
    closeOnBackdrop = true,
    closeOnEscape = true,
    className,
  } = props
  const dialogRef = useRef<HTMLDivElement>(null)
  const baseId = useId()
  const titleId = `${baseId}-title`
  const descriptionId = `${baseId}-description`

  useEffect(() => {
    if (!open) return

    const previousFocusedElement = document.activeElement
    const previousBodyOverflow = document.body.style.overflow

    function handleKeyDown(event: KeyboardEvent) {
      if (!closeOnEscape || event.key !== 'Escape') return
      onClose()
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    dialogRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousBodyOverflow
      if (previousFocusedElement instanceof HTMLElement) previousFocusedElement.focus()
    }
  }, [closeOnEscape, onClose, open])

  if (!open) return null

  function handleBackdropClick() {
    if (closeOnBackdrop) onClose()
  }

  function handleDialogClick(event: MouseEvent<HTMLDivElement>) {
    event.stopPropagation()
  }

  return (
    <div className="ui-kiosk-modal-layer">
      <div
        className="ui-kiosk-modal-backdrop"
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        className={cn('ui-kiosk-modal-dialog', className)}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onClick={handleDialogClick}
      >
        <div className="ui-kiosk-modal-header">
          <div className="ui-kiosk-modal-heading">
            <h2 id={titleId} className="ui-kiosk-modal-title">{title}</h2>
            {description && (
              <p id={descriptionId} className="ui-kiosk-modal-description">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="ui-kiosk-modal-close"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        {children && <div className="ui-kiosk-modal-content">{children}</div>}
        {actions && <div className="ui-kiosk-modal-actions">{actions}</div>}
      </div>
    </div>
  )
}
