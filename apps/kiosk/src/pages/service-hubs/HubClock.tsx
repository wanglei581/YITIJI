import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * 稿 16 顶栏时钟。壳层 QxPageFrame 还没画这一格，这一页自己补进现有顶栏，
 * 不改 components/qingxu。窄屏规则在壳层样式里：不缩放的手机宽度会藏起 .qx-topbar-clock。
 */
export function HubClock() {
  const [host, setHost] = useState<HTMLElement | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const root = document.querySelector('[data-qx-page="service-hub"]')?.closest('.qx-stage')
    const topbar = root?.querySelector(':scope > .qx-topbar')
    if (topbar instanceof HTMLElement) setHost(topbar)
    const timer = window.setInterval(() => setNow(new Date()), 10_000)
    return () => window.clearInterval(timer)
  }, [])

  if (!host) return null
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return createPortal(
    <time className="qx-topbar-clock" dateTime={now.toISOString()} aria-label="当前时间">
      {hh}:{mm}
    </time>,
    host,
  )
}
