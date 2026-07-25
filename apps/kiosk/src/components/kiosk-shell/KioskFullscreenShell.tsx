import { getKioskPresentationAttributes, type KioskViewport } from '@ai-job-print/ui'
import type { ReactNode } from 'react'
import { KioskAppTopbar } from './KioskAppTopbar'

export interface KioskFullscreenShellProps {
  children: ReactNode
  /** kiosk = 1080×1920 竖屏；mobile = 390×844 手机辅助页。 */
  viewport?: KioskViewport
  /** 关闭顶栏。仅限原型确实无顶栏的遮罩页（如会话超时）。 */
  hideTopbar?: boolean
  className?: string
}

/**
 * 顶级全屏路由的共享外壳。
 *
 * 这些路由不嵌套在 KioskRoot / KioskLayout 下，因此既拿不到
 * data-kiosk-presentation 主题属性，也没有统一顶栏。本组件补齐两者，
 * 使全屏页与布局内页面共用同一套 kiosk-shell.css 呈现规范。
 *
 * 底部按原型分两类：浏览类页面用 KioskLayout 的 navbar，流程类用页面自身
 * 的 .ui-kiosk-actionbar；全屏页默认不渲染底部导航。
 */
export function KioskFullscreenShell({
  children,
  viewport = 'kiosk',
  hideTopbar = false,
  className,
}: KioskFullscreenShellProps) {
  return (
    <div
      {...getKioskPresentationAttributes('fusion-youth', viewport)}
      className={['ui-kiosk-shell flex h-screen flex-col overflow-hidden', className].filter(Boolean).join(' ')}
    >
      {!hideTopbar && <KioskAppTopbar />}
      {children}
    </div>
  )
}
