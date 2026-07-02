import type { KioskSmartCampusConfig } from '../smart-campus/smart-campus.types'

export interface KioskToolboxItemView {
  key: string
  title: string
  description: string
  icon: string
  to: string | null
  disabled: boolean
  sortOrder: number
  placements?: Array<'toolbox' | 'smart_campus'>
  launchMode?: 'internal_route' | 'external_url' | 'qr_code' | 'mini_program_qr'
  externalUrl?: string | null
  qrImageUrl?: string | null
  qrTargetUrl?: string | null
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
