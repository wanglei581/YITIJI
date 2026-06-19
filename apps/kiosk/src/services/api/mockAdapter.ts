// ============================================================
// Mock Adapter — Phase 7.1
//
// 将本地 fairData.ts / externalSources.ts 的 mock 数据
// 转换为标准 DTO 并包装成 ApiResponse / PaginatedResponse，
// 模拟真实 API 的数据结构。
//
// Phase 7.2 时用 httpAdapter.ts 替换此文件的引用，页面层零改动。
// ============================================================

import type {
  ApiResponse,
  PaginatedResponse,
  ExternalJobFairDTO,
  FairCompanyDTO,
  FairCompanyPositionDTO,
  FairZoneDTO,
  FairBoothDTO,
  FairMaterialDTO,
  FairLiveStatsDTO,
  FairVenueGuideDTO,
  FairZoneBreakdown,
  FairIndustrySlice,
} from '@ai-job-print/shared'
import type {
  FairCompany,
  FairZone,
  FairBooth,
  FairMaterial,
  FairLiveStats,
} from '../../types/fair'
import type { ExternalJobFair } from '@ai-job-print/shared'
import { MOCK_FAIRS } from '../../data/externalSources'
import {
  FAIR_ZONES_MAP,
  FAIR_COMPANIES_MAP,
  FAIR_BOOTHS_MAP,
  FAIR_MATERIALS_MAP,
  FAIR_STATS_MAP,
} from '../../data/fairData'

// ──────────────────────────────────────────────────────────────
// 内部转换函数
// ──────────────────────────────────────────────────────────────

/** 按已录参展企业的 industry 聚合行业分布（数据大屏柱状图）。 */
function computeIndustryDistribution(companies: FairCompany[]): FairIndustrySlice[] {
  const counts = new Map<string, number>()
  for (const c of companies) {
    const key = c.industry?.trim() || '其他'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

function toJobFairDTO(fair: ExternalJobFair): ExternalJobFairDTO {
  const companies     = FAIR_COMPANIES_MAP[fair.id] ?? []
  const materials     = FAIR_MATERIALS_MAP[fair.id] ?? []
  const companyCount  = companies.length
  const materialCount = materials.filter((m) => m.publishStatus === 'published').length
  return {
    ...fair,
    hasManagedData:        companyCount > 0,
    managedCompanyCount:   companyCount,
    managedMaterialCount:  materialCount,
    industryDistribution:  companyCount > 0 ? computeIndustryDistribution(companies) : undefined,
    dataSourceNote: `数据来源：${fair.sourceName} · 同步于 ${fair.syncTime.slice(0, 10)} · 仅供参考`,
  }
}

function toCompanyDTO(company: FairCompany): FairCompanyDTO {
  const positions: FairCompanyPositionDTO[] = company.positions.map((p) => ({
    id:           p.id,
    title:        p.title,
    headcount:    p.headcount,
    salary:       p.salary,
    requirements: p.requirements,
    education:    p.education,
    experience:   p.experience,
    location:     p.location,
    positionType: p.positionType,
    department:   p.department,
  }))
  return {
    id:                company.id,
    fairId:            company.fairId,
    companyName:       company.companyName,
    industry:          company.industry,
    scale:             company.scale,
    description:       company.description,
    boothNumber:       company.boothNumber,
    zoneId:            company.zoneId,
    zoneName:          company.zoneName,
    positions,
    sourceUrl:         company.sourceUrl,
    checkinStatus:     company.checkinStatus,
    checkinTime:       company.checkinTime,
    honorTags:         company.honorTags,
    coverImageUrl:     company.coverImageUrl,
    founded:           company.founded,
    headquarters:      company.headquarters,
    registeredCapital: company.registeredCapital,
    aiMatchScore:      company.aiMatchScore,
    applyNote:         '如需了解更多，请扫码前往来源平台',
  }
}

function toZoneDTO(zone: FairZone, index: number): FairZoneDTO {
  return {
    id:             zone.id,
    fairId:         zone.fairId,
    zoneName:       zone.zoneName,
    description:    zone.description,
    industry:       zone.industry,
    boothCount:     zone.boothCount,
    checkedInCount: zone.checkedInCount,
    color:          zone.color,
    sortOrder:      index,
    category:       zone.category,
    city:           zone.city,
    coverImageUrl:  zone.coverImageUrl,
  }
}

function toBoothDTO(booth: FairBooth): FairBoothDTO {
  return {
    id:          booth.id,
    fairId:      booth.fairId,
    zoneId:      booth.zoneId,
    zoneName:    booth.zoneName,
    boothNumber: booth.boothNumber,
    status:      booth.status,
    companyId:   booth.companyId,
    companyName: booth.companyName,
    areaSqm:     booth.areaSqm,
  }
}

function toMaterialDTO(material: FairMaterial): FairMaterialDTO {
  return {
    id:            material.id,
    fairId:        material.fairId,
    name:          material.name,
    type:          material.type,
    description:   material.description,
    pageCount:     material.pageCount,
    fileSizeKB:    material.fileSizeKB,
    printCount:    material.printCount,
    previewUrl:    material.fileUrl,   // mock: 直接用 fileUrl 作为 previewUrl
    allowPrint:    material.allowPrint,
    publishStatus: material.publishStatus,
  }
}

function toStatsDTO(
  stats: FairLiveStats,
  fair: ExternalJobFair | undefined,
  companies: FairCompany[],
  zones: FairZone[],
): FairLiveStatsDTO {
  const zoneBreakdown: FairZoneBreakdown[] = zones.map((z) => ({
    id:             z.id,
    zoneName:       z.zoneName,
    boothCount:     z.boothCount,
    checkedInCount: z.checkedInCount,
  }))
  return {
    fairId:             stats.fairId,
    fairName:           fair?.name ?? stats.fairId,
    totalCompanies:     stats.totalCompanies,
    checkedInCompanies: stats.checkedInCompanies,
    totalPositions:     stats.totalPositions,
    totalHeadcount:     stats.totalHeadcount,
    browseCount:        stats.browseCount,
    scanCount:          stats.scanCount,
    printCount:         stats.printCount,
    checkinCount:       stats.checkinCount,
    zoneBreakdown,
    lastUpdated:        stats.lastUpdated,
    // 数据大屏（预计/来源数据，非实时）
    expectedAttendance: fair?.expectedAttendance,
    seekerIntent:       fair?.seekerIntent ?? [],
    industryDistribution: computeIndustryDistribution(companies),
    dataSourceLabel:    '预计 / 来源数据 · 非实时',
    isMockData:         true,
  }
}

function makePaginated<T>(data: T[], page = 1, pageSize = 100): PaginatedResponse<T> {
  const total      = data.length
  const totalPages = Math.ceil(total / pageSize)
  const sliced     = data.slice((page - 1) * pageSize, page * pageSize)
  return { data: sliced, pagination: { page, pageSize, total, totalPages } }
}

function ok<T>(data: T): ApiResponse<T> {
  return { data, success: true }
}

const FAIR_STATUS_RANK: Record<ExternalJobFair['status'], number> = {
  ongoing: 0,
  upcoming: 1,
  ended: 2,
}

function orderTerminalScopedMockFairs(fairs: ExternalJobFair[], terminalId?: string): ExternalJobFair[] {
  if (!terminalId) return fairs
  return [...fairs].sort((a, b) => FAIR_STATUS_RANK[a.status] - FAIR_STATUS_RANK[b.status])
}

// ──────────────────────────────────────────────────────────────
// Adapter 对象
// ──────────────────────────────────────────────────────────────

export const mockJobFairAdapter = {
  async getJobFairs(params?: { status?: string; terminalId?: string }): Promise<PaginatedResponse<ExternalJobFairDTO>> {
    const fairs = orderTerminalScopedMockFairs(
      MOCK_FAIRS
        .filter((f) => f.reviewStatus === 'approved' && f.publishStatus === 'published')
        .filter((f) => !params?.status || f.status === params.status),
      params?.terminalId,
    )
      .map(toJobFairDTO)
    return makePaginated(fairs)
  },

  async getJobFairById(id: string): Promise<ApiResponse<ExternalJobFairDTO | null>> {
    const fair = MOCK_FAIRS.find((f) => f.id === id) ?? null
    return ok(fair ? toJobFairDTO(fair) : null)
  },

  async getFairCompanies(fairId: string): Promise<PaginatedResponse<FairCompanyDTO>> {
    const companies = (FAIR_COMPANIES_MAP[fairId] ?? []).map(toCompanyDTO)
    return makePaginated(companies)
  },

  async getFairCompanyById(fairId: string, companyId: string): Promise<ApiResponse<FairCompanyDTO | null>> {
    const company = (FAIR_COMPANIES_MAP[fairId] ?? []).find((c) => c.id === companyId) ?? null
    return ok(company ? toCompanyDTO(company) : null)
  },

  async getFairZones(fairId: string): Promise<ApiResponse<FairZoneDTO[]>> {
    const zones = (FAIR_ZONES_MAP[fairId] ?? []).map(toZoneDTO)
    return ok(zones)
  },

  async getFairMap(fairId: string): Promise<ApiResponse<{ zones: FairZoneDTO[]; booths: FairBoothDTO[] }>> {
    // 创新特色展区（category=innovation）不是展位区，不进展馆地图
    const zones  = (FAIR_ZONES_MAP[fairId] ?? []).filter((z) => z.category !== 'innovation').map(toZoneDTO)
    const booths = (FAIR_BOOTHS_MAP[fairId] ?? []).map(toBoothDTO)
    return ok({ zones, booths })
  },

  async getFairMaterials(fairId: string): Promise<PaginatedResponse<FairMaterialDTO>> {
    const materials = (FAIR_MATERIALS_MAP[fairId] ?? [])
      .filter((m) => m.publishStatus === 'published')
      .map(toMaterialDTO)
    return makePaginated(materials)
  },

  // 场馆导览:导览数据由 Admin 配置/后端 seed 提供,mock 模式诚实返回空态,不前端硬编码
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getFairVenueGuide(_fairId: string): Promise<ApiResponse<FairVenueGuideDTO | null>> {
    return ok(null)
  },

  async getFairStats(fairId: string): Promise<ApiResponse<FairLiveStatsDTO | null>> {
    const stats = FAIR_STATS_MAP[fairId] ?? null
    if (!stats) return ok(null)
    const fair      = MOCK_FAIRS.find((f) => f.id === fairId)
    const companies = FAIR_COMPANIES_MAP[fairId] ?? []
    const zones     = FAIR_ZONES_MAP[fairId] ?? []
    return ok(toStatsDTO(stats, fair, companies, zones))
  },
}
