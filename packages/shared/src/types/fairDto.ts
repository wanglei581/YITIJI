// ============================================================
// 招聘会服务数字化 — Phase 7 正式 DTO
//
// 这些类型是 /api/v1 接口的响应 DTO，供 kiosk / admin / partner 共用。
// 与 apps/kiosk/src/types/fair.ts 中的本地 mock 类型是不同层次：
//   - 本地类型 = 内部 mock"数据库"类型
//   - DTO      = API 响应类型（经过服务层处理和字段安全过滤）
// ============================================================

import type { ExternalJobFair } from './job'

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
  managedMaterialCount: number
  /** 合规来源说明（必须展示） */
  dataSourceNote: string
}

// ──────────────────────────────────────────────────────────────
// FairCompanyDTO
// ──────────────────────────────────────────────────────────────

export interface FairCompanyPositionDTO {
  id: string
  title: string
  headcount: number
  salary?: string
  requirements?: string
  workType?: string
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
  scale: CompanyScale
  description?: string
  boothNumber?: string
  zoneId?: string
  zoneName?: string
  positions: FairCompanyPositionDTO[]
  sourceUrl?: string
  checkinStatus: CompanyCheckinStatus
  checkinTime?: string
  /** 合规提示文字（必须在企业详情页展示） */
  applyNote: string
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
 * 招聘会现场准实时统计 DTO（服务端缓存 30s）。
 * 合规说明：只含系统服务行为数据，不含求职者个人信息，不含招聘闭环数据。
 */
export interface FairLiveStatsDTO {
  fairId: string
  /** 招聘会名称（避免页面额外请求） */
  fairName: string

  totalCompanies: number
  checkedInCompanies: number
  totalPositions: number
  totalHeadcount: number

  /** 系统服务行为统计，不含求职者个人信息 */
  browseCount: number
  scanCount: number
  printCount: number
  checkinCount: number

  zoneBreakdown: FairZoneBreakdown[]
  lastUpdated: string

  /** Phase 7 API 上线前为 true，前端据此展示 mock 数据提示 */
  isMockData: boolean
}
