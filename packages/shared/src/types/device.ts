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

export interface KioskToolboxItem {
  key: string
  title: string
  description: string
  icon: string
  to: string | null
  disabled: boolean
  sortOrder: number
}

export interface KioskToolboxConfig {
  enabled: boolean
  items: KioskToolboxItem[]
}

export interface TerminalToolboxConfigView {
  terminalId: string
  enabled: boolean
  items: KioskToolboxItem[]
  updatedAt: string | null
}

export interface ToolboxTerminalView {
  terminalId: string
  terminalCode: string | null
  orgId?: string | null
  orgName?: string | null
  isOnline: boolean
  config: TerminalToolboxConfigView | null
}

export interface SaveToolboxConfigInput {
  enabled: boolean
  items: KioskToolboxItem[]
}

/** Kiosk 启动和定时刷新使用的统一终端配置视图。只暴露前台渲染必需白名单字段。 */
export interface KioskTerminalConfig {
  smartCampus: KioskSmartCampusConfig
  toolbox: KioskToolboxConfig
  configVersion: string
  refreshIntervalMs: number
  serverTime: string
}
