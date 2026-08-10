import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildRecruitmentWave2ProposedGovernancePlan,
  type ProposedGovernancePlanInput,
  type RecruitmentWave2ProposedGovernancePlan,
} from '../src/recruitment-content/recruitment-wave2-proposed-governance-plan'
import {
  parseRecruitmentWave2ProposedGovernance,
  type ProposedBranch,
  type ProposedProfile,
  type ProposedQualification,
  type RecruitmentWave2ProposedGovernance,
} from '../src/recruitment-content/recruitment-wave2-proposed-governance.types'
import {
  canonicalJson,
  digest,
  RECRUITMENT_WAVE2_RULE_VERSION,
  type RecruitmentWave2Manifest,
  type RecruitmentWave2Snapshot,
} from '../src/recruitment-content/recruitment-wave2-plan'
import {
  proposedBranchHash,
  proposedProfileHash,
  proposedQualificationHash,
} from '../src/recruitment-content/recruitment-wave2-proposed-governance-rules'

const AS_OF = '2026-08-10T00:30:00.000Z'
const EVALUATED_AT = new Date('2026-08-10T00:40:00.000Z')
const SHA_A = 'a'.repeat(64), SHA_B = 'b'.repeat(64), SHA_C = 'c'.repeat(64)

function main(): void {
  verifyMinimumAndParser()
  verifyCoverageAndChecksums()
  verifyHypotheticalHistory()
  verifyDomainAndOrphanEvidence()
  verifyFairAuthorization()
  verifyClosedBranchAndCanonicalHashes()
  verifyQualificationEvidenceAndValidity()
  verifyProposalScopeAndQualificationOwnership()
  verifyLegacyHypotheticalBusinessRules()
  verifyAuditPayloadBinding()
  verifySafeOutputAndNoWriteCli()
  console.log('Recruitment Wave 2 proposed governance contract: PASS')
}

function verifyMinimumAndParser(): void {
  const input = fixture(), plan = build(input)
  assert.deepEqual(
    [plan.recommendedExitCode, plan.readyForOwnerApproval, plan.fairTargetSafe, plan.publicationDecision, plan.databaseWrites],
    [0, true, 'unsupported', 'not_evaluated', 0],
  )
  const raw = clone(input.governance) as RecruitmentWave2ProposedGovernance & { unexpected?: boolean }
  raw.unexpected = true
  assert.throws(() => parseRecruitmentWave2ProposedGovernance(raw), /RECRUITMENT_WAVE2_PROPOSED_GOVERNANCE_UNKNOWN_FIELD/u)
}

function verifyCoverageAndChecksums(): void {
  const bad = fixture()
  bad.governance.expectedCoverage.sources.count += 1
  assertReason(build(bad), 'expected_coverage_mismatch')
  const digestMismatch = fixture()
  digestMismatch.inventory.snapshotDigest = SHA_C
  assertReason(build(digestMismatch), 'source_snapshot_digest_mismatch')
  const first = fixture(), second = clone(first)
  for (const key of ['organizations', 'sources', 'jobLinkEvidence', 'qualifications', 'proposedActions'] as const) second.governance[key].reverse()
  const a = build(first), b = build(second)
  assert.equal(a.proposalChecksum, b.proposalChecksum)
  assert.equal(a.combinedValidationChecksum, b.combinedValidationChecksum)
}

function verifyHypotheticalHistory(): void {
  const input = fixture(), before = canonicalJson(input.snapshot), plan = build(input)
  assert.equal(canonicalJson(input.snapshot), before)
  assert.equal(input.snapshot.decisions.length, 0)
  assert(plan.hypotheticalAfterExecution.proposedActionCount > 0)
  assert.equal(plan.hypotheticalAfterExecution.factsPersisted, false)
  assert(plan.legacyCurrentPlan.agencies.blocker > 0 && plan.legacyCurrentPlan.jobs.blocker > 0)
  const revoked = fixture()
  revoked.governance.proposedActions.push({ ref: 'proposed/action-revoke', targetType: 'organization_content_trust',
    targetId: 'org-1', action: 'trust_revoke', toStatus: 'revoked', sequence: revoked.governance.proposedActions.length + 1,
    reasonCode: 'evidence_revoked' })
  assertReason(build(revoked), 'organization_action_missing')
}

function verifyDomainAndOrphanEvidence(): void {
  const ip = fixture()
  ip.governance.sources[0]!.allowedContentDomains = ['127.0.0.1']
  assertReason(build(ip), 'source_domain_policy_invalid')
  const missing = fixture()
  missing.governance.jobLinkEvidence = missing.governance.jobLinkEvidence.filter((row) => row.jobId !== 'job-orphan')
  assertReason(build(missing), 'orphan_job_link_evidence_missing')
  const mismatch = fixture()
  mismatch.governance.jobLinkEvidence.find((row) => row.jobId === 'job-orphan')!.sourceId = 'missing-source'
  assertReason(build(mismatch), 'orphan_job_link_evidence_missing')
  const redirect = fixture()
  redirect.governance.sources[0]!.redirectPolicy = 'same_host_only'
  redirect.governance.sources[0]!.allowedContentDomains.push('apply.example.com')
  redirect.governance.jobLinkEvidence[0]!.finalUrl = 'https://apply.example.com/final'
  assertReason(build(redirect), 'redirect_host_mismatch')
}

function verifyFairAuthorization(): void {
  const missing = fixture()
  missing.governance.fairs[0]!.organizerAuthorizationRef = null
  assertReason(build(missing), 'fair_organizer_authorization_missing')
  const inactive = fixture()
  inactive.governance.fairs[0]!.authorizationValidUntil = '2026-08-11T09:00:00.000Z'
  assertReason(build(inactive), 'fair_organizer_authorization_inactive')
  const checkin = fixture()
  checkin.governance.fairs[0]!.checkinLinkCheckRef = null
  assertReason(build(checkin), 'fair_checkin_link_evidence_missing')
}

function verifyClosedBranchAndCanonicalHashes(): void {
  const closed = fixture(), closedBranch = closed.governance.branches[0]!
  closedBranch.status = 'closed'; refreshBranchHash(closedBranch)
  assertReason(build(closed), 'branch_not_active')
  const profileChanges: Array<[keyof ProposedProfile, unknown]> = [
    ['organizationId', 'org-2'], ['displayName', '另一机构'], ['description', '另一说明'], ['serviceScope', ['labor_dispatch']],
  ]
  const branchChanges: Array<[keyof ProposedBranch, unknown]> = [
    ['profileId', 'profile-2'], ['branchName', '另一门店'], ['provinceCode', '320000'], ['cityCode', '320100'],
    ['districtCode', '320102'], ['address', '另一地址'], ['lat', 32], ['lng', 119], ['geoSource', 'manual_map'],
    ['serviceHours', '10:00-17:00'], ['serviceHoursSource', 'evidence/hours-2'], ['publicPhone', '02000000000'],
    ['website', 'https://agency.example.com/other'], ['status', 'closed'],
  ]
  const qualificationChanges: Array<[keyof ProposedQualification, unknown]> = [
    ['organizationId', 'org-2'], ['qualificationType', 'organizer_authorization'], ['licenseNumber', 'changed-license'],
    ['issuerName', '另一机关'], ['jurisdiction', '320000'], ['branchId', null], ['validFrom', '2026-02-01T00:00:00.000Z'],
    ['validUntil', '2026-12-31T00:00:00.000Z'], ['evidenceFileId', 'evidence-other'],
    ['verificationSource', 'evidence/other-source'], ['verifiedBy', 'admin-other'], ['verifiedAt', '2026-08-09T00:00:00.000Z'],
  ]
  verifyHashChanges('profiles', profileChanges, 'profile_content_hash_mismatch')
  verifyHashChanges('branches', branchChanges, 'branch_content_hash_mismatch')
  verifyHashChanges('qualifications', qualificationChanges, 'qualification_content_hash_mismatch')
}

function verifyHashChanges(
  collection: 'profiles' | 'branches' | 'qualifications',
  changes: Array<[string, unknown]>,
  reason: string,
): void {
  for (const [key, value] of changes) {
    const input = fixture(), row = input.governance[collection][0]! as unknown as Record<string, unknown>
    row[key] = value
    assertReason(build(input), reason)
  }
}

function verifyQualificationEvidenceAndValidity(): void {
  const publicEvidence = fixture()
  publicEvidence.extras.evidenceFiles[0]!.visibility = 'public'
  assertReason(build(publicEvidence), 'qualification_evidence_invalid')
  const expiredEvidence = fixture()
  expiredEvidence.extras.evidenceFiles[0]!.expiresAt = new Date('2026-08-10T00:39:00.000Z')
  assertReason(build(expiredEvidence), 'qualification_evidence_invalid')
  const expired = fixture(), qualification = expired.governance.qualifications[0]!
  qualification.validUntil = '2026-08-10T00:39:00.000Z'; refreshQualificationHash(qualification)
  assertReason(build(expired), 'qualification_outside_validity')
}

function verifyProposalScopeAndQualificationOwnership(): void {
  const existingProfile = fixture()
  existingProfile.snapshot.profiles.push({ id: 'existing-profile', organizationId: 'org-1', serviceScopeJson: '[]',
    contentVersion: 1, reviewStatus: 'pending', publishStatus: 'draft', contentHash: null,
    approvedContentHash: null, hashAlgorithmVersion: null, reviewedBy: null, reviewedAt: null,
    rejectReason: null, archivedAt: null })
  assertReason(build(existingProfile), 'profile_organization_unique_conflict')

  const unreferenced = fixture(), extraProfile = clone(unreferenced.governance.profiles[0]!)
  extraProfile.profileId = 'profile-extra'; extraProfile.contentHash = proposedProfileHash(extraProfile)
  extraProfile.approvedContentHash = extraProfile.contentHash
  unreferenced.governance.profiles.push(extraProfile)
  assertReason(build(unreferenced), 'profile_unreferenced')

  const crossOrg = fixture(), qualification = clone(crossOrg.governance.qualifications[0]!)
  qualification.qualificationId = 'qualification-cross-org'; qualification.organizationId = 'org-does-not-exist'
  qualification.contentHash = proposedQualificationHash(qualification); qualification.approvedContentHash = qualification.contentHash
  crossOrg.governance.qualifications.push(qualification)
  crossOrg.governance.proposedActions.push({ ref: 'proposed/action-cross-org', targetType: 'qualification_record',
    targetId: qualification.qualificationId, action: 'qualification_verify', toStatus: 'valid',
    sequence: crossOrg.governance.proposedActions.length + 1 })
  const plan = build(crossOrg)
  assertReason(plan, 'qualification_organization_missing')
  assertReason(plan, 'qualification_branch_organization_mismatch')
}

function verifyLegacyHypotheticalBusinessRules(): void {
  const city = fixture()
  const cityEntry = city.legacyManifest.jobs[0]!
  if (cityEntry.disposition !== 'map') throw new Error('invalid fixture')
  cityEntry.cityCode = '123'
  assertReason(build(city), 'structured_city_invalid')

  const branchCity = fixture(), branch = branchCity.governance.branches[0]!
  branch.cityCode = null; refreshBranchHash(branch)
  const branchCityPlan = build(branchCity)
  assertReason(branchCityPlan, 'branch_structured_city_missing'); assertReason(branchCityPlan, 'branch_city_mismatch')

  const jobType = fixture()
  jobType.snapshot.legacyJobs[0]!.jobType = 'unknown'
  assertReason(build(jobType), 'job_type_unknown')

  const conflict = fixture(), legacy = conflict.snapshot.legacyJobs[0]!
  const mapped = conflict.legacyManifest.jobs[0]!
  if (mapped.disposition !== 'map') throw new Error('invalid fixture')
  mapped.externalId = conflict.snapshot.jobs[0]!.externalId
  conflict.snapshot.jobs.push({ ...conflict.snapshot.jobs[0]!, id: 'job-fallback-conflict',
    externalId: `offline-job:${legacy.id}` })
  assertReason(build(conflict), 'external_id_conflict')

  const partial = fixture()
  partial.snapshot.legacyJobs[0]!.canonicalJobId = 'partial-target'
  assertReason(build(partial), 'partial_migration_state')

  const target = fixture(), targetId = `job-offline-${digest(target.snapshot.legacyJobs[0]!.id).slice(0, 24)}`
  target.snapshot.jobs.push({ ...target.snapshot.jobs[0]!, id: targetId })
  assertReason(build(target), 'canonical_target_id_conflict')

  const agencyOrg = fixture()
  agencyOrg.snapshot.legacyAgencies[0]!.sourceOrgId = 'org-other'
  assertReason(build(agencyOrg), 'legacy_organization_mismatch')

  const explicit = fixture()
  explicit.legacyManifest.jobs[0] = { disposition: 'blocker', legacyJobId: 'legacy-job-1',
    reasonCodes: ['facts_incomplete'] }
  assertReason(build(explicit), 'explicit_business_blocker')

  const archived = fixture()
  archived.legacyManifest.jobs[0] = { disposition: 'archived_skip', legacyJobId: 'legacy-job-1',
    reasonCode: 'x', authorizationRef: '' }
  assertReason(build(archived), 'archive_skip_authorization_invalid')

  const canonicalNonMap = fixture()
  canonicalNonMap.snapshot.legacyJobs[0]!.canonicalJobId = 'existing-target'
  canonicalNonMap.snapshot.legacyJobs[0]!.migrationChecksum = SHA_A
  canonicalNonMap.legacyManifest.jobs[0] = { disposition: 'blocker', legacyJobId: 'legacy-job-1',
    reasonCodes: ['manual_review'] }
  assertReason(build(canonicalNonMap), 'canonical_state_requires_map_disposition')

  const inactiveOrg = fixture()
  inactiveOrg.governance.organizations[0]!.contentTrustStatus = 'suspended'
  const orgAction = inactiveOrg.governance.proposedActions.find((row) => row.targetType === 'organization_content_trust')!
  orgAction.action = 'trust_suspend'; orgAction.toStatus = 'suspended'; orgAction.reasonCode = 'trust_suspended'
  assertReason(build(inactiveOrg), 'legacy_agency_organization_trust_inactive')

  const inactiveSource = fixture(), source = inactiveSource.governance.sources[0]!
  source.approvalStatus = 'rejected'; source.trustStatus = 'revoked'
  const sourceActions = inactiveSource.governance.proposedActions.filter((row) => row.targetType === 'job_source')
  sourceActions[0]!.action = 'source_reject'; sourceActions[0]!.toStatus = 'rejected'; sourceActions[0]!.reasonCode = 'source_rejected'
  sourceActions[1]!.action = 'trust_revoke'; sourceActions[1]!.toStatus = 'revoked'; sourceActions[1]!.reasonCode = 'trust_revoked'
  const inactiveSourcePlan = build(inactiveSource)
  assertReason(inactiveSourcePlan, 'legacy_job_source_not_approved')
  assertReason(inactiveSourcePlan, 'legacy_job_source_trust_inactive')

  const nonLegacyConsumer = fixture()
  nonLegacyConsumer.legacyManifest.agencies[0] = { disposition: 'archived_skip', legacyAgencyId: 'agency-1',
    reasonCode: 'approved_archive', authorizationRef: 'authorization/agency-archive' }
  nonLegacyConsumer.legacyManifest.jobs[0] = { disposition: 'archived_skip', legacyJobId: 'legacy-job-1',
    reasonCode: 'approved_archive', authorizationRef: 'authorization/job-archive' }
  nonLegacyConsumer.governance.profiles = []; nonLegacyConsumer.governance.branches = []
  nonLegacyConsumer.governance.qualifications = []
  nonLegacyConsumer.governance.proposedActions = nonLegacyConsumer.governance.proposedActions
    .filter((row) => ['organization_content_trust', 'job_source'].includes(row.targetType))
    .map((row, index) => ({ ...row, sequence: index + 1 }))
  const consumerSource = nonLegacyConsumer.governance.sources[0]!
  consumerSource.approvalStatus = 'rejected'; consumerSource.trustStatus = 'revoked'
  const consumerActions = nonLegacyConsumer.governance.proposedActions.filter((row) => row.targetType === 'job_source')
  consumerActions[0]!.action = 'source_reject'; consumerActions[0]!.toStatus = 'rejected'
  consumerActions[0]!.reasonCode = 'source_rejected'
  consumerActions[1]!.action = 'trust_revoke'; consumerActions[1]!.toStatus = 'revoked'
  consumerActions[1]!.reasonCode = 'trust_revoked'
  nonLegacyConsumer.governance.organizations[0]!.contentTrustStatus = 'suspended'
  const consumerOrgAction = nonLegacyConsumer.governance.proposedActions
    .find((row) => row.targetType === 'organization_content_trust')!
  consumerOrgAction.action = 'trust_suspend'; consumerOrgAction.toStatus = 'suspended'
  consumerOrgAction.reasonCode = 'trust_suspended'
  const consumerPlan = build(nonLegacyConsumer)
  assertReason(consumerPlan, 'consumer_source_not_approved')
  assertReason(consumerPlan, 'consumer_source_trust_inactive')
  assertReason(consumerPlan, 'consumer_organization_trust_inactive')
}

function verifyAuditPayloadBinding(): void {
  const input = fixture()
  input.extras.auditCandidates[0]!.payloadJson = '{"action":"reject","reason":"changed"}'
  const plan = build(input)
  assertReason(plan, 'audit_baseline_drift'); assertReason(plan, 'audit_payload_digest_mismatch')
}

function verifySafeOutputAndNoWriteCli(): void {
  const canary = 'SENSITIVE_CANARY_8f8f', input = fixture()
  input.governance.preparedByRef = `operator/${canary}`
  input.governance.sources[0]!.evidenceRef = `evidence/${canary}`
  input.governance.jobLinkEvidence[0]!.linkCheckRef = `link/${canary}`
  input.governance.qualifications[0]!.licenseNumber = canary
  input.governance.branches[0]!.address = canary
  assert(!JSON.stringify({ check: 'proposed-governance', plan: build(input) }).includes(canary))
  const cli = readFileSync(join(__dirname, 'recruitment-wave2-proposed-governance-dry-run.ts'), 'utf8')
  assert(cli.includes('apply|execute|write|fix|seed|commit'))
  assert.match(cli, /databaseWrites:\s*0/u); assert.match(cli, /writeAuthorized:\s*plan\.writeAuthorized/u)
  assert.doesNotMatch(cli, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/u)
  assert.doesNotMatch(cli, /(?:writeFile|appendFile|createWriteStream|prisma\.[A-Za-z]+\.(?:create|update|delete)|\.(?:createMany|updateMany|deleteMany)\()/u)
  const planner = readFileSync(join(__dirname, '..', 'src', 'recruitment-content', 'recruitment-wave2-proposed-governance-plan.ts'), 'utf8')
  assert.doesNotMatch(planner, /snapshot\.decisions\.(?:push|splice)|decisionAsOf/u)
}

function fixture(): ProposedGovernancePlanInput {
  const snapshot = baselineSnapshot(), extras = baselineExtras(), profile = proposedProfile(), branch = proposedBranch()
  const qualifications = ['business_license', 'hr_service_license'].map((type, i) => proposedQualification(`qualification-${i + 1}`, `evidence-${i + 1}`, type))
  const payloadSha256 = digest(extras.auditCandidates[0]!.payloadJson)
  const safeAudit = { ...extras.auditCandidates[0], payloadSha256 } as Omit<(typeof extras.auditCandidates)[number], 'payloadJson'> & { payloadSha256: string; payloadJson?: string }
  delete safeAudit.payloadJson
  const governance = parseRecruitmentWave2ProposedGovernance({
    schemaVersion: 1, ruleVersion: 'recruitment-wave2-proposed-governance-v1', sourceInventoryReportSha256: SHA_A,
    sourceDatabaseSnapshotDigest: SHA_B, restoreSnapshotSha256: SHA_C, asOf: AS_OF,
    preparedAt: '2026-08-10T00:35:00.000Z', preparedByRef: 'operator/owner-001',
    expectedCoverage: coverage({ sources: ['source-1'], sourceBoundJobs: ['job-bound'], orphanJobs: ['job-orphan'], fairs: ['fair-1'], legacyAgencies: ['agency-1'], legacyJobs: ['legacy-job-1'], auditCandidates: ['audit-1'] }),
    organizations: [{ organizationId: 'org-1', baseFingerprint: fingerprint(snapshot.organizations[0]), contentTrustStatus: 'active', evidenceRef: 'evidence/org-trust' }],
    sources: [{ sourceId: 'source-1', baseFingerprint: fingerprint(snapshot.sources[0]), organizationId: 'org-1', approvalStatus: 'approved', trustStatus: 'active', syncEnabled: false, allowedContentDomains: ['jobs.example.com'], redirectPolicy: 'allowlist_only', evidenceRef: 'evidence/source-1' }],
    jobLinkEvidence: snapshot.jobs.map((job) => ({ ref: `evidence/link-${job.id}`, jobId: job.id, baseFingerprint: fingerprint(job), sourceId: 'source-1', sourceUrl: job.sourceUrl, finalUrl: job.sourceUrl, linkCheckRef: `link-check/${job.id}` })),
    orphanJobs: [{ jobId: 'job-orphan', baseFingerprint: fingerprint(snapshot.jobs[1]), disposition: 'propose', organizationId: 'org-1', sourceId: 'source-1', reasonCode: null, authorizationRef: null }],
    fairs: [{ fairId: 'fair-1', baseFingerprint: fingerprint(extras.fairs[0]), disposition: 'propose', organizationId: 'org-1', sourceId: 'source-1', sourceUrl: extras.fairs[0]!.sourceUrl, finalUrl: extras.fairs[0]!.sourceUrl, checkinUrl: extras.fairs[0]!.checkinUrl, finalCheckinUrl: extras.fairs[0]!.checkinUrl, sourceLinkCheckRef: 'link-check/fair-source', checkinLinkCheckRef: 'link-check/fair-checkin', organizerAuthorizationRef: 'evidence/fair-authorization', organizerAuthorizationSha256: SHA_A, authorizationValidFrom: '2026-08-01T00:00:00.000Z', authorizationValidUntil: '2026-08-31T00:00:00.000Z', reasonCode: null, authorizationRef: null }],
    profiles: [profile], branches: [branch], qualifications, proposedActions: proposedActions(profile, branch, qualifications),
    auditCandidates: [{ auditLogId: 'audit-1', baseFingerprint: fingerprint(safeAudit), payloadSha256, disposition: 'accepted_historical_gap', reasonCode: 'legacy_reason_unavailable', evidenceRef: 'evidence/audit-1', authorizationRef: 'authorization/audit-gap-1' }],
  })
  return {
    governance,
    inventory: { snapshotDigest: SHA_B, counts: {}, issues: { job_source_missing_or_orphan: ['job-orphan'], audit_negative_action_reason_missing_candidate: ['audit-1'] } },
    snapshot, extras, legacyManifest: legacyManifest(), context: { snapshotAsOf: AS_OF, evaluatedAt: EVALUATED_AT },
  }
}

function baselineSnapshot(): RecruitmentWave2Snapshot {
  const job = (id: string, sourceId: string | null) => ({
    id, sourceOrgId: 'org-1', sourceId, externalId: `external-${id}`, offlineBranchId: null, sourceName: 'Verified source',
    sourceUrl: `https://jobs.example.com/${id}`, title: '岗位', company: '用工企业', city: '上海市', category: 'fulltime',
    salary: null, salaryMin: null, salaryMax: null, salaryUnit: null, description: null, requirements: null,
    educationRequirement: null, experienceRequirement: null, tagsJson: '[]', skillsJson: '[]', benefitsJson: '[]',
    validThrough: null, companyProfileId: null, reviewStatus: 'pending', publishStatus: 'draft', contentHash: null,
    contentVersion: null, approvedContentHash: null, hashAlgorithmVersion: null, sourceLastSeenAt: null, reviewedBy: null,
    reviewedAt: null, rejectReason: null, archivedAt: null,
  })
  return {
    organizations: [{ id: 'org-1', type: 'licensed_hr_agency', contentTrustStatus: null, archivedAt: null }],
    sources: [{ id: 'source-1', orgId: 'org-1', name: 'Verified source', approvalStatus: null, trustStatus: null, archivedAt: null, allowedContentDomainsJson: null, redirectPolicy: null }],
    profiles: [], branches: [], qualifications: [], decisions: [],
    legacyAgencies: [{ id: 'agency-1', sourceOrgId: 'org-1', status: 'active', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-08-01T00:00:00.000Z') }],
    legacyJobs: [{ id: 'legacy-job-1', agencyId: 'agency-1', title: '岗位', jobType: 'fulltime', salaryMin: null, salaryMax: null, salaryUnit: 'month', headcount: 1, requirements: null, description: null, location: '旧地址', education: null, experience: null, externalUrl: 'https://jobs.example.com/legacy', externalId: 'legacy-external', canonicalJobId: null, migrationChecksum: null, status: 'active', createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-08-01T00:00:00.000Z') }],
    jobs: [job('job-bound', 'source-1'), job('job-orphan', null)],
  }
}

function baselineExtras(): ProposedGovernancePlanInput['extras'] {
  return {
    fairs: [{ id: 'fair-1', sourceOrgId: 'org-1', sourceId: null, externalId: 'fair-external', sourceName: 'Verified source', sourceUrl: 'https://jobs.example.com/fair', checkinUrl: 'https://jobs.example.com/fair/checkin', startAt: new Date('2026-08-11T09:00:00.000Z'), endAt: new Date('2026-08-11T17:00:00.000Z'), reviewStatus: 'pending', publishStatus: 'draft', reviewedBy: null, reviewedAt: null, rejectReason: null, syncTime: new Date('2026-08-01T00:00:00.000Z'), updatedAt: new Date('2026-08-01T00:00:00.000Z') }],
    auditCandidates: [{ id: 'audit-1', action: 'job.reject', targetType: 'job', targetId: 'job-bound', createdAt: new Date('2026-08-01T00:00:00.000Z'), payloadJson: '{"action":"reject"}' }],
    evidenceFiles: [1, 2].map((i) => ({ id: `evidence-${i}`, purpose: 'qualification_evidence', visibility: 'private', status: 'active', deletedAt: null, expiresAt: new Date('2027-01-01T00:00:00.000Z') })),
  }
}

function proposedProfile(): ProposedProfile {
  const row: ProposedProfile = { profileId: 'profile-1', mustBeAbsent: true, organizationId: 'org-1', displayName: '受限机构名称', description: '受限机构说明', serviceScope: [], reviewStatus: 'approved', publishStatus: 'published', contentVersion: 1, contentHash: '', approvedContentHash: null, hashAlgorithmVersion: 'offline-agency-profile-v1', evidenceRef: 'evidence/profile-1' }
  row.contentHash = proposedProfileHash(row); row.approvedContentHash = row.contentHash
  return row
}

function proposedBranch(): ProposedBranch {
  const row: ProposedBranch = { branchId: 'branch-1', mustBeAbsent: true, profileId: 'profile-1', branchName: '门店', provinceCode: '310000', cityCode: '310100', districtCode: '310101', address: '受限地址', lat: 31, lng: 121, geoSource: 'manual_verified', serviceHours: '09:00-18:00', serviceHoursSource: 'evidence/hours-1', publicPhone: '02100000000', website: 'https://agency.example.com', status: 'active', reviewStatus: 'approved', publishStatus: 'published', contentVersion: 1, contentHash: '', approvedContentHash: null, hashAlgorithmVersion: 'offline-agency-branch-v1', evidenceRef: 'evidence/branch-1' }
  refreshBranchHash(row); return row
}

function proposedQualification(id: string, evidenceFileId: string, qualificationType: string): ProposedQualification {
  const row: ProposedQualification = { qualificationId: id, mustBeAbsent: true, organizationId: 'org-1', qualificationType, licenseNumber: `license-${id}`, issuerName: '核验机关', jurisdiction: '310000', branchId: 'branch-1', validFrom: '2026-01-01T00:00:00.000Z', validUntil: '2027-01-01T00:00:00.000Z', status: 'valid', contentVersion: 1, contentHash: '', approvedContentHash: null, hashAlgorithmVersion: 'qualification-record-v1', evidenceFileId, verificationSource: 'evidence/manual-verified', verifiedBy: 'admin-1', verifiedAt: '2026-08-01T00:00:00.000Z', evidenceRef: `evidence/${id}` }
  refreshQualificationHash(row); return row
}

function proposedActions(profile: ProposedProfile, branch: ProposedBranch, qualifications: ProposedQualification[]) {
  const actions = [
    ['organization_content_trust', 'org-1', 'trust_activate', 'active'], ['job_source', 'source-1', 'source_approve', 'approved'],
    ['job_source', 'source-1', 'trust_activate', 'active'], ['offline_agency_profile', profile.profileId, 'approve', 'approved'],
    ['offline_agency_profile', profile.profileId, 'publish', 'published'], ['offline_agency_branch', branch.branchId, 'approve', 'approved'],
    ['offline_agency_branch', branch.branchId, 'publish', 'published'],
    ...qualifications.map((row) => ['qualification_record', row.qualificationId, 'qualification_verify', 'valid']),
  ]
  return actions.map(([targetType, targetId, action, toStatus], i) => ({ ref: `proposed/action-${i + 1}`, targetType: targetType!, targetId: targetId!, action: action!, toStatus: toStatus!, sequence: i + 1 }))
}

function legacyManifest(): RecruitmentWave2Manifest {
  return {
    schemaVersion: 1, ruleVersion: RECRUITMENT_WAVE2_RULE_VERSION, snapshotSha256: SHA_C, asOf: AS_OF,
    approvalRef: 'authorization/legacy-manifest', approvedAt: '2026-08-10T00:35:00.000Z',
    agencies: [{ disposition: 'map', legacyAgencyId: 'agency-1', organizationId: 'org-1', profileId: 'profile-1', branchId: 'branch-1' }],
    jobs: [{ disposition: 'map', legacyJobId: 'legacy-job-1', organizationId: 'org-1', jobSourceId: 'source-1', offlineBranchId: 'branch-1', employer: '真实用工企业', cityName: '上海市', cityCode: '310100', sourceUrl: 'https://jobs.example.com/legacy', finalUrl: 'https://jobs.example.com/legacy', linkCheckRef: 'link-check/legacy-job', externalId: 'legacy-external' }],
  }
}

function coverage(values: Record<string, string[]>) {
  return Object.fromEntries(Object.entries(values).map(([key, ids]) => [key, { count: ids.length, idsSha256: idsDigest(ids) }]))
}
function refreshBranchHash(row: ProposedBranch): void {
  row.contentHash = proposedBranchHash(row)
  row.approvedContentHash = row.contentHash
}
function refreshQualificationHash(row: ProposedQualification): void {
  row.contentHash = proposedQualificationHash(row)
  row.approvedContentHash = row.contentHash
}
function idsDigest(ids: string[]): string { return digest(canonicalJson([...new Set(ids)].sort())) }
function fingerprint(value: unknown): string { return digest(canonicalJson(value)) }
function clone<T>(value: T): T { return structuredClone(value) }
function build(input: ProposedGovernancePlanInput): RecruitmentWave2ProposedGovernancePlan { return buildRecruitmentWave2ProposedGovernancePlan(input) }
function assertReason(plan: RecruitmentWave2ProposedGovernancePlan, reason: string): void {
  assert(plan.blockers.some((row) => row.reasonCodes.includes(reason)), `missing blocker ${reason}`)
}

main()
