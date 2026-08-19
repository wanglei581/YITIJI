import { KioskTopbar } from '@ai-job-print/ui'
import { useEffect, useState } from 'react'
import { getTerminalCode } from '../../services/api/terminalConfig'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'

/** 顶栏右侧：实时时钟 + 真实设备状态胶囊（原型 topbar .right）。 */
export function KioskTopbarStatus({ tone, label }: { tone: string; label: string }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const clock = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)

  return (
    <>
      <span className="ui-kiosk-topbar__clock">{clock}</span>
      <span className="k-status-chip" data-tone={tone} role="status" aria-live="polite">
        <span className="k-status-chip__dot" aria-hidden="true" />
        {label}
      </span>
    </>
  )
}

/**
 * 应用层顶栏：注入真实终端编号与设备状态，供顶级全屏路由直接使用。
 *
 * KioskLayout 内的路由由布局自动渲染顶栏，不需要再挂本组件，
 * 否则会出现双顶栏。页面禁止自建第三套顶栏实现。
 */
export function KioskAppTopbar() {
  const { loading, printerLabel, printerReady, kind } = useTerminalDeviceStatus(true)
  const terminalCode = getTerminalCode() || '设备未绑定'
  const tone = loading
    ? 'neutral'
    : printerReady
      ? 'positive'
      : kind === 'unknown' || kind === 'low_paper'
        ? 'warning'
        : 'negative'

  return (
    <KioskTopbar
      brandMark="职"
      brandTitle="职易达"
      brandSubtitle={`AI 求职操作系统 · ${terminalCode}`}
      right={<KioskTopbarStatus tone={tone} label={loading ? '设备检查中' : printerLabel} />}
    />
  )
}
