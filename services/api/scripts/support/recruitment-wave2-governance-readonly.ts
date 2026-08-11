import type { EvidenceFileShape } from '../../src/recruitment-content/recruitment-content-readiness'
import { canonicalJson, digest, type RecruitmentWave2Manifest,
  type RecruitmentWave2Snapshot } from '../../src/recruitment-content/recruitment-wave2-plan'
import { proposedBranchHash, proposedProfileHash,
  proposedQualificationHash } from '../../src/recruitment-content/recruitment-wave2-proposed-governance-rules'
import type { ProposedBranch, ProposedProfile, ProposedQualification,
  RecruitmentWave2ProposedGovernance } from '../../src/recruitment-content/recruitment-wave2-proposed-governance.types'
import type { QueryRows } from './recruitment-wave2-readonly-db'

export interface RecruitmentWave2GovernanceFairRow {
  id: string
  sourceOrgId: string
  sourceId: string | null
  externalId: string
  sourceName: string
  sourceUrl: string
  checkinUrl: string | null
  startAt: Date
  endAt: Date
  reviewStatus: string
  publishStatus: string
  reviewedBy: string | null
  reviewedAt: Date | null
  rejectReason: string | null
  syncTime: Date
  updatedAt: Date
}

export interface RecruitmentWave2GovernanceAuditRow {
  id: string
  action: string
  targetType: string
  targetId: string | null
  createdAt: Date
  payloadJson: string
}

export interface RecruitmentWave2GovernanceExtras {
  fairs: RecruitmentWave2GovernanceFairRow[]
  auditCandidates: RecruitmentWave2GovernanceAuditRow[]
  evidenceFiles: EvidenceFileShape[]
}

const FAIR_SQL = `SELECT "id","sourceOrgId","sourceId","externalId","sourceName","sourceUrl","checkinUrl",
  "startAt","endAt","reviewStatus","publishStatus","reviewedBy","reviewedAt","rejectReason","syncTime","updatedAt"
  FROM "JobFair" WHERE "id">$1 ORDER BY "id" LIMIT $2`

export async function loadRecruitmentWave2GovernanceExtras(
  query: QueryRows,
  batchSize: number,
  auditCandidateIds: string[],
  evidenceFileIds: string[]
): Promise<RecruitmentWave2GovernanceExtras> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('RECRUITMENT_WAVE2_BATCH_SIZE_INVALID')
  }
  const fairs = await loadBatched<RecruitmentWave2GovernanceFairRow>(query, FAIR_SQL, batchSize)
  const auditCandidates = auditCandidateIds.length
    ? await query<RecruitmentWave2GovernanceAuditRow>(`SELECT "id","action","targetType","targetId","createdAt","payloadJson"
        FROM "AuditLog" WHERE "id"=ANY($1::text[]) ORDER BY "id"`, [auditCandidateIds])
    : []
  const evidenceFiles = evidenceFileIds.length
    ? await query<EvidenceFileShape>(`SELECT "id","purpose","visibility","status","deletedAt","expiresAt"
        FROM "FileObject" WHERE "id"=ANY($1::text[]) ORDER BY "id"`, [evidenceFileIds])
    : []
  return { fairs, auditCandidates, evidenceFiles }
}

async function loadBatched<T extends { id: string }>(
  query: QueryRows,
  sql: string,
  batchSize: number
): Promise<T[]> {
  const result: T[] = []
  let cursor = ''
  for (;;) {
    const rows = await query<T>(sql, [cursor, batchSize])
    result.push(...rows)
    if (rows.length < batchSize) return result
    cursor = rows.at(-1)!.id
  }
}

export function buildRecruitmentWave2ProposedGovernanceCiFixture(
  snapshot: RecruitmentWave2Snapshot, extras: RecruitmentWave2GovernanceExtras,
  reportSha256: string, reportSnapshotDigest: string, snapshotAsOf: string,
): { governance: RecruitmentWave2ProposedGovernance; manifest: RecruitmentWave2Manifest } {
  const fingerprint = (value: unknown) => digest(canonicalJson(value))
  const coverage = (ids: string[]) => ({ count: ids.length, idsSha256: digest(canonicalJson([...new Set(ids)].sort())) })
  const profile: ProposedProfile = { profileId: 'rw2-proposed-profile', mustBeAbsent: true, organizationId: 'rw2-org',
    displayName: 'CI restricted agency', description: null, serviceScope: [], reviewStatus: 'approved',
    publishStatus: 'published', contentVersion: 1, contentHash: '', approvedContentHash: null,
    hashAlgorithmVersion: 'offline-agency-profile-v1', evidenceRef: 'evidence/ci-profile' }
  profile.contentHash = proposedProfileHash(profile); profile.approvedContentHash = profile.contentHash
  const branch: ProposedBranch = { branchId: 'rw2-proposed-branch', mustBeAbsent: true, profileId: profile.profileId,
    branchName: 'CI restricted branch', provinceCode: '310000', cityCode: '310100', districtCode: '310101',
    address: 'CI restricted address', lat: null, lng: null, geoSource: null, serviceHours: null,
    serviceHoursSource: null, publicPhone: null, website: 'https://jobs.example.test/agency', status: 'active',
    reviewStatus: 'approved', publishStatus: 'published', contentVersion: 1, contentHash: '', approvedContentHash: null,
    hashAlgorithmVersion: 'offline-agency-branch-v1', evidenceRef: 'evidence/ci-branch' }
  branch.contentHash = proposedBranchHash(branch); branch.approvedContentHash = branch.contentHash
  const qualification = (qualificationId: string, qualificationType: string): ProposedQualification => {
    const row: ProposedQualification = { qualificationId, mustBeAbsent: true, organizationId: 'rw2-org', qualificationType,
      licenseNumber: null, issuerName: 'CI issuer', jurisdiction: '310000', branchId: branch.branchId,
      validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2099-01-01T00:00:00.000Z', status: 'valid',
      contentVersion: 1, contentHash: '', approvedContentHash: null, hashAlgorithmVersion: 'qualification-record-v1',
      evidenceFileId: 'rw2-evidence', verificationSource: 'evidence/manual-ci', verifiedBy: 'ci-admin',
      verifiedAt: '2026-08-01T00:00:00.000Z', evidenceRef: `evidence/${qualificationId}` }
    row.contentHash = proposedQualificationHash(row); row.approvedContentHash = row.contentHash
    return row
  }
  const qualifications = [qualification('rw2-proposed-business', 'business_license'),
    qualification('rw2-proposed-hr', 'hr_service_license')]
  const source = snapshot.sources.find((row) => row.id === 'rw2-source')
  const organization = snapshot.organizations.find((row) => row.id === 'rw2-org')
  if (!source || !organization) throw new Error('RECRUITMENT_WAVE2_PROPOSED_CI_BASELINE_INVALID')
  const actions = [
    ['organization_content_trust', 'rw2-org', 'trust_activate', 'active'],
    ['job_source', 'rw2-source', 'source_approve', 'approved'], ['job_source', 'rw2-source', 'trust_activate', 'active'],
    ['offline_agency_profile', profile.profileId, 'approve', 'approved'],
    ['offline_agency_profile', profile.profileId, 'publish', 'published'],
    ['offline_agency_branch', branch.branchId, 'approve', 'approved'],
    ['offline_agency_branch', branch.branchId, 'publish', 'published'],
    ...qualifications.map((row) => ['qualification_record', row.qualificationId, 'qualification_verify', 'valid']),
  ].map(([targetType, targetId, action, toStatus], index) => ({ ref: `proposed/action-${index + 1}`,
    targetType: targetType!, targetId: targetId!, action: action!, toStatus: toStatus!, sequence: index + 1 }))
  const preparedAt = new Date().toISOString()
  const governance: RecruitmentWave2ProposedGovernance = {
    schemaVersion: 1, ruleVersion: 'recruitment-wave2-proposed-governance-v1', sourceInventoryReportSha256: reportSha256,
    sourceDatabaseSnapshotDigest: reportSnapshotDigest, restoreSnapshotSha256: 'a'.repeat(64), asOf: snapshotAsOf,
    preparedAt, preparedByRef: 'ci-fixture/owner-ready', expectedCoverage: {
      sources: coverage(['rw2-source']), sourceBoundJobs: coverage(snapshot.jobs.map((row) => row.id)), orphanJobs: coverage([]),
      fairs: coverage(extras.fairs.map((row) => row.id)), legacyAgencies: coverage(snapshot.legacyAgencies.map((row) => row.id)),
      legacyJobs: coverage(snapshot.legacyJobs.map((row) => row.id)), auditCandidates: coverage([]) },
    organizations: [{ organizationId: 'rw2-org', baseFingerprint: fingerprint(organization),
      contentTrustStatus: 'active', evidenceRef: 'evidence/org-ready' }],
    sources: [{ sourceId: 'rw2-source', baseFingerprint: fingerprint(source), organizationId: 'rw2-org',
      approvalStatus: 'approved', trustStatus: 'active', syncEnabled: false, allowedContentDomains: ['jobs.example.test'],
      redirectPolicy: 'allowlist_only', evidenceRef: 'evidence/source-ready' }],
    jobLinkEvidence: snapshot.jobs.map((row) => ({ ref: `evidence/link-${row.id}`, jobId: row.id,
      baseFingerprint: fingerprint(row), sourceId: 'rw2-source', sourceUrl: row.sourceUrl,
      finalUrl: row.sourceUrl, linkCheckRef: `link-check/${row.id}` })), orphanJobs: [],
    fairs: extras.fairs.map((row) => ({ fairId: row.id, baseFingerprint: fingerprint(row), disposition: 'propose',
      organizationId: 'rw2-org', sourceId: 'rw2-source', sourceUrl: row.sourceUrl, finalUrl: row.sourceUrl,
      checkinUrl: row.checkinUrl, finalCheckinUrl: row.checkinUrl, sourceLinkCheckRef: `link-check/${row.id}-source`,
      checkinLinkCheckRef: row.checkinUrl ? `link-check/${row.id}-checkin` : null,
      organizerAuthorizationRef: `evidence/${row.id}-authorization`, organizerAuthorizationSha256: 'b'.repeat(64),
      authorizationValidFrom: '2026-01-01T00:00:00.000Z', authorizationValidUntil: '2100-01-01T00:00:00.000Z',
      reasonCode: null, authorizationRef: null })), profiles: [profile], branches: [branch], qualifications,
    proposedActions: actions, auditCandidates: [],
  }
  const manifest: RecruitmentWave2Manifest = { schemaVersion: 1, ruleVersion: 'recruitment-wave2-plan-v1',
    snapshotSha256: 'a'.repeat(64), asOf: snapshotAsOf, approvalRef: 'AUTH/recruitment-wave2/ci-ready-manifest',
    approvedAt: preparedAt, agencies: snapshot.legacyAgencies.map((row) => ({ disposition: 'map', legacyAgencyId: row.id,
      organizationId: 'rw2-org', profileId: profile.profileId, branchId: branch.branchId })),
    jobs: snapshot.legacyJobs.map((row) => ({ disposition: 'map', legacyJobId: row.id, organizationId: 'rw2-org',
      jobSourceId: 'rw2-source', offlineBranchId: branch.branchId, employer: 'CI verified employer', cityName: 'Shanghai',
      cityCode: '310100', sourceUrl: `https://jobs.example.test/legacy/${row.id}`,
      finalUrl: `https://jobs.example.test/legacy/${row.id}`, linkCheckRef: `link-check/${row.id}`,
      externalId: row.externalId ?? `offline-job:${row.id}` })) }
  return { governance, manifest }
}
