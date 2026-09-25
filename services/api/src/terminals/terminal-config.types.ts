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

export interface KioskJobBoardConfigView {
  enabled: boolean
  globalEnabled: boolean
  terminalEnabled: boolean | null
  reason: 'open' | 'global_off' | 'terminal_off'
}

/** 一体机用来隐藏招聘类入口。deploymentEnabled 为 false 时整块招聘内容不展示。 */
export interface RecruitmentHostingPublicView {
  enabled: boolean
  deploymentEnabled: boolean
  reason: 'open' | 'deployment_off'
}

export interface KioskTerminalConfigView {
  smartCampus: KioskSmartCampusConfig
  toolbox: KioskToolboxConfigView
  jobBoard: KioskJobBoardConfigView
  recruitmentHosting: RecruitmentHostingPublicView
  configVersion: string
  refreshIntervalMs: number
  serverTime: string
}
