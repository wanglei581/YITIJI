import { ChevronLeftIcon } from 'lucide-react'
import { Fragment, type ReactNode } from 'react'
import { cn } from '../lib/cn'

/** 流程页步骤指示器的单步定义（原型 .steps）。 */
export interface KioskPageStep {
  /** 步骤名，如「上传」「预览」。 */
  label: string
  /** done=已完成，active=当前，todo=未开始。 */
  state: 'done' | 'active' | 'todo'
}

export interface KioskPageFrameProps {
  children: ReactNode
  /** 页面主标题（原型 pagehead h1，宋体 44px）。二级页必填。 */
  title?: ReactNode
  /** 页面副标题（原型 pagehead p，22px muted）。 */
  subtitle?: ReactNode
  /** 返回键点击回调；不传则不渲染返回键（如一级页）。 */
  onBack?: () => void
  /** 返回键文案，默认「返回」。 */
  backLabel?: string
  /** 页头右侧操作区（原型 pagehead .aside）。 */
  headerAside?: ReactNode
  /** 流程页步骤条；不传则不渲染。 */
  steps?: readonly KioskPageStep[]
  /** 底部行动条（原型 .actionbar）；流程页用它替代底部导航。 */
  actionbar?: ReactNode
  /**
   * 自定义页头。仅在标准 pagehead 无法表达时使用（如沉浸式 Hero）。
   * 传入后 title / subtitle / onBack / headerAside 均被忽略。
   */
  header?: ReactNode
  footer?: ReactNode
  className?: string
  /** 内容区附加类名，用于页面级栅格。 */
  contentClassName?: string
}

/**
 * Kiosk 统一页壳（唯一基准：docs/design/kiosk-proto-2026-07/shared.css）。
 *
 * 结构与原型一一对应：pagehead → steps → content → actionbar。
 * 顶栏与底部导航由 KioskLayout 提供，页面不得自建。
 */
export function KioskPageFrame({
  children,
  title,
  subtitle,
  onBack,
  backLabel = '返回',
  headerAside,
  steps,
  actionbar,
  header,
  footer,
  className,
  contentClassName,
}: KioskPageFrameProps) {
  const hasStandardHead = Boolean(title || subtitle || onBack || headerAside)

  return (
    <section
      data-kiosk-component="page-frame"
      className={cn('ui-kiosk-page-frame flex min-h-0 flex-1 flex-col', className)}
    >
      {header}

      {!header && hasStandardHead && (
        <div className="ui-kiosk-pagehead">
          {onBack && (
            <button type="button" className="ui-kiosk-back-btn" onClick={onBack}>
              <ChevronLeftIcon aria-hidden="true" />
              <span>{backLabel}</span>
            </button>
          )}
          {(title || subtitle) && (
            <div className="ui-kiosk-pagehead__titles">
              {title && <h1>{title}</h1>}
              {subtitle && <p>{subtitle}</p>}
            </div>
          )}
          {headerAside && <div className="ui-kiosk-pagehead__aside">{headerAside}</div>}
        </div>
      )}

      {steps && steps.length > 0 && (
        <nav className="ui-kiosk-steps" aria-label="流程步骤">
          {steps.map((step, index) => (
            <Fragment key={step.label}>
              {index > 0 && (
                <span
                  className="ui-kiosk-step-line"
                  data-state={steps[index - 1].state === 'done' ? 'done' : 'todo'}
                  aria-hidden="true"
                />
              )}
              <span
                className="ui-kiosk-step"
                data-state={step.state}
                aria-current={step.state === 'active' ? 'step' : undefined}
              >
                <span className="ui-kiosk-step__dot">{index + 1}</span>
                <span className="ui-kiosk-step__label">{step.label}</span>
              </span>
            </Fragment>
          ))}
        </nav>
      )}

      <div className={cn('ui-kiosk-page-content', contentClassName)}>{children}</div>

      {actionbar && <div className="ui-kiosk-actionbar">{actionbar}</div>}
      {footer}
    </section>
  )
}
