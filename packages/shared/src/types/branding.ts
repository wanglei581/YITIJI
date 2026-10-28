/**
 * 贴牌（品牌配置）契约。
 *
 * **契约源**：本文件。services/api 是 CommonJS，不能 import 共享包，所以在
 * services/api/src/branding/branding.types.ts 留了一份本地副本；门禁 verify:branding
 * 会逐项比对两份（常量、白名单、接口字段），改一处必须改两处。
 *
 * 解析顺序（逐项独立回退）：终端 → 所属机构的品牌覆盖 → 平台默认。
 * 备案号只按部署（平台）配，不随机构走：备案要和实际网站主体对应。
 */

/** 没配置时的平台默认——与上线前写死在一体机前端的现状逐字一致。 */
export const DEFAULT_BRAND_NAME = '职易达'
export const DEFAULT_BRAND_MARK = '职'

/** 品牌名 1–12 个字；字标恰好 1 个字（按 Unicode 码点数）。 */
export const BRAND_NAME_MAX_LENGTH = 12
export const BRAND_MARK_LENGTH = 1
/** 备案号 / 备案查询链接的长度上限。 */
export const BRAND_FILING_TEXT_MAX_LENGTH = 64
export const BRAND_FILING_URL_MAX_LENGTH = 512
/** 备案查询链接：只许 https，主机只许这三个官方备案域名（精确匹配，不带账号、不带端口）。 */
export const BRAND_FILING_URL_HOSTS = ['beian.miit.gov.cn', 'www.beian.gov.cn', 'beian.mps.gov.cn'] as const

/** Logo：只收 PNG / WebP（按文件头判，不信扩展名与 Content-Type），禁 SVG；静态单帧；1:1（±10%）。 */
export const BRAND_LOGO_MIME_TYPES = ['image/png', 'image/webp'] as const
export type BrandLogoMimeType = (typeof BRAND_LOGO_MIME_TYPES)[number]
export const BRAND_LOGO_MAX_BYTES = 512 * 1024
export const BRAND_LOGO_MAX_PIXELS = 1024
/** 宽高比允许范围：0.9 ≤ 宽/高 ≤ 1.1。 */
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

/** GET /api/v1/public/brand —— 不带终端，只给平台默认，供两个后台的登录页与标题用。 */
export interface PublicBrand {
  brandName: string
  brandMark: string
  /** 相对路径 /api/v1/public/brand-logo/:assetId；没有 Logo 时为 null，前端回退字标。 */
  logoUrl: string | null
}

/**
 * 一体机上这台机器所属点位的授权状态（只告诉能不能用，不给到期日等商务细节）：
 * ok = 正常或不管控；grace = 宽限期内仍照常服务；inactive = 暂时不能用（锁机）。
 */
export type KioskLicenseState = 'ok' | 'grace' | 'inactive'

/**
 * GET /api/v1/public/kiosk-profile
 * 请求头带 x-terminal-id + x-terminal-session-token 且验签通过：按「机构覆盖 → 平台默认」解析，
 * location 取该终端的点位名（locationLabel，其次 displayName），并带 licenseState。
 * 没带或验不过：只给平台默认品牌，location 与 licenseState 一律 null（防止枚举终端拿到点位与机构）。
 */
export interface PublicKioskProfile extends PublicBrand {
  filing: BrandingFiling
  location: string | null
  licenseState: KioskLicenseState | null
}

/** 管理员读到的是库存值：null = 没配、用默认；defaults 给界面做占位与「恢复默认」。 */
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

/** PUT /api/v1/admin/branding：省略 = 不改；null 或纯空白 = 清除（回到默认）。 */
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

/** POST /api/v1/admin/branding/logo（multipart，字段名 file）。上传不会自动启用，拿 assetId 再保存。 */
export interface BrandLogoUploadResult {
  assetId: string
  logoUrl: string
  mimeType: BrandLogoMimeType
  width: number
  height: number
  sizeBytes: number
}

/** 机构资料里的品牌覆盖三项（PATCH /api/v1/admin/orgs/:id 接受，GET 回显；只管理员可改）。 */
export interface OrgBrandOverride {
  brandName: string | null
  brandMark: string | null
  brandLogoAssetId: string | null
  brandLogoUrl: string | null
}
