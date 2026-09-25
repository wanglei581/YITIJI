import type { KioskSmartCampusConfig } from './smartCampus'
import type { KioskAppItem } from './kioskApp'

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

export type KioskToolboxItem = KioskAppItem

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

/**
 * 一体机岗位板块有效开关。随 GET /terminals/:id/config 下发，不单独轮询。
 *
 * 刷新：服务端 refreshIntervalMs 为 300000（5 分钟），与一体机
 * useToolboxConfig / useSmartCampusConfig 的轮询间隔一致。
 * 服务端判定不缓存，管理端保存后下一次公开岗位请求立即按新值拒绝。
 * 展示侧跟随下一次配置拉取；configVersion 含本开关的 updatedAt。没有推送。
 * getCachedKioskTerminalConfig 另有 30 秒内存缓存，岗位接口本身不走那层缓存。
 *
 * enabled 为有效值（全局关优先）。terminalEnabled 为 null 表示本台未单独配置，按默认开。
 * 字段在共享类型里可选，是为了旧的一体机字面量仍能通过类型检查；服务端始终下发。
 */
export type KioskJobBoardReason = 'open' | 'global_off' | 'terminal_off'

export interface KioskJobBoardConfig {
  enabled: boolean
  globalEnabled: boolean
  terminalEnabled: boolean | null
  reason: KioskJobBoardReason
}

/** Kiosk 启动和定时刷新使用的统一终端配置视图。只暴露前台渲染必需白名单字段。 */
export interface KioskTerminalConfig {
  smartCampus: KioskSmartCampusConfig
  toolbox: KioskToolboxConfig
  jobBoard?: KioskJobBoardConfig
  configVersion: string
  refreshIntervalMs: number
  serverTime: string
}
