// 墨青纸感触控涟漪（v5 语汇）：pointerdown 时在命中元素内落一圈青色涟漪。
// 各页面传入自己的作用域选择器（如 '.khome .sub, .khome .btn'）。
// passive 监听不阻塞触控滚动；disabled 按钮不响应；涟漪节点 560ms 自清理。
// 配套 CSS（.k-ripple + @keyframes kRip）由各页面的 *-inkpaper.css 提供。
import { useEffect } from 'react'

export function useInkRipple(selector: string) {
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      const host = target?.closest?.(selector) as HTMLButtonElement | null
      if (!host || host.disabled) return
      const rect = host.getBoundingClientRect()
      const size = Math.max(rect.width, rect.height) * 1.7
      const rip = document.createElement('span')
      rip.className = 'k-ripple'
      rip.style.width = `${size}px`
      rip.style.height = `${size}px`
      rip.style.left = `${e.clientX - rect.left - size / 2}px`
      rip.style.top = `${e.clientY - rect.top - size / 2}px`
      host.appendChild(rip)
      window.setTimeout(() => rip.remove(), 560)
    }
    document.addEventListener('pointerdown', onDown, { passive: true })
    return () => document.removeEventListener('pointerdown', onDown)
  }, [selector])
}
