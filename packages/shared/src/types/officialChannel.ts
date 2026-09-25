/** 一体机公开读取。只含展示字段，不含审核、证据、哈希或内部 id。 */
export interface OfficialChannelPublicItem {
  name: string
  url: string
  displayOrder: number
  organizationName: string
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
  organizationName: string
}

export interface OfficialChannelPartnerListResponse {
  items: OfficialChannelPartnerItem[]
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
