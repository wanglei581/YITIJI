import { Fragment, type ReactNode } from 'react'
import { KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import './print-prototype.css'

export type PrintFlowStep = 1 | 2 | 3 | 4 | 5 | 6 | 7

const PRINT_STEPS = ['上传', '材料检查', '预览', '参数', '确认', '支付', '打印']

interface PrintPrototypeHeaderProps {
  title: string
  subtitle: string
  step: PrintFlowStep
  backLabel?: string
  onBack?: () => void
  /** 替代返回按钮，显示在标题右侧（如"任务进行中"徽章） */
  aside?: ReactNode
}

/**
 * 打印流程页头：统一页头 + 七步指示器。
 *
 * 顶栏（品牌 / 时钟 / 设备状态）由 KioskLayout 全局提供，本组件不得自建，
 * 否则会出现双顶栏。步骤条复用 kiosk-shell.css 的 .ui-kiosk-steps 规范。
 */
export function PrintPrototypeHeader({ title, subtitle, step, backLabel, onBack, aside }: PrintPrototypeHeaderProps) {
  return (
    <>
      <KioskPageHeader title={title} description={subtitle} onBack={onBack} backLabel={backLabel} aside={aside} />
      <nav className="ui-kiosk-steps" aria-label="打印流程">
        {PRINT_STEPS.map((label, index) => {
          const indexStep = (index + 1) as PrintFlowStep
          const state = indexStep < step ? 'done' : indexStep === step ? 'active' : 'todo'
          return (
            <Fragment key={label}>
              {index > 0 && (
                <span
                  className="ui-kiosk-step-line"
                  data-state={indexStep <= step ? 'done' : 'todo'}
                  aria-hidden="true"
                />
              )}
              <span
                className="ui-kiosk-step"
                data-state={state}
                aria-current={state === 'active' ? 'step' : undefined}
              >
                <span className="ui-kiosk-step__dot">{index + 1}</span>
                <span className="ui-kiosk-step__label">{label}</span>
              </span>
            </Fragment>
          )
        })}
      </nav>
    </>
  )
}

export function PrintPageFrame(props: { children: ReactNode; className?: string }) {
  return <KioskPageFrame className={['print-proto', props.className].filter(Boolean).join(' ')}>{props.children}</KioskPageFrame>
}
