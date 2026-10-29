/** 一体机分组。服务端只存这三个英文值。 */
export const OFFICIAL_CHANNEL_AUDIENCES = ['graduate', 'social', 'general'] as const

export type OfficialChannelAudience = (typeof OFFICIAL_CHANNEL_AUDIENCES)[number]

/** 屏上分组标题。全是「通用」时一体机不分组。 */
export const OFFICIAL_CHANNEL_AUDIENCE_LABELS: Readonly<Record<OfficialChannelAudience, string>> = {
  graduate: '面向高校毕业生',
  social: '面向社会求职者',
  general: '通用',
}

/** 一体机公开读取。只含展示字段，不含审核、证据、哈希或内部 id。 */
export interface OfficialChannelPublicItem {
  name: string
  url: string
  displayOrder: number
  organizationName: string
  /**
   * 一体机分组。公开响应会带上；类型先保持可选，一体机解析器目前会丢掉未知字段，
   * 缺这个字段时按「通用」、不分组。
   */
  audience?: OfficialChannelAudience
}

/**
 * items：终端所属机构已启用的官方渠道。未绑定机构时为空。
 * legacyPlatforms：仅托管打开（b）时返回发布就绪的原平台目录；托管关闭时恒为空。
 */
export interface OfficialChannelPublicResponse {
  items: OfficialChannelPublicItem[]
  legacyPlatforms: OfficialChannelPublicItem[]
}

/** 机构端维护自己的渠道。id 与 enabled 只给维护方，不进一体机公开响应。 */
export interface OfficialChannelPartnerItem {
  id: string
  name: string
  url: string
  displayOrder: number
  enabled: boolean
  audience: OfficialChannelAudience
  emergencyTakedown: boolean
  emergencyReasonCode: string | null
  emergencyReasonText: string | null
  organizationName: string
}

export interface OfficialChannelPartnerListResponse {
  items: OfficialChannelPartnerItem[]
  verifiedDomains: string[]
}

/** 管理员只读机构渠道清单；紧急下架仍走独立的管理员接口。 */
export interface OfficialChannelAdminItem {
  id: string
  name: string
  url: string
  displayOrder: number
  enabled: boolean
  audience: OfficialChannelAudience
  emergencyTakedown: boolean
  emergencyReasonCode: string | null
  emergencyReasonText: string | null
}

export interface OfficialChannelAdminListResponse {
  items: OfficialChannelAdminItem[]
}

/** 管理员在机构资料里登记的已核验官方注册域。 */
export interface VerifiedOfficialDomain {
  domain: string
  verifiedAt: string
  verifiedBy: string
}

export interface VerifiedOfficialDomainListResponse {
  items: VerifiedOfficialDomain[]
}
