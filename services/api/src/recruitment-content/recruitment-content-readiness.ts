import { isIP } from 'node:net'
import type { PublicationReadiness } from './recruitment-content.types'

export interface EvidenceFileShape {
  id: string
  purpose: string
  visibility: string
  status: string
  deletedAt: Date | null
  expiresAt: Date | null
}

interface VersionedContent {
  status?: string
  reviewStatus: string
  publishStatus: string
  contentHash: string | null
  approvedContentHash: string | null
  hashAlgorithmVersion: string | null
  archivedAt: Date | null
}

export const EVIDENCE_FILE_SELECT = {
  id: true,
  purpose: true,
  visibility: true,
  status: true,
  deletedAt: true,
  expiresAt: true,
} as const

export function contentBlockers(row: VersionedContent): string[] {
  const blockers: string[] = []
  if (row.archivedAt) blockers.push('archived')
  if (row.status !== undefined && row.status !== 'active') blockers.push('inactive')
  if (row.reviewStatus !== 'approved') blockers.push('review_not_approved')
  if (row.publishStatus !== 'published') blockers.push('publish_not_published')
  if (!row.contentHash || !row.approvedContentHash) blockers.push('content_hash_missing')
  else if (row.contentHash !== row.approvedContentHash) blockers.push('approved_hash_mismatch')
  if (!row.hashAlgorithmVersion) blockers.push('hash_algorithm_missing')
  return blockers
}

export function readiness(blockers: string[]): PublicationReadiness {
  const unique = [...new Set(blockers)]
  return { ready: unique.length === 0, blockers: unique }
}

export function parseStringArrayPolicy(raw: string): { valid: boolean; values: string[] } {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      return { valid: false, values: [] }
    }
    const values = parsed.map((item) => item.trim()).filter(Boolean)
    return { valid: values.length === parsed.length, values: [...new Set(values)] }
  } catch {
    return { valid: false, values: [] }
  }
}

export function parseDomainPolicy(raw: string): { valid: boolean; domains: string[] } {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return { valid: false, domains: [] }
    const normalized = parsed.map((item) => typeof item === 'string' ? normalizeDomain(item) : null)
    if (normalized.some((item) => !item)) return { valid: false, domains: [] }
    return { valid: true, domains: [...new Set(normalized as string[])] }
  } catch {
    return { valid: false, domains: [] }
  }
}

function normalizeDomain(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/\.$/, '')
  if (!domain || domain === 'localhost' || domain.endsWith('.local') || isIP(domain)) return null
  const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
  return domain.length <= 253 && domainPattern.test(domain) ? domain : null
}

export function validateLandingUrl(raw: string, domains: string[]): {
  validUrl: boolean
  allowedDomain: boolean
} {
  try {
    const url = new URL(raw)
    const host = normalizeDomain(url.hostname)
    const validUrl = url.protocol === 'https:' && !url.username && !url.password && Boolean(host)
    return {
      validUrl,
      allowedDomain: validUrl && domains.some((domain) => host === domain || host?.endsWith(`.${domain}`)),
    }
  } catch {
    return { validUrl: false, allowedDomain: false }
  }
}

export function requiredQualificationTypes(orgType: string, serviceScope: string[]): string[] | null {
  if (orgType === 'public_employment_service') return ['public_service_authority']
  if (orgType !== 'licensed_hr_agency') return null
  return [
    'business_license',
    'hr_service_license',
    ...(serviceScope.includes('labor_dispatch') ? ['labor_dispatch_permit'] : []),
  ]
}

export function maskLicenseNumber(value: string | null): string | null {
  if (!value) return null
  const normalized = value.trim()
  if (normalized.length <= 4) return '*'.repeat(normalized.length)
  return `${normalized.slice(0, 2)}${'*'.repeat(Math.min(normalized.length - 4, 12))}${normalized.slice(-2)}`
}

export function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null
}

export function isUsableEvidence(file: EvidenceFileShape | null): file is EvidenceFileShape {
  return Boolean(
    file
    && file.purpose === 'qualification_evidence'
    && file.visibility === 'private'
    && file.status === 'active'
    && !file.deletedAt
    && (!file.expiresAt || file.expiresAt.getTime() > Date.now()),
  )
}
