import { useEffect, useState } from 'react'
import { useHomeDeviceStatus } from '../home/hooks/useHomeDeviceStatus'
import { getTerminalId } from '../../services/api/terminalConfig'

function formatClock(now: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
}

export function InterviewTopbar() {
  const deviceStatus = useHomeDeviceStatus()
  const [now, setNow] = useState(() => new Date())
  const terminalId = getTerminalId() || '终端'

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <header className="interview-topbar">
      <div className="interview-topbar__brand"><b>就业服务大厅 · {terminalId}</b><span>AI求职打印服务终端</span></div>
      <div className="interview-topbar__right" role="status" aria-live="polite">
        <time>{formatClock(now)}</time>
        <span className="interview-topbar__status" data-tone={deviceStatus.tone}>
          <span />
          {deviceStatus.label} · {deviceStatus.paperLabel}
        </span>
      </div>
    </header>
  )
}
