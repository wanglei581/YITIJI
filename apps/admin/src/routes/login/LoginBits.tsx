import { useEffect, useState } from 'react'
import { CheckIcon, CircleAlertIcon } from 'lucide-react'
import type { LegalDocKind } from './LegalDocsModal'

// 登录页的小零件：从 ./index.tsx 拆出（该页已近 800 行），行为不变。

export function ErrorBar({ message }: { message: string }) {
  return (
    <div className="c-error" role="alert">
      <CircleAlertIcon size={16} aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}

export function LoadingDots() {
  return (
    <span className="load">
      <i />
      <i />
      <i />
    </span>
  )
}

export function useCountdown() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (seconds <= 0) return undefined
    const timer = window.setTimeout(() => setSeconds((v) => Math.max(0, v - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [seconds])
  return { seconds, start: setSeconds }
}

/** 触控涟漪：命中 .ripple-host 的元素按压时扩散水纹（纯视觉，事件委托） */
export function useRipple(rootRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      const host = target?.closest?.('.ripple-host') as HTMLElement | null
      if (!host || (host as HTMLButtonElement).disabled) return
      const rect = host.getBoundingClientRect()
      const rip = document.createElement('span')
      rip.className = 'ripple'
      const size = Math.max(rect.width, rect.height) * 1.6
      rip.style.width = `${size}px`
      rip.style.height = `${size}px`
      rip.style.left = `${e.clientX - rect.left - size / 2}px`
      rip.style.top = `${e.clientY - rect.top - size / 2}px`
      host.appendChild(rip)
      window.setTimeout(() => rip.remove(), 540)
    }
    root.addEventListener('pointerdown', onDown)
    return () => root.removeEventListener('pointerdown', onDown)
  }, [rootRef])
}

export function AgreementRow({
  agreed,
  onToggle,
  onOpenDoc,
}: {
  agreed: boolean
  onToggle: () => void
  onOpenDoc: (doc: LegalDocKind) => void
}) {
  return (
    <button type="button" className={`c-agree${agreed ? ' checked' : ''}`} onClick={onToggle} role="checkbox" aria-checked={agreed}>
      <span className="box">
        <CheckIcon size={13} aria-hidden="true" />
      </span>
      <span>
        我已阅读并同意
        <span
          className="doclink"
          role="link"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onOpenDoc('terms')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onOpenDoc('terms')
          }}
        >
          《用户服务协议》
        </span>
        和
        <span
          className="doclink"
          role="link"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onOpenDoc('privacy')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onOpenDoc('privacy')
          }}
        >
          《隐私政策》
        </span>
      </span>
    </button>
  )
}
