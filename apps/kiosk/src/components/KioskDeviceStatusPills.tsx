/**
 * 首页顶栏设备状态药丸（P0-2）。
 * 独立组件，避免继续堆进已超阈值的 HomePage。
 */
import { KIcon } from './kiosk-icon'
import { useTerminalDeviceStatus } from '../hooks/useTerminalDeviceStatus'

function pillTone(kind: string, ready: boolean): 'ok' | 'warn' | 'bad' {
  if (ready) return 'ok'
  if (kind === 'unknown' || kind === 'low_paper') return 'warn'
  return 'bad'
}

export function KioskDeviceStatusPills() {
  const { loading, printerLabel, networkLabel, printerReady, kind } = useTerminalDeviceStatus()
  const printerTone = loading ? 'warn' : pillTone(kind, printerReady)
  const networkTone = loading
    ? 'warn'
    : networkLabel === '网络正常'
      ? 'ok'
      : networkLabel === '检测中'
        ? 'warn'
        : 'bad'

  return (
    <div className="k-status">
      <span className={`k-pill k-pill--${printerTone}`}>
        <i className="k-dot" aria-hidden="true" />
        {loading ? '设备检查中' : printerLabel}
      </span>
      <span className={`k-pill k-pill--${networkTone}`}>
        <KIcon name="wifi" />
        {loading ? '检测中' : networkLabel}
      </span>
    </div>
  )
}
