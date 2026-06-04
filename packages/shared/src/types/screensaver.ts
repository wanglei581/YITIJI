// ============================================================
// 待机宣传屏(Screensaver / 广告位)共享类型
//
// 合规边界(CLAUDE.md §2/§8):
//   - 待机宣传屏属于"线下一体机运营"广告位,不属招聘闭环,允许做
//   - 素材文案禁止"一键投递 / 立即投递 / 平台投递"等违规词
//   - 前台统一称"待机宣传屏",不强调"广告平台"属性
//
// 安全:storageKey / FILE_SIGNING_SECRET 等内部字段绝不出现在共享类型;
//      前端只消费签名后的 previewUrl / url。
// ============================================================

export type AdAssetType = 'image' | 'video'
export type AdAssetSource = 'uploaded' | 'ai_generated'
export type AdAssetStatus = 'active' | 'disabled'
export type AdPlaylistStatus = 'active' | 'disabled'

// ── 管理员后台视图 ──────────────────────────────────────────────

/** 素材视图(管理员)。不含 storageKey 等内部字段。 */
export interface AdAssetView {
  id: string
  type: AdAssetType
  title: string
  mimeType: string
  sizeBytes: number
  sha256: string
  width: number | null
  height: number | null
  /** 图片停留秒数 / 视频时长(秒) */
  durationSec: number
  source: AdAssetSource
  status: AdAssetStatus
  createdAt: string
  /** 管理员预览用签名 URL(短 TTL) */
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

/** 终端待机配置视图(管理员)。 */
export interface TerminalScreensaverConfigView {
  terminalId: string
  enabled: boolean
  idleTimeoutSec: number
  playlistId: string | null
  playlistName: string | null
  updatedAt: string | null
}

/** 管理员"终端配置"列表项:终端 + 其屏保配置。 */
export interface ScreensaverTerminalView {
  terminalId: string
  terminalCode: string | null
  isOnline: boolean
  config: TerminalScreensaverConfigView | null
}

// ── 管理员写操作入参 ────────────────────────────────────────────

export interface AdPlaylistItemInput {
  assetId: string
  order: number
  enabled?: boolean
}

export interface SaveAdPlaylistInput {
  name: string
  status?: AdPlaylistStatus
  items: AdPlaylistItemInput[]
}

export interface SaveScreensaverConfigInput {
  enabled: boolean
  idleTimeoutSec: number
  playlistId: string | null
}

// ── Kiosk 拉取 ──────────────────────────────────────────────────

/** Kiosk 屏保单个素材。签名 URL 较长 TTL;缓存 key 用 id / sha256,绝不用 url。 */
export interface KioskScreensaverItem {
  id: string
  type: AdAssetType
  url: string
  mimeType: string
  durationSec: number
  sha256: string
}

/** Kiosk 屏保配置 + 播放列表。enabled=false 时不进入屏保。 */
export interface KioskScreensaverPlaylist {
  enabled: boolean
  idleTimeoutSec: number
  items: KioskScreensaverItem[]
}

// ── AI 文生图(二期能力,一期 stub)─────────────────────────────

/** AI 文生图状态。一期 provider=disabled,接口返回明确未启用。 */
export interface AiPosterStatusView {
  enabled: boolean
  /** 'disabled' | 'wanx' | 'cogview' | ... */
  provider: string
  dailyLimit: number | null
}
