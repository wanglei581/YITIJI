import type { QxTouchStatus } from '../../../components/qingxu/touch/QxTouchBand'
import type { useTerminalDeviceStatus } from '../../../hooks/useTerminalDeviceStatus'

export type MeBandStatus = {
  tone?: 'ok' | 'warn' | 'bad' | 'unknown' | 'reading'
  label?: string
  text?: string
}

/** 旧页的 bad 收到触屏带上是警告色，不假装就绪。 */
export function toTouchStatus(status?: MeBandStatus | null): QxTouchStatus {
  const text = status?.label || status?.text || '状态未知'
  if (status?.tone === 'ok') return { text, tone: 'ok' }
  if (status?.tone === 'warn' || status?.tone === 'bad') return { text, tone: 'warn' }
  if (status?.tone === 'reading') return { text, tone: 'reading' }
  return { text, tone: 'unknown' }
}

/** 只有心跳在线且打印机就绪才写「打印机在线」。 */
export function printerTouchStatus(device: ReturnType<typeof useTerminalDeviceStatus>): QxTouchStatus {
  if (device.loading || device.kind === 'unknown') return { text: '状态未知', tone: 'unknown' }
  if (device.printerReady && device.kind !== 'low_paper') return { text: '打印机在线', tone: 'ok' }
  return { text: device.printerLabel || '状态未知', tone: 'warn' }
}
