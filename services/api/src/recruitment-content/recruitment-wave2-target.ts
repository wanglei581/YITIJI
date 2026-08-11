import { createHash } from 'node:crypto'
import type { EvidenceFileShape } from './recruitment-content-readiness'

export const RECRUITMENT_WAVE2_RULE_VERSION = 'recruitment-wave2-plan-v1'

export type AgencyManifestEntry =
  | { disposition: 'blocker'; legacyAgencyId: string; reasonCodes: string[] }
  | { disposition: 'archived_skip'; legacyAgencyId: string; reasonCode: string; authorizationRef: string }
  | {
  disposition: 'map'
  legacyAgencyId: string
  organizationId: string
  profileId: string
  branchId: string
}

export type JobManifestEntry =
  | { disposition: 'blocker'; legacyJobId: string; reasonCodes: string[] }
  | { disposition: 'archived_skip'; legacyJobId: string; reasonCode: string; authorizationRef: string }
  | {
  disposition: 'map'
  legacyJobId: string
  organizationId: string
  jobSourceId: string
  offlineBranchId: string
  employer: string
  cityName: string
  cityCode: string
  sourceUrl: string
  finalUrl: string
  linkCheckRef: string
  externalId?: string
}

export interface RecruitmentWave2Manifest {
  schemaVersion: 1
  ruleVersion: typeof RECRUITMENT_WAVE2_RULE_VERSION
  snapshotSha256: string
  asOf: string
  approvalRef: string
  approvedAt: string
  agencies: AgencyManifestEntry[]
  jobs: JobManifestEntry[]
}

interface VersionedRow {
  contentVersion: number
  reviewStatus: string
  publishStatus: string
  contentHash: string | null
  approvedContentHash: string | null
  hashAlgorithmVersion: string | null
  reviewedBy: string | null
  reviewedAt: Date | null
  rejectReason: string | null
  archivedAt: Date | null
}

export interface RecruitmentWave2Snapshot {
  organizations: Array<{ id: string; type: string; contentTrustStatus: string | null; archivedAt: Date | null }>
  sources: Array<{
    id: string; orgId: string; name: string; approvalStatus: string | null; trustStatus: string | null
    archivedAt: Date | null; allowedContentDomainsJson: string | null; redirectPolicy: string | null
  }>
  profiles: Array<VersionedRow & { id: string; organizationId: string; serviceScopeJson: string }>
  branches: Array<VersionedRow & { id: string; agencyProfileId: string; status: string; cityCode: string | null }>
  qualifications: Array<{
    id: string; organizationId: string; qualificationType: string; appliesToBranchId: string | null
    status: string; contentVersion: number; validFrom: Date | null; validUntil: Date | null; contentHash: string | null
    approvedContentHash: string | null; hashAlgorithmVersion: string | null; issuerName: string
    jurisdiction: string; verificationSource: string; verifiedBy: string | null; verifiedAt: Date | null
    archivedAt: Date | null; evidenceFile: EvidenceFileShape | null
  }>
  decisions: Array<{
    id: string; targetType: string; targetId: string; contentVersion: number | null
    contentHash: string | null; hashAlgorithmVersion: string | null; action: string
    toStatus: string | null; actorRole: string; occurredAt: Date; correlationId: string | null
    requestId: string | null
  }>
  legacyAgencies: Array<{
    id: string; sourceOrgId: string | null; status: string; createdAt: Date; updatedAt: Date
  }>
  legacyJobs: Array<{
    id: string; agencyId: string; title: string; jobType: string; salaryMin: number | null
    salaryMax: number | null; salaryUnit: string; headcount: number; requirements: string | null; description: string | null
    location: string | null; education: string | null; experience: string | null; externalUrl: string | null
    externalId: string | null; canonicalJobId: string | null; migrationChecksum: string | null; status: string
    createdAt: Date; updatedAt: Date
  }>
  jobs: Array<{
    id: string; sourceOrgId: string; sourceId: string | null; externalId: string; offlineBranchId: string | null
    sourceName: string; sourceUrl: string; title: string; company: string; city: string; category: string | null
    salary: string | null; salaryMin: number | null; salaryMax: number | null; salaryUnit: string | null
    description: string | null; requirements: string | null; educationRequirement: string | null
    experienceRequirement: string | null; tagsJson: string; skillsJson: string; benefitsJson: string
    validThrough: Date | null; companyProfileId: string | null
    reviewStatus: string; publishStatus: string; contentHash: string | null; contentVersion: number | null
    approvedContentHash: string | null; hashAlgorithmVersion: string | null; sourceLastSeenAt: Date | null
    reviewedBy: string | null; reviewedAt: Date | null; rejectReason: string | null; archivedAt: Date | null
  }>
}

export interface RecruitmentWave2PlanContext {
  snapshotAsOf: string
  evaluatedAt: Date
}

export interface RecruitmentWave2PlanItem {
  legacyId: string
  result: 'candidate' | 'blocker' | 'archived_skip'
  reasonCodes: string[]
  targetId?: string
  migrationChecksum?: string
  contentHash?: string
}

export interface RecruitmentWave2Plan {
  ruleVersion: typeof RECRUITMENT_WAVE2_RULE_VERSION
  snapshotSha256: string
  manifestChecksum: string
  planChecksum: string
  plannedJobState: {
    contentVersion: 1
    hashAlgorithmVersion: 'job-content-v1'
    reviewStatus: 'pending'
    publishStatus: 'draft'
    approvedContentHash: null
    reviewedBy: null
    reviewedAt: null
    rejectReason: null
    sourceLastSeenAt: null
  }
  agencies: { total: number; candidate: number; blocker: number; archivedSkipped: number; items: RecruitmentWave2PlanItem[] }
  jobs: { total: number; candidate: number; blocker: number; archivedSkipped: number; items: RecruitmentWave2PlanItem[] }
}

export type RecruitmentWave2Target = 'authorized-readonly' | 'restored-isolated' | 'ci-fixture'

export interface RecruitmentWave2TargetEnvironment {
  RECRUITMENT_WAVE2_TARGET?: string
  RECRUITMENT_WAVE2_AUTHORIZATION_REF?: string
  RECRUITMENT_WAVE2_AUTHORIZED_UNTIL?: string
  RECRUITMENT_WAVE2_EXPECTED_DATABASE?: string
  RECRUITMENT_WAVE2_PRODUCTION_READONLY_URL?: string
  RECRUITMENT_WAVE2_RESTORED_READONLY_URL?: string
  RECRUITMENT_WAVE2_RESTORE_NONCE?: string
  RECRUITMENT_WAVE2_SNAPSHOT_SHA256?: string
}

export interface RecruitmentWave2TargetConfig {
  target: RecruitmentWave2Target
  databaseUrl: string
  expectedDatabase: string
  authorizationRef: string
  authorizedUntil: Date
  restoreNonce: string | null
  snapshotSha256: string | null
}

const AUTHORIZATION_WINDOW_MS = 4 * 60 * 60 * 1000
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,127}$/u
const SAFE_NONCE = /^[A-Za-z0-9_-]{16,128}$/u
const SHA256 = /^[a-f0-9]{64}$/u

export function resolveRecruitmentWave2Target(
  env: RecruitmentWave2TargetEnvironment = process.env,
  now = new Date(),
): RecruitmentWave2TargetConfig {
  const target = env.RECRUITMENT_WAVE2_TARGET
  if (!isTarget(target)) throw new Error('RECRUITMENT_WAVE2_TARGET_INVALID')

  const authorizationRef = requireMatch(
    env.RECRUITMENT_WAVE2_AUTHORIZATION_REF,
    SAFE_REFERENCE,
    'RECRUITMENT_WAVE2_AUTHORIZATION_REF_INVALID',
  )
  const authorizedUntil = parseFutureDate(env.RECRUITMENT_WAVE2_AUTHORIZED_UNTIL, now)
  const expectedDatabase = requireExpectedDatabase(env.RECRUITMENT_WAVE2_EXPECTED_DATABASE)
  const databaseUrl = target === 'authorized-readonly'
    ? env.RECRUITMENT_WAVE2_PRODUCTION_READONLY_URL
    : env.RECRUITMENT_WAVE2_RESTORED_READONLY_URL
  const parsed = parsePostgresUrl(databaseUrl)
  if (parsed.database !== expectedDatabase) throw new Error('RECRUITMENT_WAVE2_DATABASE_MISMATCH')

  if (target === 'ci-fixture' && !isLoopback(parsed.hostname)) {
    throw new Error('RECRUITMENT_WAVE2_CI_DATABASE_NOT_LOOPBACK')
  }

  if (target === 'authorized-readonly') {
    return {
      target,
      databaseUrl: databaseUrl!,
      expectedDatabase,
      authorizationRef,
      authorizedUntil,
      restoreNonce: null,
      snapshotSha256: null,
    }
  }

  return {
    target,
    databaseUrl: databaseUrl!,
    expectedDatabase,
    authorizationRef,
    authorizedUntil,
    restoreNonce: requireMatch(
      env.RECRUITMENT_WAVE2_RESTORE_NONCE,
      SAFE_NONCE,
      'RECRUITMENT_WAVE2_RESTORE_NONCE_INVALID',
    ),
    snapshotSha256: requireMatch(
      env.RECRUITMENT_WAVE2_SNAPSHOT_SHA256?.toLowerCase(),
      SHA256,
      'RECRUITMENT_WAVE2_SNAPSHOT_SHA256_INVALID',
    ),
  }
}

export function assertRecruitmentWave2ExecutionWindow(
  config: Pick<RecruitmentWave2TargetConfig, 'authorizedUntil'>,
  now = new Date(),
  markerExpiresAt?: Date | null,
): void {
  if (!Number.isFinite(now.getTime()) || now >= config.authorizedUntil) {
    throw new Error('RECRUITMENT_WAVE2_AUTHORIZATION_EXPIRED')
  }
  if (markerExpiresAt && (!Number.isFinite(markerExpiresAt.getTime()) || now >= markerExpiresAt)) {
    throw new Error('RECRUITMENT_WAVE2_RESTORE_MARKER_EXPIRED')
  }
}

export function assertRecruitmentWave2Manifest(
  manifest: RecruitmentWave2Manifest,
  context: RecruitmentWave2PlanContext,
): void {
  if (manifest.schemaVersion !== 1 || manifest.ruleVersion !== RECRUITMENT_WAVE2_RULE_VERSION) {
    throw new Error('RECRUITMENT_WAVE2_MANIFEST_VERSION_INVALID')
  }
  if (!/^[a-f0-9]{64}$/u.test(manifest.snapshotSha256)) throw new Error('RECRUITMENT_WAVE2_MANIFEST_SNAPSHOT_INVALID')
  const asOf = new Date(manifest.asOf)
  if (!Number.isFinite(asOf.getTime()) || asOf.toISOString() !== manifest.asOf) {
    throw new Error('RECRUITMENT_WAVE2_MANIFEST_AS_OF_INVALID')
  }
  const approvedAt = new Date(manifest.approvedAt)
  if (!Number.isFinite(approvedAt.getTime()) || approvedAt.toISOString() !== manifest.approvedAt
    || typeof manifest.approvalRef !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{5,127}$/u.test(manifest.approvalRef.trim())) {
    throw new Error('RECRUITMENT_WAVE2_MANIFEST_APPROVAL_INVALID')
  }
  const snapshotAsOf = new Date(context.snapshotAsOf)
  const ageMs = context.evaluatedAt.getTime() - snapshotAsOf.getTime()
  if (!Number.isFinite(context.evaluatedAt.getTime()) || !Number.isFinite(snapshotAsOf.getTime())
    || snapshotAsOf.toISOString() !== context.snapshotAsOf || manifest.asOf !== context.snapshotAsOf
    || ageMs < 0 || ageMs > 24 * 60 * 60 * 1000
    || approvedAt < snapshotAsOf || approvedAt > context.evaluatedAt) {
    throw new Error('RECRUITMENT_WAVE2_MANIFEST_TIME_CONTEXT_INVALID')
  }
  if (!Array.isArray(manifest.agencies) || !Array.isArray(manifest.jobs)) {
    throw new Error('RECRUITMENT_WAVE2_MANIFEST_COLLECTION_INVALID')
  }
  const dispositions = new Set(['map', 'blocker', 'archived_skip'])
  if ([...manifest.agencies, ...manifest.jobs].some((entry) => !entry || !dispositions.has(entry.disposition))) {
    throw new Error('RECRUITMENT_WAVE2_MANIFEST_DISPOSITION_INVALID')
  }
}

export function recruitmentExistingJobContent(row: RecruitmentWave2Snapshot['jobs'][number]) {
  return {
    sourceOrgId: row.sourceOrgId,
    sourceId: row.sourceId,
    externalId: row.externalId,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    title: row.title,
    company: row.company,
    city: row.city,
    category: row.category,
    salary: row.salary,
    salaryMin: row.salaryMin,
    salaryMax: row.salaryMax,
    salaryUnit: row.salaryUnit,
    description: row.description,
    requirements: row.requirements,
    educationRequirement: row.educationRequirement,
    experienceRequirement: row.experienceRequirement,
    tagsJson: row.tagsJson,
    skillsJson: row.skillsJson,
    benefitsJson: row.benefitsJson,
    validThrough: row.validThrough,
    companyProfileId: row.companyProfileId,
    offlineBranchId: row.offlineBranchId,
  }
}

export function hasRecruitmentContentDecision(
  snapshot: RecruitmentWave2Snapshot,
  targetType: string,
  row: { id: string; contentVersion: number; contentHash: string | null; hashAlgorithmVersion: string | null },
  actions: string[],
  action: string,
  toStatus: string,
  asOf: Date,
): boolean {
  return hasRecruitmentDecision(snapshot, {
    targetType, targetId: row.id, contentVersion: row.contentVersion, contentHash: row.contentHash,
    hashAlgorithmVersion: row.hashAlgorithmVersion, actions, action, toStatus, asOf,
  })
}

export function hasRecruitmentDecision(
  snapshot: RecruitmentWave2Snapshot,
  expected: {
    targetType: string; targetId: string; actions: string[]; action: string; toStatus: string; asOf: Date
    contentVersion?: number; contentHash?: string | null; hashAlgorithmVersion?: string | null
  },
): boolean {
  const latest = snapshot.decisions.filter((row) => row.targetType === expected.targetType
    && row.targetId === expected.targetId && expected.actions.includes(row.action)
    && row.occurredAt <= expected.asOf)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id))[0]
  return Boolean(latest && latest.action === expected.action && latest.toStatus === expected.toStatus
    && (expected.contentVersion === undefined || latest.contentVersion === expected.contentVersion)
    && (expected.contentHash === undefined || latest.contentHash === expected.contentHash)
    && (expected.hashAlgorithmVersion === undefined || latest.hashAlgorithmVersion === expected.hashAlgorithmVersion)
    && latest.actorRole.trim() && latest.correlationId?.trim() && latest.requestId?.trim())
}

function isTarget(value: string | undefined): value is RecruitmentWave2Target {
  return value === 'authorized-readonly' || value === 'restored-isolated' || value === 'ci-fixture'
}

function requireMatch(value: string | undefined, pattern: RegExp, code: string): string {
  const normalized = value?.trim()
  if (!normalized || !pattern.test(normalized)) throw new Error(code)
  return normalized
}

function parseFutureDate(value: string | undefined, now: Date): Date {
  const parsed = value ? new Date(value) : new Date(Number.NaN)
  const duration = parsed.getTime() - now.getTime()
  if (!Number.isFinite(parsed.getTime()) || duration <= 0 || duration > AUTHORIZATION_WINDOW_MS) {
    throw new Error('RECRUITMENT_WAVE2_AUTHORIZATION_WINDOW_INVALID')
  }
  return parsed
}

function requireExpectedDatabase(value: string | undefined): string {
  const normalized = value?.trim()
  if (!normalized || !/^[A-Za-z0-9][A-Za-z0-9_-]{5,62}$/u.test(normalized)) {
    throw new Error('RECRUITMENT_WAVE2_EXPECTED_DATABASE_INVALID')
  }
  return normalized
}

function parsePostgresUrl(value: string | undefined): { database: string; hostname: string } {
  if (!value) throw new Error('RECRUITMENT_WAVE2_DATABASE_URL_REQUIRED')
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') throw new Error('protocol')
    const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ''))
    if (!database) throw new Error('database')
    return { database, hostname: parsed.hostname }
  } catch {
    throw new Error('RECRUITMENT_WAVE2_DATABASE_URL_INVALID')
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]'
}

export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (value === undefined) return '{"$undefined":true}'
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'))
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('RECRUITMENT_WAVE2_NON_FINITE_NUMBER')
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function digest(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
