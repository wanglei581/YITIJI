// ============================================================
// 招聘会服务数字化 — Kiosk 本地展示类型
//
// 注意：这是 Kiosk 前台的本地 mock 展示类型，
// 不属于 packages/shared。Phase 7 接入后端 API 时
// 再统一设计正式 DTO，届时替换此文件。
// ============================================================

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

export type PositionType = 'full_time' | 'part_time' | 'intern'

export interface FairCompanyPosition {
  id: string
  title: string
  headcount: number
  salary?: string
  requirements: string
  education?: string
  experience?: string
  location?: string
  positionType?: PositionType
  department?: string
}

export interface FairCompany {
  id: string
  fairId: string
  companyName: string
  industry: string
  /** 来源方原始展示文本（如 "1200+"），不分桶；来源未提供为 null。 */
  scale: string | null
  description: string
  boothNumber?: string
  zoneId?: string
  zoneName?: string
  positions: FairCompanyPosition[]
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
  honorTags?: string[]
  coverImageUrl?: string
  founded?: string
  headquarters?: string
  registeredCapital?: string
  /** AI 匹配度（展示指标 0–100，仅展示不参与招聘闭环） */
  aiMatchScore?: number
}

export interface FairZone {
  id: string
  fairId: string
  zoneName: string
  description: string
  industry?: string
  boothCount: number
  checkedInCount: number
  color?: string
  /** 展区类别：innovation 创新/特色展区 · service 现场服务 · campus_corp_topic 校企主题 */
  category?: 'innovation' | 'service' | 'campus_corp_topic'
  /** 城市/区（特色展区按地市分组，如「广州市」） */
  city?: string
  /** 特色展区封面图 URL */
  coverImageUrl?: string
}

export interface FairBooth {
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

export interface FairMaterial {
  id: string
  fairId: string
  name: string
  type: FairMaterialType
  description: string
  pageCount: number
  fileSizeKB: number
  printCount: number
  fileUrl: string
  allowPrint: boolean
  publishStatus: 'draft' | 'published' | 'unpublished'
}

export interface FairLiveStats {
  fairId: string
  totalCompanies: number
  checkedInCompanies: number
  totalPositions: number
  totalHeadcount: number
  browseCount: number
  scanCount: number
  printCount: number
  checkinCount: number
  lastUpdated: string
}

export const COMPANY_SCALE_LABELS: Record<CompanyScale, string> = {
  startup:    '初创企业',
  small:      '小型企业（<100人）',
  medium:     '中型企业（100-999人）',
  large:      '大型企业（千人以上）',
  enterprise: '超大型（万人以上）',
}

export const COMPANY_SCALE_SHORT: Record<CompanyScale, string> = {
  startup:    '初创',
  small:      '小型',
  medium:     '中型',
  large:      '大型',
  enterprise: '超大型',
}

export const FAIR_MATERIAL_TYPE_LABELS: Record<FairMaterialType, string> = {
  schedule:     '活动日程',
  venue_map:    '展馆地图',
  company_list: '企业名册',
  position_list:'岗位汇总',
  brochure:     '宣传手册',
  other:        '其他资料',
}

export const COMPANY_CHECKIN_LABELS: Record<CompanyCheckinStatus, string> = {
  pending:    '未签到',
  checked_in: '已签到',
  absent:     '缺席',
}

export const BOOTH_STATUS_LABELS: Record<FairBoothStatus, string> = {
  available: '空闲',
  occupied:  '已入驻',
  reserved:  '已预留',
}
