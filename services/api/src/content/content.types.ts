/**
 * 宣传屏契约本地副本。
 *
 * **契约源**:packages/shared/src/types/screensaver.ts
 *
 * 为什么不直接 import @ai-job-print/shared:见 files/file.types.ts 顶部说明
 * (services/api 走 commonjs,shared 为 ESM-only)。任何字段变更必须同步两处。
 */

export type AdAssetType = 'image' | 'video'
export type AdAssetSource = 'uploaded' | 'ai_generated'
export type AdAssetStatus = 'active' | 'disabled'
export type AdPlaylistStatus = 'active' | 'disabled'

export interface AdAssetView {
  id: string
  type: AdAssetType
  title: string
  mimeType: string
  sizeBytes: number
  sha256: string
  width: number | null
  height: number | null
  durationSec: number
  source: AdAssetSource
  status: AdAssetStatus
  createdAt: string
  previewUrl: string
}

export interface AdPlaylistItemView {
  id: string
  assetId: string
  order: number
  enabled: boolean
  asset: AdAssetView
}

export interface AdPlaylistView {
  id: string
  name: string
  status: AdPlaylistStatus
  itemCount: number
  items: AdPlaylistItemView[]
  createdAt: string
  updatedAt: string
}

export interface TerminalScreensaverConfigView {
  terminalId: string
  enabled: boolean
  idleTimeoutSec: number
  playlistId: string | null
  playlistName: string | null
  updatedAt: string | null
}

export interface ScreensaverTerminalView {
  terminalId: string
  terminalCode: string | null
  isOnline: boolean
  config: TerminalScreensaverConfigView | null
}

export interface KioskScreensaverItem {
  id: string
  type: AdAssetType
  url: string
  mimeType: string
  durationSec: number
  sha256: string
}

export interface KioskScreensaverPlaylist {
  enabled: boolean
  idleTimeoutSec: number
  items: KioskScreensaverItem[]
}

export interface AiPosterStatusView {
  enabled: boolean
  provider: string
  dailyLimit: number | null
}
