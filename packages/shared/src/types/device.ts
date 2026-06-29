import type { KioskSmartCampusConfig } from './smartCampus'

export type DeviceStatus = 'online' | 'offline' | 'error' | 'maintenance' | 'idle' | 'busy'

export interface Device {
  id: string
  name: string
  type: 'printer' | 'scanner' | 'kiosk'
  status: DeviceStatus
  location?: string
  lastHeartbeatAt?: string
}

export interface PrinterStatus {
  isOnline: boolean
  hasPaper: boolean
  tonerLevels: {
    black: number
    cyan: number
    magenta: number
    yellow: number
  }
  errorCode?: string
}

/** Kiosk 启动和定时刷新使用的统一终端配置视图。只暴露前台渲染必需白名单字段。 */
export interface KioskTerminalConfig {
  smartCampus: KioskSmartCampusConfig
  configVersion: string
  refreshIntervalMs: number
  serverTime: string
}
