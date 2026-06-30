import type { KioskSmartCampusConfig } from '../smart-campus/smart-campus.types'

export interface KioskTerminalConfigView {
  smartCampus: KioskSmartCampusConfig
  configVersion: string
  refreshIntervalMs: number
  serverTime: string
}
