// ============================================================
// 招聘会服务数字化 — Phase 7 正式 DTO
//
// 这些类型是 /api/v1 接口的响应 DTO，供 kiosk / admin / partner 共用。
// 与 apps/kiosk/src/types/fair.ts 中的本地 mock 类型是不同层次：
//   - 本地类型 = 内部 mock"数据库"类型
//   - DTO      = API 响应类型（经过服务层处理和字段安全过滤）
// ============================================================

import type { ExternalJobFair, FairIntentSlice, FairIndustrySlice } from './job'

// ──────────────────────────────────────────────────────────────
// 枚举类型（canonical 定义，避免各端重复声明）
// ──────────────────────────────────────────────────────────────

export type CompanyScale = 'startup' | 'small' | 'medium' | 'large' | 'enterprise'
export type FairBoothStatus = 'available' | 'occupied' | 'reserved'
export type FairMaterialType =
  | 'schedule'
  | 'venue_map'
  | 'company_list'
  | 'position_list'
  | 'brochure'
  | 'other'
export type CompanyCheckinStatus = 'pending' | 'checked_in' | 'absent'

// ──────────────────────────────────────────────────────────────
// ExternalJobFairDTO
// ──────────────────────────────────────────────────────────────

/**
 * 招聘会展示 DTO。
 * 继承 ExternalJobFair（含来源机构、审核状态等合规字段），
 * 新增系统管理的数字化服务数据字段。
 */
export interface ExternalJobFairDTO extends ExternalJobFair {
  /** 是否已录入参会企业/展位等数字化数据 */
  hasManagedData: boolean
  /** 已录入参会企业数量 */
  managedCompanyCount: number
  /** 已发布活动资料数量 */
  /**
   * 本场招聘会已上传的活动资料份数。
   *
   * 必须可空：查询未 select 该关联时为 null，含义是「本次没查」而不是「一份都没有」。
   * 曾经是必填 number 且服务端一律回 0，页面照印「0 份 · 可打印」——资料接口是真的，
   * 但用户看到的是没资料。类型必填是根：它断言「份数总是已知的」，而这句话不成立。
   */
  managedMaterialCount: number | null
  /** 合规来源说明（必须展示） */
  dataSourceNote: string
  /** 参展企业行业分布（按已录企业聚合，数据大屏柱状图） */
  industryDistribution?: FairIndustrySlice[]
}

// ──────────────────────────────────────────────────────────────
// FairCompanyDTO
// ──────────────────────────────────────────────────────────────

export type PositionType = 'full_time' | 'part_time' | 'intern'

export interface FairCompanyPositionDTO {
  id: string
  title: string
  headcount: number
  salary?: string
  requirements?: string
  workType?: string
  /** 学历要求 */
  education?: string
  /** 经验要求 */
  experience?: string
  /** 工作城市 */
  location?: string
  /** 岗位类型 */
  positionType?: PositionType
  /** 所属部门 */
  department?: string
}

/**
 * 参会企业展示 DTO。
 * 合规说明：不含企业联系人、HR 邮箱等任何可用于私下投递的字段。
 */
export interface FairCompanyDTO {
  id: string
  fairId: string
  companyName: string
  industry: string
  /**
   * 员工规模 —— **来源方的原始展示文本**，原样透传，不做分桶。
   *
   * 后端 schema 注释即写明这是展示文本（如 "1200+"），真实取值形如
   * '1200+' / '300+' / '50-500' / '<50' / '>2000' / '5000+'。此前这里是
   * CompanyScale 五值枚举，适配层把认不出的值兜底成 'medium'，结果是
   * **每一家**企业都被标成「中型企业（100-999人）」——含真实规模 >2000 的。
   *
   * 这是对第三方来源信息的篡改：把来源说的 ">2000" 显示成 "100-999人"。
   * 岗位/招聘会数据只做来源信息入口（CLAUDE.md §10），不得改写来源事实。
   * 来源没给就是 null，页面显示「规模未提供」，不猜。
   */
  scale: string | null
  description?: string
  boothNumber?: string
  zoneId?: string
  zoneName?: string
  positions: FairCompanyPositionDTO[]
  sourceUrl?: string
  /**
   * 招聘会现场签到状态 —— **系统当前不追踪签到，接口不返回此字段，实际恒为
   * undefined**。保留字段是因为将来若真接了签到设备，这里是它的落点。
   *
   * 必须是可选的：此前它是必填，适配层被迫硬造 'pending'，页面把这个占位
   * 当事实渲染成「未签到」chip——对每家企业断言了系统不掌握的状态。
   * 类型必填 = 断言"每家企业都有签到状态"，而这句话是假的。
   */
  checkinStatus?: CompanyCheckinStatus
  checkinTime?: string
  /** 合规提示文字（必须在企业详情页展示） */
  applyNote: string
  /** 企业荣誉标签：中国500强 / 世界500强 / 高新技术企业 / 专精特新 等 */
  honorTags?: string[]
  /** 封面图 URL（来源平台提供或上传） */
  coverImageUrl?: string
  /** 成立年份 */
  founded?: string
  /** 总部城市 */
  headquarters?: string
  /** 注册资本 */
  registeredCapital?: string
  /** AI 匹配度（机构录入的展示指标 0–100，仅展示不参与招聘闭环） */
  aiMatchScore?: number
}

// ──────────────────────────────────────────────────────────────
// FairZoneDTO
// ──────────────────────────────────────────────────────────────

export interface FairZoneDTO {
  id: string
  fairId: string
  zoneName: string
  description?: string
  industry?: string
  boothCount: number
  checkedInCount: number
  color?: string
  sortOrder: number
  /** 展区类别：innovation 创新/特色展区 · service 现场服务 · campus_corp_topic 校企主题 */
  category?: string
  /** 城市/区（特色展区按地市分组，如「广州市」） */
  city?: string
  /** 特色展区封面图 URL */
  coverImageUrl?: string
}

// ──────────────────────────────────────────────────────────────
// FairBoothDTO
// ──────────────────────────────────────────────────────────────

export interface FairBoothDTO {
  id: string
  fairId: string
  zoneId: string
  zoneName: string
  boothNumber: string
  status: FairBoothStatus
  companyId?: string
  companyName?: string
  areaSqm?: number
}

// ──────────────────────────────────────────────────────────────
// FairMaterialDTO
// ──────────────────────────────────────────────────────────────

/**
 * 活动资料展示 DTO。
 * 注意：原始 fileUrl 不出现在响应中，只返回签名 previewUrl。
 */
export interface FairMaterialDTO {
  id: string
  fairId: string
  name: string
  type: FairMaterialType
  description?: string
  pageCount: number
  fileSizeKB: number
  printCount: number
  /** 签名临时访问 URL（有效期 2h），不暴露原始存储路径 */
  previewUrl?: string
  allowPrint: boolean
  publishStatus: 'draft' | 'published' | 'unpublished'
  updatedAt?: string
}

/** 招聘会资料按需打印桥接响应；只在用户点击打印时生成短期派生 FileObject。 */
export interface FairMaterialPrintResponse {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  pageCount: number
  printFileUrl: string
}

/** 参会企业按需打印的两种内容：企业资料 / 岗位清单。 */
export type FairCompanyPrintVariant = 'profile' | 'positions'

/**
 * 参会企业资料按需打印响应。
 * 与活动资料不同，企业资料没有预置文件，由服务端按库内展示字段实时渲染 PDF
 * 后落成短期 FileObject；pageCount / sizeBytes 均来自真实渲染结果，不由前端估算。
 */
export interface FairCompanyPrintResponse {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  pageCount: number
  printFileUrl: string
  variant: FairCompanyPrintVariant
}

// ──────────────────────────────────────────────────────────────
// FairLiveStatsDTO
// ──────────────────────────────────────────────────────────────

export interface FairZoneBreakdown {
  id: string
  zoneName: string
  boothCount: number
  checkedInCount: number
}

/**
 * 招聘会统计 DTO。数据来源：主办方录入 / 来源聚合，非实时。
 * 合规说明：只含系统服务行为数据，不含求职者个人信息，不含招聘闭环数据。
 */
export interface FairLiveStatsDTO {
  fairId: string
  /** 招聘会名称（避免页面额外请求） */
  fairName: string

  totalCompanies: number
  /** null 表示无可证明统计源，前端须渲染「暂无数据」而非 0 */
  checkedInCompanies: number | null
  totalPositions: number
  totalHeadcount: number

  /** 系统服务行为统计；null 表示无可证明统计源 */
  browseCount: number | null
  /** null 表示无可证明统计源 */
  scanCount: number | null
  /** null 表示无可证明统计源 */
  printCount: number | null
  /** null 表示无可证明统计源 */
  checkinCount: number | null

  zoneBreakdown: FairZoneBreakdown[]
  lastUpdated: string

  // ── 数据大屏（合规：预计/来源数据，非实时）──
  /** 预计参会人数（机构录入，标注"预计"） */
  expectedAttendance?: number
  /** 求职意向分布（机构录入预计值，饼图） */
  seekerIntent: FairIntentSlice[]
  /** 参展企业行业分布（按已录企业聚合，柱状图） */
  industryDistribution: FairIndustrySlice[]
  /** 数据来源标签（页面统一展示，如「预计/来源数据 · 非实时」） */
  dataSourceLabel: string

  /** Phase 7 API 上线前为 true，前端据此展示 mock 数据提示 */
  isMockData: boolean
}

// ──────────────────────────────────────────────────────────────
// 场馆导览(Venue Guide)
// ──────────────────────────────────────────────────────────────
//
// 帮助现场用户了解会场布局:展厅(A/B/C 厅)行业分布、企业展位、设施点位。
// Admin 配置 → API 持久化 → Kiosk 只读展示。
// 合规:只做位置导览与信息查看,不形成投递/收简历闭环。

export type FairVenueFacilityType = 'entrance' | 'serviceDesk' | 'printPoint' | 'consulting'

export interface FairVenueHallCompanyDTO {
  companyId: string
  companyName: string
  boothNo?: string
  industry?: string
  /** 该企业已录入的岗位数(来自 FairCompanyPosition 真实统计) */
  jobCount: number
  /** 岗位摘要(最多 3 条标题) */
  jobTitles: string[]
}

export interface FairVenueHallDTO {
  hallId: string
  hallCode: string
  hallName: string
  industryCategory?: string
  description?: string
  boothRange?: string
  companyCount: number
  companies: FairVenueHallCompanyDTO[]
}

export interface FairVenueFacilityDTO {
  id: string
  type: FairVenueFacilityType
  name: string
  locationLabel?: string
  relatedHallCode?: string
}

export interface FairVenueGuideDTO {
  fairId: string
  venueName: string
  halls: FairVenueHallDTO[]
  facilities: FairVenueFacilityDTO[]
}

// ── Admin 保存输入(整体 PUT,服务端事务性替换) ────────────────────────────

export interface SaveVenueHallCompanyInput {
  /** 必须属于当前招聘会的 FairCompany.id(服务端校验) */
  fairCompanyId: string
  boothNo?: string
  sortOrder?: number
}

export interface SaveVenueHallInput {
  hallCode: string
  hallName: string
  industryCategory?: string
  description?: string
  boothRange?: string
  sortOrder?: number
  companies: SaveVenueHallCompanyInput[]
}

export interface SaveVenueFacilityInput {
  type: FairVenueFacilityType
  name: string
  locationLabel?: string
  relatedHallCode?: string
  sortOrder?: number
}

export interface SaveFairVenueGuideInput {
  venueName: string
  halls: SaveVenueHallInput[]
  facilities: SaveVenueFacilityInput[]
}
