// 登录页的两个小钩子：从 ./index.tsx 拆出（该页已近 800 行），行为不变。

import { useEffect, useState } from 'react'

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
