export type KioskAppPlacementView = 'toolbox' | 'smart_campus'

export type KioskAppLaunchModeView = 'internal_route' | 'external_url' | 'qr_code' | 'mini_program_qr'

export type ToolboxLaunchActionView =
  | 'show_qr'
  | 'open_external_notice'
  | 'open_external_confirmed'
  | 'cancel_external'

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
  riskLevel?: 'low' | 'medium' | 'high' | 'restricted'
  disclaimers?: string[]
  externalUrl?: string | null
  qrImageUrl?: string | null
  qrTargetUrl?: string | null
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

export interface RecordToolboxLaunchEventInput {
  itemKey: string
  action: ToolboxLaunchActionView
  placement?: KioskAppPlacementView
}

export interface ToolboxLaunchSummaryItemView {
  itemKey: string
  itemTitle: string | null
  count: number
}

export interface ToolboxLaunchSummaryView {
  days: number
  terminalId: string | null
  from: string
  to: string
  totalCount: number
  qrShownCount: number
  externalNoticeCount: number
  externalConfirmedCount: number
  externalCancelledCount: number
  byAction: Record<ToolboxLaunchActionView, number>
  topItems: ToolboxLaunchSummaryItemView[]
}
