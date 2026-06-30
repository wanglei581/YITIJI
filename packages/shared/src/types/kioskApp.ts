export type KioskAppPlacement = 'toolbox' | 'smart_campus'

export type KioskAppLaunchMode = 'internal_route' | 'external_url' | 'qr_code' | 'mini_program_qr'

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
}
