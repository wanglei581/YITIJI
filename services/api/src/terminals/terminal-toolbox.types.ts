export type KioskAppPlacementView = 'toolbox' | 'smart_campus'

export type KioskAppLaunchModeView = 'internal_route' | 'external_url' | 'qr_code' | 'mini_program_qr'

export interface KioskToolboxItemView {
  key: string
  title: string
  description: string
  icon: string
  to: string | null
  disabled: boolean
  sortOrder: number
  placements?: KioskAppPlacementView[]
  launchMode?: KioskAppLaunchModeView
  externalUrl?: string | null
  qrImageUrl?: string | null
}

export interface KioskToolboxConfigView {
  enabled: boolean
  items: KioskToolboxItemView[]
}

export interface TerminalToolboxConfigView {
  terminalId: string
  enabled: boolean
  items: KioskToolboxItemView[]
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
  items: KioskToolboxItemView[]
}
