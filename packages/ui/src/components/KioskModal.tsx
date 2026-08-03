import { X } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { cn } from '../lib/cn'

interface ModalStackEntry {
  id: symbol
  dialogRef: RefObject<HTMLDivElement>
  priorFocus: HTMLElement | null
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

let modalStack: ModalStackEntry[] = []
let bodyScrollOwners = new Set<symbol>()
let savedBodyOverflow: string | null = null

function registerModal(entry: ModalStackEntry) {
  if (modalStack.some((candidate) => candidate.id === entry.id)) return
  modalStack = [...modalStack, entry]
}

function unregisterModal(id: symbol) {
  const index = modalStack.findIndex((entry) => entry.id === id)
  if (index < 0) {
    return {
      wasTopmost: false,
      removedEntry: undefined,
      nextTopmost: modalStack[modalStack.length - 1],
    }
  }

  const removedEntry = modalStack[index]
  const childEntry = modalStack[index + 1]
  const wasTopmost = index === modalStack.length - 1
  modalStack = modalStack.filter((entry) => entry.id !== id)

  const childFocusNeedsTransfer = childEntry && (
    !childEntry.priorFocus?.isConnected
    || removedEntry.dialogRef.current?.contains(childEntry.priorFocus)
  )
  if (childFocusNeedsTransfer) {
    modalStack = modalStack.map((entry) => (
      entry.id === childEntry.id
        ? { ...entry, priorFocus: removedEntry.priorFocus }
        : entry
    ))
  }

  return {
    wasTopmost,
    removedEntry,
    nextTopmost: modalStack[modalStack.length - 1],
  }
}

function isTopmostModal(id: symbol) {
  return modalStack[modalStack.length - 1]?.id === id
}

function acquireBodyScrollLock(id: symbol, observedOverflow: string) {
  if (!bodyScrollOwners.has(id)) {
    if (bodyScrollOwners.size === 0) savedBodyOverflow = observedOverflow
    bodyScrollOwners = new Set([...bodyScrollOwners, id])
  }
}

function releaseBodyScrollLock(id: symbol) {
  if (!bodyScrollOwners.has(id)) return false
  bodyScrollOwners = new Set([...bodyScrollOwners].filter((owner) => owner !== id))
  if (bodyScrollOwners.size > 0) {
    document.body.style.overflow = 'hidden'
    return false
  }
  document.body.style.overflow = savedBodyOverflow ?? ''
  savedBodyOverflow = null
  return true
}

function getFocusableElements(dialog: HTMLDivElement) {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => element.tabIndex >= 0
      && element.getAttribute('aria-hidden') !== 'true'
      && !element.hasAttribute('hidden')
      && !element.closest('[inert]')
      && element.getClientRects().length > 0,
  )
}

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
  const instanceIdRef = useRef(Symbol('kiosk-modal'))
  const onCloseRef = useRef(onClose)
  const closeOnBackdropRef = useRef(closeOnBackdrop)
  const closeOnEscapeRef = useRef(closeOnEscape)
  const baseId = useId()
  const titleId = `${baseId}-title`
  const descriptionId = `${baseId}-description`
  onCloseRef.current = onClose
  closeOnBackdropRef.current = closeOnBackdrop
  closeOnEscapeRef.current = closeOnEscape

  useEffect(() => {
    if (!open) return

    const instanceId = instanceIdRef.current
    const previousFocusedElement = document.activeElement
    const previousBodyOverflow = document.body.style.overflow
    const priorFocus = previousFocusedElement instanceof HTMLElement
      ? previousFocusedElement
      : null
    registerModal({ id: instanceId, dialogRef, priorFocus })
    acquireBodyScrollLock(instanceId, previousBodyOverflow)

    function handleKeyDown(event: KeyboardEvent) {
      if (!isTopmostModal(instanceId)) return

      const closeOnEscape = closeOnEscapeRef.current
      const onClose = onCloseRef.current
      if (closeOnEscape && event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      if (!dialog) return

      const focusableElements = getFocusableElements(dialog)
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      const activeElement = document.activeElement
      const focusEscapedDialog = !dialog.contains(activeElement)
      const focusIsNotTabbable = !focusableElements.includes(activeElement as HTMLElement)
      const loopsBackward = event.shiftKey
        && (activeElement === firstElement || focusEscapedDialog || focusIsNotTabbable)
      const loopsForward = !event.shiftKey
        && (activeElement === lastElement || focusEscapedDialog || focusIsNotTabbable)

      if (loopsBackward) {
        event.preventDefault()
        lastElement.focus()
      } else if (loopsForward) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    dialogRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const { wasTopmost, removedEntry, nextTopmost } = unregisterModal(instanceId)
      document.body.style.overflow = previousBodyOverflow
      releaseBodyScrollLock(instanceId)
      if (!wasTopmost) return

      const focusToRestore = removedEntry?.priorFocus
      const nextDialog = nextTopmost?.dialogRef.current
      if (!nextDialog && focusToRestore?.isConnected) {
        if (focusToRestore === previousFocusedElement
          && previousFocusedElement instanceof HTMLElement) previousFocusedElement.focus()
        else focusToRestore.focus()
      }
      if (nextDialog) {
        if (focusToRestore?.isConnected && nextDialog.contains(focusToRestore)) {
          focusToRestore.focus()
        } else {
          nextDialog.focus()
        }
      }
    }
  }, [open])

  if (!open) return null

  function handleBackdropClick() {
    const instanceId = instanceIdRef.current
    const closeOnBackdrop = closeOnBackdropRef.current
    const onClose = onCloseRef.current
    if (isTopmostModal(instanceId) && closeOnBackdrop) onClose()
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
