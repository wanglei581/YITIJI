/**
 * 贴牌契约本地副本。
 *
 * **契约源**：packages/shared/src/types/branding.ts
 *
 * services/api 走 commonjs，无法直接 import 共享包（shared 为 ESM-only），
 * 所以常量与类型在此留一份；门禁 verify:branding 逐项比对两份，改一处必须改两处。
 */

/** 没配置时的平台默认——与上线前写死在一体机前端的现状逐字一致。 */
export const DEFAULT_BRAND_NAME = '职易达'
export const DEFAULT_BRAND_MARK = '职'

export const BRAND_NAME_MAX_LENGTH = 12
export const BRAND_MARK_LENGTH = 1
export const BRAND_FILING_TEXT_MAX_LENGTH = 64
export const BRAND_FILING_URL_MAX_LENGTH = 512
/** 备案查询链接：只许 https，主机精确匹配这三个官方备案域名（不带账号、不带端口）。 */
export const BRAND_FILING_URL_HOSTS = ['beian.miit.gov.cn', 'www.beian.gov.cn', 'beian.mps.gov.cn'] as const

export const BRAND_LOGO_MIME_TYPES = ['image/png'] as const
export type BrandLogoMimeType = (typeof BRAND_LOGO_MIME_TYPES)[number]
export const BRAND_LOGO_MAX_BYTES = 512 * 1024
export const BRAND_LOGO_MAX_PIXELS = 1024
export const BRAND_LOGO_RATIO_MIN = 0.9
export const BRAND_LOGO_RATIO_MAX = 1.1

export interface BrandingFiling {
  icp: string
  icpUrl: string
  police: string
  policeUrl: string
}

/** 平台默认备案（现状原值）。 */
export const DEFAULT_BRANDING_FILING: BrandingFiling = {
  icp: '鲁ICP备2026023517号-2',
  icpUrl: 'https://beian.miit.gov.cn/',
  police: '鲁公网安备37021402007308号',
  policeUrl: 'https://beian.mps.gov.cn/#/query/webSearch?code=37021402007308',
}

export interface PublicBrand {
  brandName: string
  brandMark: string
  logoUrl: string | null
}

export type KioskLicenseState = 'ok' | 'grace' | 'inactive'

/** 屏上「暂停服务」的如实说法（契约见 packages/shared 的同名常量）。 */
export const KIOSK_PAUSED_NOTICE_LINE = '这台机器暂时不能用。'

export interface PublicKioskProfile extends PublicBrand {
  filing: BrandingFiling
  location: string | null
  licenseState: KioskLicenseState | null
  acceptsNewSessions: boolean
  currentSessionMayContinue: boolean
  noticeLine: string | null
}

export interface AdminBranding {
  brandName: string | null
  brandMark: string | null
  brandLogoAssetId: string | null
  logoUrl: string | null
  filing: {
    icp: string | null
    icpUrl: string | null
    police: string | null
    policeUrl: string | null
  }
  defaults: {
    brandName: string
    brandMark: string
    filing: BrandingFiling
  }
}

export interface UpdateBrandingInput {
  brandName?: string | null
  brandMark?: string | null
  brandLogoAssetId?: string | null
  filing?: {
    icp?: string | null
    icpUrl?: string | null
    police?: string | null
    policeUrl?: string | null
  }
}

export interface BrandLogoUploadResult {
  assetId: string
  logoUrl: string
  mimeType: BrandLogoMimeType
  width: number
  height: number
  sizeBytes: number
}

export interface OrgBrandOverride {
  brandName: string | null
  brandMark: string | null
  brandLogoAssetId: string | null
  brandLogoUrl: string | null
}

/** PlatformSetting 的键。无 endUserId，不是会员数据。 */
export const BRAND_SETTING_KEYS = {
  name: 'brand.name',
  mark: 'brand.mark',
  logo: 'brand.logoAssetId',
  icp: 'filing.icp',
  icpUrl: 'filing.icpUrl',
  police: 'filing.police',
  policeUrl: 'filing.policeUrl',
} as const

export const BRAND_LOGO_PUBLIC_PATH = '/api/v1/public/brand-logo'

/** assetId 的形状：32 位小写十六进制（randomBytes(16)）。公开读取先验形状，非法一律 404。 */
export const BRAND_LOGO_ID_PATTERN = /^[0-9a-f]{32}$/

export function brandLogoUrl(assetId: string): string {
  return `${BRAND_LOGO_PUBLIC_PATH}/${assetId}`
}
