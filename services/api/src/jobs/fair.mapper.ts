import type { Fair, FairCompany, FairCompanyPosition, FairIntentSlice, FairZone } from './fair.types'

/**
 * Prisma JobFair / FairCompany / FairZone 行 → API DTO 转换。
 *
 * 单独抽出,避免 jobs.service.ts 过长,且方便单测。
 * 命名约定:`mapFair*` / `mapFairCompany*` / `mapFairZone*`,与 prismaJobTo*** 区分。
 */

interface PrismaJobFairRow {
  id: string
  sourceOrgId: string
  externalId: string
  sourceName: string
  sourceUrl: string
  checkinUrl: string | null
  title: string
  theme: string
  startAt: Date
  endAt: Date
  venue: string
  city: string
  address: string | null
  mapImageUrl: string | null
  description: string | null
  coverImageUrl: string | null
  companyCount: number
  jobCount: number
  viewCount: number
  reviewStatus: string
  publishStatus: string
  reviewedBy: string | null
  reviewedAt: Date | null
  rejectReason: string | null
  syncTime: Date
  createdAt: Date
  updatedAt: Date
  // P1-A① 地图/大屏列
  latitude: number | null
  longitude: number | null
  trafficInfo: string | null
  expectedAttendance: number | null
  seekerIntentJson: string | null
}

interface PrismaFairCompanyPositionRow {
  id: string
  title: string
  headcount: number
  salary: string | null
  requirements: string | null
  education: string | null
  experience: string | null
  location: string | null
  positionType: string | null
  department: string | null
  sourceUrl: string | null
}

interface PrismaFairCompanyRow {
  id: string
  jobFairId: string
  name: string
  logoUrl: string | null
  industry: string | null
  scale: string | null
  description: string | null
  sourceUrl: string | null
  hiringTags: string
  jobsCount: number
  coverImageUrl: string | null
  founded: string | null
  headquarters: string | null
  registeredCapital: string | null
  honorTags: string
  zoneId: string | null
  boothNumber: string | null
  positions?: PrismaFairCompanyPositionRow[]
  createdAt: Date
  updatedAt: Date
}

function splitTags(s: string): string[] {
  return s ? s.split(',').map((t) => t.trim()).filter(Boolean) : []
}

function mapFairCompanyPosition(p: PrismaFairCompanyPositionRow): FairCompanyPosition {
  return {
    id: p.id,
    title: p.title,
    headcount: p.headcount,
    salary: p.salary,
    requirements: p.requirements,
    education: p.education,
    experience: p.experience,
    location: p.location,
    positionType: p.positionType,
    department: p.department,
    sourceUrl: p.sourceUrl,
  }
}

interface PrismaFairZoneRow {
  id: string
  jobFairId: string
  name: string
  category: string | null
  city: string | null
  description: string | null
  coverImageUrl: string | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

/** 安全解析 seekerIntentJson → 切片数组（脏数据 → 空数组，不抛）。 */
function parseSeekerIntent(json: string | null): FairIntentSlice[] {
  if (!json) return []
  try {
    const arr = JSON.parse(json) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .filter(
        (x): x is FairIntentSlice =>
          !!x &&
          typeof (x as { label?: unknown }).label === 'string' &&
          typeof (x as { percent?: unknown }).percent === 'number',
      )
      .map((x) => ({ label: x.label, percent: x.percent }))
  } catch {
    return []
  }
}

export function mapFair(row: PrismaJobFairRow): Fair {
  return {
    id: row.id,
    sourceOrgId: row.sourceOrgId,
    externalId: row.externalId,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    checkinUrl: row.checkinUrl,
    title: row.title,
    theme: row.theme,
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    venue: row.venue,
    city: row.city,
    address: row.address,
    mapImageUrl: row.mapImageUrl,
    description: row.description,
    coverImageUrl: row.coverImageUrl,
    latitude: row.latitude,
    longitude: row.longitude,
    trafficInfo: row.trafficInfo,
    expectedAttendance: row.expectedAttendance,
    seekerIntent: parseSeekerIntent(row.seekerIntentJson),
    companyCount: row.companyCount,
    jobCount: row.jobCount,
    viewCount: row.viewCount,
    reviewStatus: row.reviewStatus,
    publishStatus: row.publishStatus,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectReason: row.rejectReason,
    syncTime: row.syncTime.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function mapFairCompany(row: PrismaFairCompanyRow): FairCompany {
  return {
    id: row.id,
    jobFairId: row.jobFairId,
    name: row.name,
    logoUrl: row.logoUrl,
    industry: row.industry,
    scale: row.scale,
    description: row.description,
    sourceUrl: row.sourceUrl,
    hiringTags: splitTags(row.hiringTags),
    jobsCount: row.jobsCount,
    coverImageUrl: row.coverImageUrl,
    founded: row.founded,
    headquarters: row.headquarters,
    registeredCapital: row.registeredCapital,
    honorTags: splitTags(row.honorTags),
    zoneId: row.zoneId,
    boothNumber: row.boothNumber,
    positions: (row.positions ?? []).map(mapFairCompanyPosition),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function mapFairZone(row: PrismaFairZoneRow): FairZone {
  return {
    id: row.id,
    jobFairId: row.jobFairId,
    name: row.name,
    category: row.category,
    city: row.city,
    description: row.description,
    coverImageUrl: row.coverImageUrl,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
