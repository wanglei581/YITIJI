import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  buildRecruitmentWave2Plan as buildPlanWithContext,
  canonicalJson,
  digest,
  RECRUITMENT_WAVE2_RULE_VERSION,
  type RecruitmentWave2Manifest,
  type RecruitmentWave2Snapshot,
} from '../src/recruitment-content/recruitment-wave2-plan'
import {
  assertRecruitmentWave2ExecutionWindow,
  resolveRecruitmentWave2Target,
} from '../src/recruitment-content/recruitment-wave2-target'

const NOW = new Date('2026-08-10T00:00:00.000Z')
const FUTURE = new Date('2026-08-10T01:00:00.000Z')
const SNAPSHOT_SHA = 'a'.repeat(64)
const API_ROOT = resolve(__dirname, '..')

function buildRecruitmentWave2Plan(snapshot: RecruitmentWave2Snapshot, manifest: RecruitmentWave2Manifest) {
  return buildPlanWithContext(snapshot, manifest, {
    snapshotAsOf: manifest.asOf,
    evaluatedAt: new Date('2026-08-10T00:40:00.000Z'),
  })
}

function verifyTargetGuard(): void {
  const production = resolveRecruitmentWave2Target({
    RECRUITMENT_WAVE2_TARGET: 'authorized-readonly',
    RECRUITMENT_WAVE2_AUTHORIZATION_REF: 'AUTH/recruitment-wave2/001',
    RECRUITMENT_WAVE2_AUTHORIZED_UNTIL: FUTURE.toISOString(),
    RECRUITMENT_WAVE2_EXPECTED_DATABASE: 'ai_job_print_prod',
    RECRUITMENT_WAVE2_PRODUCTION_READONLY_URL: 'postgresql://readonly:secret@db.example.com:5432/ai_job_print_prod',
  }, NOW)
  assert.equal(production.target, 'authorized-readonly')
  assert.equal(production.restoreNonce, null)

  const restored = resolveRecruitmentWave2Target({
    RECRUITMENT_WAVE2_TARGET: 'restored-isolated',
    RECRUITMENT_WAVE2_AUTHORIZATION_REF: 'AUTH/recruitment-wave2/restore-001',
    RECRUITMENT_WAVE2_AUTHORIZED_UNTIL: FUTURE.toISOString(),
    RECRUITMENT_WAVE2_EXPECTED_DATABASE: 'ai_job_print_recruitment_wave2_restore',
    RECRUITMENT_WAVE2_RESTORED_READONLY_URL: 'postgresql://readonly:secret@restore.example.com:5432/ai_job_print_recruitment_wave2_restore',
    RECRUITMENT_WAVE2_RESTORE_NONCE: 'restore_nonce_000001',
    RECRUITMENT_WAVE2_SNAPSHOT_SHA256: SNAPSHOT_SHA,
  }, NOW)
  assert.equal(restored.snapshotSha256, SNAPSHOT_SHA)

  assert.throws(() => resolveRecruitmentWave2Target({
    RECRUITMENT_WAVE2_TARGET: 'authorized-readonly',
    RECRUITMENT_WAVE2_AUTHORIZATION_REF: 'AUTH/recruitment-wave2/001',
    RECRUITMENT_WAVE2_AUTHORIZED_UNTIL: FUTURE.toISOString(),
    RECRUITMENT_WAVE2_EXPECTED_DATABASE: 'ai_job_print_prod',
  }, NOW), /DATABASE_URL_REQUIRED/u)
  assert.throws(() => resolveRecruitmentWave2Target({
    RECRUITMENT_WAVE2_TARGET: 'ci-fixture',
    RECRUITMENT_WAVE2_AUTHORIZATION_REF: 'AUTH/recruitment-wave2/ci-001',
    RECRUITMENT_WAVE2_AUTHORIZED_UNTIL: FUTURE.toISOString(),
    RECRUITMENT_WAVE2_EXPECTED_DATABASE: 'ai_job_print_recruitment_wave2_ci',
    RECRUITMENT_WAVE2_RESTORED_READONLY_URL: 'postgresql://readonly:secret@remote.example.com:5432/ai_job_print_recruitment_wave2_ci',
    RECRUITMENT_WAVE2_RESTORE_NONCE: 'restore_nonce_ci_0001',
    RECRUITMENT_WAVE2_SNAPSHOT_SHA256: SNAPSHOT_SHA,
  }, NOW), /CI_DATABASE_NOT_LOOPBACK/u)
  assert.throws(() => resolveRecruitmentWave2Target({
    RECRUITMENT_WAVE2_TARGET: 'authorized-readonly',
    RECRUITMENT_WAVE2_AUTHORIZATION_REF: 'AUTH/recruitment-wave2/001',
    RECRUITMENT_WAVE2_AUTHORIZED_UNTIL: '2026-08-09T23:00:00.000Z',
    RECRUITMENT_WAVE2_EXPECTED_DATABASE: 'ai_job_print_prod',
    RECRUITMENT_WAVE2_PRODUCTION_READONLY_URL: 'postgresql://readonly:secret@db.example.com:5432/ai_job_print_prod',
  }, NOW), /AUTHORIZATION_WINDOW_INVALID/u)
  assert.throws(
    () => assertRecruitmentWave2ExecutionWindow(production, FUTURE),
    /AUTHORIZATION_EXPIRED/u,
  )
  assert.throws(
    () => assertRecruitmentWave2ExecutionWindow(production, NOW, new Date('2026-08-09T23:59:00.000Z')),
    /RESTORE_MARKER_EXPIRED/u,
  )
}

function verifyHappyAndDeterministicPlan(): void {
  const snapshot = validSnapshot()
  const manifest = validManifest()
  const first = buildRecruitmentWave2Plan(snapshot, manifest)
  const second = buildRecruitmentWave2Plan(snapshot, {
    ...manifest,
    agencies: [...manifest.agencies].reverse(),
    jobs: [...manifest.jobs].reverse(),
  })
  assert.equal(first.agencies.candidate, 1)
  assert.equal(first.jobs.candidate, 1)
  assert.equal(first.agencies.total, first.agencies.candidate + first.agencies.blocker + first.agencies.archivedSkipped)
  assert.equal(first.jobs.total, first.jobs.candidate + first.jobs.blocker + first.jobs.archivedSkipped)
  assert.equal(first.manifestChecksum, second.manifestChecksum)
  assert.equal(first.planChecksum, second.planChecksum)
  assert.deepEqual(first.plannedJobState, {
    contentVersion: 1,
    hashAlgorithmVersion: 'job-content-v1',
    reviewStatus: 'pending',
    publishStatus: 'draft',
    approvedContentHash: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    sourceLastSeenAt: null,
  })
  assert.match(first.jobs.items[0]!.migrationChecksum ?? '', /^[a-f0-9]{64}$/u)
  assert.match(first.jobs.items[0]!.contentHash ?? '', /^[a-f0-9]{64}$/u)
  const serialized = JSON.stringify(first)
  for (const forbidden of ['真实用工企业', 'https://jobs.example.com/path?secret=1', '岗位正文', '岗位要求']) {
    assert(!serialized.includes(forbidden), `plan output leaked ${forbidden}`)
  }
}

function verifyFailClosedClassification(): void {
  const snapshot = validSnapshot()
  const missing = buildRecruitmentWave2Plan(snapshot, { ...validManifest(), agencies: [], jobs: [] })
  assert.equal(missing.agencies.blocker, 1)
  assert.equal(missing.jobs.blocker, 1)
  assert(missing.agencies.items[0]?.reasonCodes.includes('manifest_entry_missing'))

  const invalid = validManifest()
  invalid.jobs[0] = {
    ...invalid.jobs[0] as Extract<(typeof invalid.jobs)[number], { disposition: 'map' }>,
    employer: '',
    cityCode: '上海',
    sourceUrl: 'http://127.0.0.1/private',
    finalUrl: 'https://evil.example.net/redirect',
    linkCheckRef: '',
  }
  const invalidPlan = buildRecruitmentWave2Plan(snapshot, invalid)
  const reasons = invalidPlan.jobs.items[0]?.reasonCodes ?? []
  for (const reason of [
    'employer_missing', 'structured_city_invalid', 'branch_city_mismatch', 'source_url_invalid',
    'final_url_domain_blocked', 'link_check_ref_missing',
  ]) assert(reasons.includes(reason), `missing fail-closed reason ${reason}`)

  const inactiveWithoutApproval = validSnapshot()
  inactiveWithoutApproval.legacyJobs[0]!.status = 'inactive'
  const noManifest = buildRecruitmentWave2Plan(inactiveWithoutApproval, { ...validManifest(), jobs: [] })
  assert.equal(noManifest.jobs.items[0]?.result, 'blocker', 'inactive must not auto archive-skip')

  const archive = validManifest()
  archive.jobs[0] = {
    disposition: 'archived_skip', legacyJobId: 'legacy-job-1',
    reasonCode: 'manual_archive_approved', authorizationRef: 'AUTH/archive/001',
  }
  const archivePlan = buildRecruitmentWave2Plan(snapshot, archive)
  assert.equal(archivePlan.jobs.archivedSkipped, 1)

  const partialArchiveSnapshot = validSnapshot()
  partialArchiveSnapshot.legacyJobs[0]!.canonicalJobId = 'partial-target'
  assert(buildRecruitmentWave2Plan(partialArchiveSnapshot, archive).jobs.items[0]
    ?.reasonCodes.includes('partial_migration_state'))

  const redirectMismatch = validSnapshot()
  redirectMismatch.sources[0]!.redirectPolicy = 'same_host_only'
  redirectMismatch.sources[0]!.allowedContentDomainsJson = '["jobs.example.com","apply.example.com"]'
  const redirectManifest = validManifest()
  const redirectEntry = redirectManifest.jobs[0] as Extract<(typeof redirectManifest.jobs)[number], { disposition: 'map' }>
  redirectEntry.finalUrl = 'https://apply.example.com/final'
  assert(buildRecruitmentWave2Plan(redirectMismatch, redirectManifest).jobs.items[0]
    ?.reasonCodes.includes('redirect_host_mismatch'))

  const blankSourceName = validSnapshot()
  blankSourceName.sources[0]!.name = '  '
  assert(buildRecruitmentWave2Plan(blankSourceName, validManifest()).jobs.items[0]
    ?.reasonCodes.includes('source_name_missing'))

  const suspendedSource = validSnapshot()
  suspendedSource.decisions.push({
    id: 'decision-source-suspend', targetType: 'job_source', targetId: 'source-1', contentVersion: null,
    contentHash: null, hashAlgorithmVersion: null, action: 'trust_suspend', toStatus: 'suspended',
    actorRole: 'admin', occurredAt: new Date('2026-08-10T00:25:00.000Z'),
    correlationId: 'correlation-source-suspend', requestId: 'request-source-suspend',
  })
  assert(buildRecruitmentWave2Plan(suspendedSource, validManifest()).jobs.items[0]
    ?.reasonCodes.includes('source_trust_decision_missing'))

  const laterUnboundReject = validSnapshot()
  laterUnboundReject.decisions.push({
    id: 'decision-profile-reject-later', targetType: 'offline_agency_profile', targetId: 'profile-1',
    contentVersion: null, contentHash: null, hashAlgorithmVersion: null, action: 'reject', toStatus: 'rejected',
    actorRole: 'admin', occurredAt: new Date('2026-08-10T00:25:00.000Z'),
    correlationId: 'correlation-profile-reject-later', requestId: 'request-profile-reject-later',
  })
  assert(buildRecruitmentWave2Plan(laterUnboundReject, validManifest()).agencies.items[0]
    ?.reasonCodes.includes('profile_approve_decision_missing'))

  const expiredQualification = validSnapshot()
  expiredQualification.qualifications[0]!.validUntil = new Date('2026-08-10T00:35:00.000Z')
  assert(buildRecruitmentWave2Plan(expiredQualification, validManifest()).agencies.items[0]
    ?.reasonCodes.includes('qualification_business_license_invalid'))
}

function verifyCollisionAndPartialState(): void {
  const storedContent = {
    sourceName: 'Existing source', sourceUrl: 'https://jobs.example.com/existing', title: 'Existing job',
    company: 'Existing employer', city: 'Shanghai', category: 'fulltime', salary: null,
    salaryMin: null, salaryMax: null, salaryUnit: null, description: null, requirements: null,
    educationRequirement: null, experienceRequirement: null, tagsJson: '[]', skillsJson: '[]',
    benefitsJson: '[]', validThrough: null, companyProfileId: null, archivedAt: null,
  }
  const snapshot = validSnapshot()
  snapshot.jobs.push({
    ...storedContent,
    id: 'existing-fallback', sourceOrgId: 'org-1', sourceId: 'source-1',
    externalId: 'offline-job:legacy-job-1', offlineBranchId: null,
    reviewStatus: 'pending', publishStatus: 'draft', contentHash: null, contentVersion: null,
    approvedContentHash: null, hashAlgorithmVersion: null, sourceLastSeenAt: null,
    reviewedBy: null, reviewedAt: null, rejectReason: null,
  })
  snapshot.jobs.push({
    ...storedContent,
    id: 'existing-preferred', sourceOrgId: 'org-1', sourceId: 'source-1',
    externalId: 'legacy-ext-1', offlineBranchId: null,
    reviewStatus: 'pending', publishStatus: 'draft', contentHash: null, contentVersion: null,
    approvedContentHash: null, hashAlgorithmVersion: null, sourceLastSeenAt: null,
    reviewedBy: null, reviewedAt: null, rejectReason: null,
  })
  const collision = buildRecruitmentWave2Plan(snapshot, validManifest())
  assert(collision.jobs.items[0]?.reasonCodes.includes('external_id_conflict'))

  const targetIdCollision = validSnapshot()
  targetIdCollision.jobs.push({
    ...storedContent,
    id: `job-offline-${digest('legacy-job-1').slice(0, 24)}`,
    sourceOrgId: 'other-org', sourceId: 'other-source', externalId: 'other-external-id',
    offlineBranchId: null, reviewStatus: 'pending', publishStatus: 'draft', contentHash: null,
    contentVersion: null, approvedContentHash: null, hashAlgorithmVersion: null, sourceLastSeenAt: null,
    reviewedBy: null, reviewedAt: null, rejectReason: null,
  })
  assert(buildRecruitmentWave2Plan(targetIdCollision, validManifest()).jobs.items[0]
    ?.reasonCodes.includes('canonical_target_id_conflict'))

  const partialSnapshot = validSnapshot()
  partialSnapshot.legacyJobs[0]!.migrationChecksum = 'b'.repeat(64)
  const partial = buildRecruitmentWave2Plan(partialSnapshot, validManifest())
  assert(partial.jobs.items[0]?.reasonCodes.includes('partial_migration_state'))

  const dependencyDrift = validSnapshot()
  const baselineChecksum = buildRecruitmentWave2Plan(dependencyDrift, validManifest()).jobs.items[0]?.migrationChecksum
  dependencyDrift.sources[0]!.redirectPolicy = 'same_host_only'
  assert.notEqual(
    buildRecruitmentWave2Plan(dependencyDrift, validManifest()).jobs.items[0]?.migrationChecksum,
    baselineChecksum,
  )

  const orphan = validManifest()
  orphan.jobs.push({ disposition: 'blocker', legacyJobId: 'missing-legacy-job', reasonCodes: ['manual_review'] })
  assert.throws(() => buildRecruitmentWave2Plan(validSnapshot(), orphan), /MANIFEST_ORPHAN_JOB/u)

  const sameIdNamespace = validSnapshot()
  sameIdNamespace.sources[0]!.id = 'org-1'
  sameIdNamespace.decisions.filter((row) => row.targetType === 'job_source')
    .forEach((row) => { row.targetId = 'org-1' })
  const sameIdManifest = validManifest()
  const sameIdEntry = sameIdManifest.jobs[0] as Extract<(typeof sameIdManifest.jobs)[number], { disposition: 'map' }>
  sameIdEntry.jobSourceId = 'org-1'
  assert.equal(buildRecruitmentWave2Plan(sameIdNamespace, sameIdManifest).jobs.candidate, 1)
}

function verifyCliRejectsWritesBeforeDatabaseAccess(): void {
  for (const arg of ['--apply', '--execute', '--write', '--fix']) {
    const result = spawnSync(process.execPath, ['-r', '@swc-node/register',
      'scripts/recruitment-wave2-restored-dry-run.ts', arg], {
      cwd: API_ROOT,
      env: {},
      encoding: 'utf8',
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /RECRUITMENT_WAVE2_WRITE_ARGUMENT_FORBIDDEN/u)
    assert(!result.stderr.includes('postgresql://'), 'error output must not expose a connection string')
  }
}

function verifyExistingShadowReconciliation(): void {
  const snapshot = validSnapshot()
  const manifest = validManifest()
  const planned = buildRecruitmentWave2Plan(snapshot, manifest).jobs.items[0]!
  assert.equal(planned.result, 'candidate')
  snapshot.legacyJobs[0]!.canonicalJobId = planned.targetId!
  snapshot.legacyJobs[0]!.migrationChecksum = planned.migrationChecksum!
  snapshot.legacyJobs[0]!.updatedAt = new Date('2026-08-10T00:31:00.000Z')
  snapshot.jobs.push({
    id: planned.targetId!, sourceOrgId: 'org-1', sourceId: 'source-1', externalId: 'legacy-ext-1',
    sourceName: 'Verified source', sourceUrl: 'https://jobs.example.com/path?secret=1', title: '测试岗位',
    company: '真实用工企业', city: '上海市', category: 'fulltime', salary: null, salaryMin: 100,
    salaryMax: 200, salaryUnit: 'day', description: '岗位正文', requirements: '岗位要求',
    educationRequirement: null, experienceRequirement: null, tagsJson: '[]', skillsJson: '[]',
    benefitsJson: '[]', validThrough: null, companyProfileId: null, offlineBranchId: 'branch-1',
    reviewStatus: 'pending', publishStatus: 'draft', contentHash: planned.contentHash!, contentVersion: 1,
    approvedContentHash: null, hashAlgorithmVersion: 'job-content-v1', sourceLastSeenAt: null,
    reviewedBy: null, reviewedAt: null, rejectReason: null, archivedAt: null,
  })
  assert.equal(buildRecruitmentWave2Plan(snapshot, manifest).jobs.candidate, 1)
  snapshot.jobs[0]!.title = 'tampered without hash update'
  assert(buildRecruitmentWave2Plan(snapshot, manifest).jobs.items[0]
    ?.reasonCodes.includes('canonical_target_content_drift'))
}

function validSnapshot(): RecruitmentWave2Snapshot {
  const versioned = {
    contentVersion: 1, reviewStatus: 'approved', publishStatus: 'published', contentHash: 'hash-1',
    approvedContentHash: 'hash-1', hashAlgorithmVersion: 'content-v1', archivedAt: null,
    reviewedBy: 'admin-1', reviewedAt: new Date('2026-08-01T00:00:00.000Z'), rejectReason: null,
  }
  const evidenceFile = {
    id: 'evidence-1', purpose: 'qualification_evidence', visibility: 'private', status: 'active',
    deletedAt: null, expiresAt: new Date('2027-01-01T00:00:00.000Z'),
  }
  const qualification = (id: string, type: string) => ({
    id, organizationId: 'org-1', qualificationType: type, appliesToBranchId: 'branch-1', status: 'valid', contentVersion: 1,
    validFrom: new Date('2026-01-01T00:00:00.000Z'), validUntil: new Date('2027-01-01T00:00:00.000Z'),
    contentHash: `hash-${id}`, approvedContentHash: `hash-${id}`, hashAlgorithmVersion: 'content-v1',
    issuerName: '核验机关', jurisdiction: '310000', verificationSource: 'manual_verified',
    verifiedBy: 'admin-1', verifiedAt: new Date('2026-08-01T00:00:00.000Z'), archivedAt: null, evidenceFile,
  })
  const decision = (
    id: string, targetType: string, targetId: string, action: string, toStatus: string,
    contentVersion: number | null = null, contentHash: string | null = null,
    hashAlgorithmVersion: string | null = null,
  ) => ({
    id, targetType, targetId, contentVersion, contentHash, hashAlgorithmVersion, action, toStatus,
    actorRole: 'admin', occurredAt: new Date('2026-08-10T00:20:00.000Z'),
    correlationId: `correlation-${id}`, requestId: `request-${id}`,
  })
  return {
    organizations: [{ id: 'org-1', type: 'licensed_hr_agency', contentTrustStatus: 'active', archivedAt: null }],
    sources: [{
      id: 'source-1', orgId: 'org-1', name: 'Verified source', approvalStatus: 'approved', trustStatus: 'active', archivedAt: null,
      allowedContentDomainsJson: '["jobs.example.com"]', redirectPolicy: 'allowlist_only',
    }],
    profiles: [{ id: 'profile-1', organizationId: 'org-1', serviceScopeJson: '[]', ...versioned }],
    branches: [{ id: 'branch-1', agencyProfileId: 'profile-1', status: 'active', cityCode: '310100', ...versioned }],
    qualifications: [
      qualification('qualification-business', 'business_license'),
      qualification('qualification-hr', 'hr_service_license'),
    ],
    decisions: [
      decision('decision-org-trust', 'organization_content_trust', 'org-1', 'trust_activate', 'active'),
      decision('decision-source-approve', 'job_source', 'source-1', 'source_approve', 'approved'),
      decision('decision-source-trust', 'job_source', 'source-1', 'trust_activate', 'active'),
      decision('decision-profile-approve', 'offline_agency_profile', 'profile-1', 'approve', 'approved', 1, 'hash-1', 'content-v1'),
      decision('decision-profile-publish', 'offline_agency_profile', 'profile-1', 'publish', 'published', 1, 'hash-1', 'content-v1'),
      decision('decision-branch-approve', 'offline_agency_branch', 'branch-1', 'approve', 'approved', 1, 'hash-1', 'content-v1'),
      decision('decision-branch-publish', 'offline_agency_branch', 'branch-1', 'publish', 'published', 1, 'hash-1', 'content-v1'),
      decision('decision-qualification-business', 'qualification_record', 'qualification-business',
        'qualification_verify', 'valid', 1, 'hash-qualification-business', 'content-v1'),
      decision('decision-qualification-hr', 'qualification_record', 'qualification-hr',
        'qualification_verify', 'valid', 1, 'hash-qualification-hr', 'content-v1'),
    ],
    legacyAgencies: [{
      id: 'agency-1', sourceOrgId: 'org-1', status: 'active',
      createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    }],
    legacyJobs: [{
      id: 'legacy-job-1', agencyId: 'agency-1', title: '测试岗位', jobType: 'fulltime', salaryMin: 100,
      salaryMax: 200, salaryUnit: 'day', headcount: 1, requirements: '岗位要求', description: '岗位正文', location: '旧地址',
      education: null, experience: null, externalUrl: 'https://legacy.example.com', externalId: 'legacy-ext-1',
      canonicalJobId: null, migrationChecksum: null, status: 'active',
      createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    }],
    jobs: [],
  }
}

function validManifest(): RecruitmentWave2Manifest {
  return {
    schemaVersion: 1,
    ruleVersion: RECRUITMENT_WAVE2_RULE_VERSION,
    snapshotSha256: SNAPSHOT_SHA,
    asOf: '2026-08-10T00:30:00.000Z',
    approvalRef: 'AUTH/recruitment-wave2/manifest-001',
    approvedAt: '2026-08-10T00:30:00.000Z',
    agencies: [{
      disposition: 'map', legacyAgencyId: 'agency-1', organizationId: 'org-1',
      profileId: 'profile-1', branchId: 'branch-1',
    }],
    jobs: [{
      disposition: 'map', legacyJobId: 'legacy-job-1', organizationId: 'org-1', jobSourceId: 'source-1',
      offlineBranchId: 'branch-1', employer: '真实用工企业', cityName: '上海市', cityCode: '310100',
      sourceUrl: 'https://jobs.example.com/path?secret=1', finalUrl: 'https://jobs.example.com/final',
      linkCheckRef: 'LINK-CHECK-001',
    }],
  }
}

function verifyCanonicalHashContract(): void {
  assert.equal(canonicalJson({ b: 'e\u0301', a: undefined }), '{"a":{"$undefined":true},"b":"é"}')
  assert.equal(digest('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.throws(() => canonicalJson(Number.NaN), /NON_FINITE_NUMBER/u)
  const manifest = validManifest()
  assert.throws(() => buildPlanWithContext(validSnapshot(), manifest, {
    snapshotAsOf: manifest.asOf,
    evaluatedAt: new Date('2026-08-12T00:40:00.000Z'),
  }), /MANIFEST_TIME_CONTEXT_INVALID/u)
}

verifyTargetGuard()
verifyHappyAndDeterministicPlan()
verifyFailClosedClassification()
verifyCollisionAndPartialState()
verifyExistingShadowReconciliation()
verifyCanonicalHashContract()
verifyCliRejectsWritesBeforeDatabaseAccess()
console.log('Recruitment Wave 2 read-only planner contract: PASS')
