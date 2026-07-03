import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * 右侧抽屉。
 *
 * 三端通用,用于:
 *   - Admin 审计日志详情
 *   - Admin 文件管理详情
 *   - Admin 终端管理详情
 *   - Partner 同步日志详情
 *
 * 不依赖任何 React Portal 库 — 直接 fixed 定位,
 * 接 Esc 关闭 + 锁滚动条 + 点遮罩关闭。
 */
export interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  /** 默认 480px,可传 'sm' | 'md' | 'lg'。 */
  size?: 'sm' | 'md' | 'lg'
  /** 是否点击遮罩关闭。默认 true。 */
  closeOnBackdrop?: boolean
  /** 抽屉主体。 */
  children: ReactNode
  /** 抽屉底部固定操作区(可选)。 */
  footer?: ReactNode
  className?: string
}

const SIZE_PX: Record<NonNullable<DrawerProps['size']>, string> = {
  sm: 'w-[360px]',
  md: 'w-[480px]',
  lg: 'w-[640px]',
}

export function Drawer({
  open,
  onClose,
  title,
  size = 'md',
  closeOnBackdrop = true,
  children,
  footer,
  className,
}: DrawerProps): ReactNode {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? '抽屉'}
    >
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-neutral-900/40 transition-opacity"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden
      />
      {/* 主体 */}
      <div
        className={cn(
          'relative flex h-full flex-col bg-surface shadow-xl',
          SIZE_PX[size],
          className,
        )}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-neutral-200 px-6 py-4">
            <h2 className="text-base font-semibold text-neutral-900 [font-family:var(--font-heading,inherit)]">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100"
              aria-label="关闭"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <div className="border-t border-neutral-200 px-6 py-3">{footer}</div>
        )}
      </div>
    </div>
  )
}
