import type { Fair, FairCompany, FairZone } from './fair.types'

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
  createdAt: Date
  updatedAt: Date
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

export function mapFair(row: PrismaJobFairRow): Fair {
  return {
    id: row.id,
    sourceOrgId: row.sourceOrgId,
    externalId: row.externalId,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
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
    hiringTags: row.hiringTags
      ? row.hiringTags.split(',').map((t) => t.trim()).filter(Boolean)
      : [],
    jobsCount: row.jobsCount,
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
