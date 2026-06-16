// ============================================================
// 企业展示 / 来源岗位导览类型（CompanyProfile）。
//
// 合规定位（长期红线）：这是「企业展示 / 企业风采 / 来源岗位导览」，
// 不是招聘平台。不收简历、无平台内投递、无候选人 / 筛选 / 面试 / Offer 能力；
// 投递一律引导「去来源平台投递 / 扫码投递」。
// ============================================================

/**
 * 企业类型（展示标签；与筛选项一一对应）。
 * 统一字典：与后端 services/api/src/companies/companies.types.ts 的 COMPANY_TYPES
 * 严格同步（后端 DTO 以 @IsIn 校验、service 以 assertEnum 过滤）。新增值必须两边同改。
 */
export const COMPANY_TYPES = {
  central_soe: '央企',
  soe: '国企',
  public_institution: '事业单位',
  private: '民营企业',
  foreign: '外资企业',
  joint_venture: '合资企业',
  listed: '上市公司',
  specialized_new: '专精特新',
  high_tech: '高新技术企业',
  school_enterprise: '校企合作单位',
  public_org: '公共机构',
  other: '其他',
} as const
export type CompanyType = keyof typeof COMPANY_TYPES

/**
 * 行业（展示标签；与筛选项一一对应）。
 * 统一字典：与后端 companies.types.ts 的 COMPANY_INDUSTRIES 严格同步。
 */
export const COMPANY_INDUSTRIES = {
  smart_manufacturing: '智能制造',
  internet_software: '互联网/软件',
  ai_big_data: 'AI/大数据',
  electronics: '电子信息',
  new_energy: '新能源',
  new_materials: '新材料',
  biomedicine: '生物医药',
  finance: '金融',
  education: '教育培训',
  healthcare: '医疗健康',
  construction_realestate: '建筑地产',
  transport_logistics: '交通物流',
  retail_trade: '商贸零售',
  culture_media: '文旅传媒',
  agriculture_food: '农业食品',
  professional_services: '专业服务',
  public_services: '公共服务',
  other: '其他',
} as const
export type CompanyIndustry = keyof typeof COMPANY_INDUSTRIES

/**
 * 招聘类型筛选：fulltime=社招、campus=校招、intern=实习、parttime=兼职
 * （对应 Job.category 的真实取值），fair=招聘会参展（企业属性）。
 */
export type CompanyRecruitTypeFilter = 'fulltime' | 'campus' | 'intern' | 'parttime' | 'fair'

/** 来源筛选：映射来源机构 Organization.type，不另造来源字段。 */
export const COMPANY_SOURCE_KINDS = {
  public_employment_service: '人社平台',
  school_employment_center: '大学就业网',
  fair_organizer: '招聘会主办方',
  licensed_hr_agency: '第三方合规平台',
} as const
export type CompanySourceKind = keyof typeof COMPANY_SOURCE_KINDS

/** 找企业列表卡片（只含展示字段；无任何候选人/简历/匹配百分比字段）。 */
export interface CompanyCardDTO {
  id: string
  name: string
  logoUrl: string | null
  companyType: CompanyType | null
  industry: CompanyIndustry | null
  sourceName: string
  province: string | null
  city: string | null
  district: string | null
  description: string | null
  /** 代表岗位（已发布岗位标题，最多 3 个；无则空数组） */
  repJobTitles: string[]
  /** 来源岗位数量（真实统计：已审核发布且关联本企业的岗位数） */
  openJobCount: number
  fairParticipant: boolean
  tags: string[]
}

/** 企业详情页右侧指标（仅包含「开关开启且有真实数据」的项；缺项即不展示）。 */
export interface CompanyMetricsDTO {
  openJobCount?: number
  city?: string
  employeeScale?: string
  boothNo?: string
}

export interface CompanyDetailDTO {
  id: string
  name: string
  legalName: string | null
  logoUrl: string | null
  coverImageUrl: string | null
  promoVideoUrl: string | null
  description: string | null
  companyType: CompanyType | null
  industry: CompanyIndustry | null
  honorTags: string[]
  tags: string[]
  province: string | null
  city: string | null
  district: string | null
  address: string | null
  fairParticipant: boolean
  metrics: CompanyMetricsDTO
  // 来源（合规必展示）
  sourceName: string
  sourceUrl: string | null
  externalId: string
  syncTime: string
  dataSourceNote: string
}

/** 找企业页统计条（全部为真实聚合，不允许前端写死）。 */
export interface CompanyStatsDTO {
  companyCount: number
  openJobCount: number
  todayNewJobCount: number
  fairCompanyCount: number
}

/** 筛选可选项（只来自真实已发布数据，绝不渲染没有数据支撑的地区）。 */
export interface CompanyFiltersDTO {
  regions: { province: string; cities: { city: string; districts: string[] }[] }[]
  industries: CompanyIndustry[]
  companyTypes: CompanyType[]
  sourceKinds: CompanySourceKind[]
}

/** 企业详情页的在招岗位行（指向既有岗位详情/来源投递链路）。 */
export interface CompanyJobItemDTO {
  id: string
  title: string
  city: string
  salaryDisplay: string
  category: string | null
  tags: string[]
  sourceName: string
  sourceUrl: string
  externalId: string
}
