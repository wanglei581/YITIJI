export type KioskAppPlacement = 'toolbox' | 'smart_campus'

export type KioskAppLaunchMode = 'internal_route' | 'external_url' | 'qr_code' | 'mini_program_qr'

export type ToolboxLaunchAction =
  | 'show_qr'
  | 'open_external_notice'
  | 'open_external_confirmed'
  | 'cancel_external'

export interface KioskAppItem {
  key: string
  title: string
  description: string
  icon: string
  to: string | null
  disabled: boolean
  sortOrder: number
  placements?: KioskAppPlacement[]
  launchMode?: KioskAppLaunchMode
  externalUrl?: string | null
  qrImageUrl?: string | null
  qrTargetUrl?: string | null
}

export interface RecordToolboxLaunchEventInput {
  itemKey: string
  action: ToolboxLaunchAction
  placement?: KioskAppPlacement
}

export interface ToolboxLaunchSummaryItem {
  itemKey: string
  itemTitle: string | null
  count: number
}

export interface ToolboxLaunchSummary {
  days: number
  terminalId: string | null
  from: string
  to: string
  totalCount: number
  qrShownCount: number
  externalNoticeCount: number
  externalConfirmedCount: number
  externalCancelledCount: number
  byAction: Record<ToolboxLaunchAction, number>
  topItems: ToolboxLaunchSummaryItem[]
}
