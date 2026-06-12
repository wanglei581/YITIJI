// ============================================================
// 企业展示（CompanyProfile，来源企业与岗位导览）类型。
//
// 合规定位（长期红线）：企业展示不是招聘平台。只展示来源机构提供并经管理员
// 审核发布的企业信息；不收简历、无平台内投递、无候选人/筛选/面试/Offer 能力。
// 与 packages/shared/src/types/company.ts 的对外 DTO 保持一致。
// ============================================================

export const COMPANY_TYPES = [
  'central_soe', 'soe', 'public_institution', 'private',
  'foreign', 'listed', 'specialized_new', 'high_tech',
] as const
export type CompanyType = (typeof COMPANY_TYPES)[number]

export const COMPANY_INDUSTRIES = [
  'smart_manufacturing', 'internet_software', 'electronics', 'new_energy',
  'new_materials', 'biomedicine', 'finance', 'education', 'healthcare',
  'construction_realestate', 'transport_logistics', 'retail_trade',
  'culture_media', 'agriculture_food', 'professional_services', 'public_services',
] as const
export type CompanyIndustry = (typeof COMPANY_INDUSTRIES)[number]

/** 招聘类型筛选：前四项对应 Job.category 真实取值；fair=招聘会参展（企业属性）。 */
export const COMPANY_RECRUIT_TYPES = ['fulltime', 'campus', 'intern', 'parttime', 'fair'] as const
export type CompanyRecruitType = (typeof COMPANY_RECRUIT_TYPES)[number]

/** 来源筛选 → 来源机构 Organization.type 的映射（不另造来源字段）。 */
export const COMPANY_SOURCE_KINDS = [
  'public_employment_service', 'school_employment_center', 'fair_organizer', 'licensed_hr_agency',
] as const
export type CompanySourceKind = (typeof COMPANY_SOURCE_KINDS)[number]

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
