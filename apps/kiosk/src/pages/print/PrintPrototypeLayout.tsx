import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import { getTerminalId } from '../../services/api/terminalConfig'
import { useHomeDeviceStatus } from '../home/hooks/useHomeDeviceStatus'
import './print-prototype.css'

export type PrintFlowStep = 1 | 2 | 3 | 4 | 5 | 6 | 7

const PRINT_STEPS = ['上传', '材料检查', '预览', '参数', '确认', '支付', '打印']

function formatClock(now: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
}

export function PrintKioskTopBar() {
  const deviceStatus = useHomeDeviceStatus()
  const [now, setNow] = useState(() => new Date())
  const terminalId = getTerminalId() || '01号机'

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <header className="print-kiosk-topbar">
      <div className="print-kiosk-brand">
        <b>就业服务大厅 · {terminalId}</b>
        <span>AI求职打印服务终端</span>
      </div>
      <div className="print-kiosk-status">
        <time>{formatClock(now)}</time>
        <span className="print-device-chip" data-tone={deviceStatus.tone} role="status" aria-live="polite">
          <i aria-hidden="true" />
          {deviceStatus.label} · {deviceStatus.paperLabel}
        </span>
      </div>
    </header>
  )
}

interface PrintPrototypeHeaderProps {
  title: string
  subtitle: string
  step: PrintFlowStep
  backLabel?: string
  onBack?: () => void
  /** 替代返回按钮，显示在标题右侧（如"任务进行中"徽章） */
  aside?: ReactNode
}

export function PrintPrototypeHeader({ title, subtitle, step, backLabel, onBack, aside }: PrintPrototypeHeaderProps) {
  return (
    <>
      <PrintKioskTopBar />
      <KioskPageHeader title={title} description={subtitle} onBack={onBack} backLabel={backLabel} aside={aside} className="print-pagehead" />
      <nav className="print-flow-steps" aria-label="打印流程">
        {PRINT_STEPS.map((label, index) => {
          const indexStep = (index + 1) as PrintFlowStep
          const state = indexStep < step ? 'done' : indexStep === step ? 'active' : 'pending'
          return (
            <div key={label} className="print-flow-step-wrap">
              <div className="print-flow-step" data-state={state}>
                <span>{index + 1}</span>
                <b>{label}</b>
              </div>
              {index < PRINT_STEPS.length - 1 && <i data-done={indexStep < step} aria-hidden="true" />}
            </div>
          )
        })}
      </nav>
    </>
  )
}

export function PrintPageFrame(props: { children: ReactNode; className?: string }) {
  return <KioskPageFrame className={['print-proto', props.className].filter(Boolean).join(' ')}>{props.children}</KioskPageFrame>
}
