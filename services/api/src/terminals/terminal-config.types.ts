import type { KioskSmartCampusConfig } from '../smart-campus/smart-campus.types'

export interface KioskToolboxItemView {
  key: string
  title: string
  description: string
  icon: string
  to: string | null
  disabled: boolean
  sortOrder: number
}

export interface KioskToolboxConfigView {
  enabled: boolean
  items: KioskToolboxItemView[]
}

export interface KioskTerminalConfigView {
  smartCampus: KioskSmartCampusConfig
  toolbox: KioskToolboxConfigView
  configVersion: string
  refreshIntervalMs: number
  serverTime: string
}
