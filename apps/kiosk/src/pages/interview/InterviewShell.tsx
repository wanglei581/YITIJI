import type { ReactNode } from 'react'
import { KioskPageFrame } from '@ai-job-print/ui'
import { KioskFullscreenShell } from '../../components/kiosk-shell/KioskFullscreenShell'

/**
 * 模拟面试域外壳：面试路由是顶级全屏路由（不在 KioskRoot 内），
 * 必须自带顶栏；禁止页面再挂第二套 InterviewTopbar。
 */
export function InterviewShell({
  children,
  className,
  hideTopbar = false,
}: {
  children: ReactNode
  className?: string
  /** 会话进行中等沉浸态可隐藏顶栏 */
  hideTopbar?: boolean
}) {
  return (
    <KioskFullscreenShell hideTopbar={hideTopbar} className={className}>
      <KioskPageFrame className="fusion-w3 fusion-w3--interview h-full min-h-0 flex-1">
        {children}
      </KioskPageFrame>
    </KioskFullscreenShell>
  )
}
