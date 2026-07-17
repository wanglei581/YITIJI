import { useEffect, useState } from 'react'
import { ArrowLeftIcon } from 'lucide-react'
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
  backLabel: string
  onBack: () => void
}

export function PrintPrototypeHeader({ title, subtitle, step, backLabel, onBack }: PrintPrototypeHeaderProps) {
  return (
    <>
      <PrintKioskTopBar />
      <div className="print-pagehead">
        <button type="button" className="print-back-button" onClick={onBack}>
          <ArrowLeftIcon aria-hidden="true" />
          {backLabel}
        </button>
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
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
