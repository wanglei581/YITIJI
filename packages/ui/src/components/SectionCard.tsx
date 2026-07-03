import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface SectionCardProps {
  title: string
  /** 右上角动作区（通常是「查看全部 →」链接）。 */
  action?: ReactNode
  children: ReactNode
  className?: string
  /** 去除卡体左右内边距（表格贴边场景由内容自己控制）。 */
  flush?: boolean
}

/**
 * 后台内容卡片（墨青纸感规范：宋体卡标题 + 右上动作链接）。
 * 标题字体走 --font-heading 间接层，未引入 inkpaper.css 的应用回退继承字体。
 */
export function SectionCard({ title, action, children, className, flush = false }: SectionCardProps) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-lg border border-neutral-900/[0.06] bg-surface shadow-sm',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <h2 className="text-[15.5px] font-extrabold text-neutral-900 [font-family:var(--font-heading,inherit)]">
          {title}
        </h2>
        {action}
      </div>
      <div className={cn(flush ? 'pt-3' : 'px-5 pb-[18px] pt-3.5')}>{children}</div>
    </section>
  )
}
