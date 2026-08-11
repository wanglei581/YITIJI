import {
  contentBlockers,
  parseDomainPolicy,
  parseStringArrayPolicy,
  requiredQualificationTypes,
  validateLandingUrl,
} from './recruitment-content-readiness'
import {
  canonicalJson,
  digest,
  assertRecruitmentWave2Manifest as assertManifest,
  hasRecruitmentContentDecision as hasContentDecision,
  hasRecruitmentDecision as hasDecision,
  RECRUITMENT_WAVE2_RULE_VERSION,
  recruitmentExistingJobContent as existingJobContent,
  type AgencyManifestEntry,
  type JobManifestEntry,
  type RecruitmentWave2Manifest,
  type RecruitmentWave2Plan,
  type RecruitmentWave2PlanContext,
  type RecruitmentWave2PlanItem,
  type RecruitmentWave2Snapshot,
} from './recruitment-wave2-target'
import {
  evaluateRecruitmentWave2LegacyJobFacts,
  preferredRecruitmentWave2ExternalIdCounts,
  resolveRecruitmentWave2ExternalId,
} from './recruitment-wave2-proposed-governance-rules'

export type {
  AgencyManifestEntry,
  JobManifestEntry,
  RecruitmentWave2Manifest,
  RecruitmentWave2Plan,
  RecruitmentWave2PlanContext,
  RecruitmentWave2PlanItem,
  RecruitmentWave2Snapshot,
} from './recruitment-wave2-target'
export { canonicalJson, digest, RECRUITMENT_WAVE2_RULE_VERSION } from './recruitment-wave2-target'

export function buildRecruitmentWave2Plan(
  snapshot: RecruitmentWave2Snapshot,
  manifest: RecruitmentWave2Manifest,
  context: RecruitmentWave2PlanContext,
): RecruitmentWave2Plan {
  assertManifest(manifest, context)
  const decisionAsOf = new Date(context.snapshotAsOf)
  const validityAt = context.evaluatedAt
  const agencyEntries = uniqueById(manifest.agencies, 'legacyAgencyId')
  const jobEntries = uniqueById(manifest.jobs, 'legacyJobId')
  assertNoOrphanEntries(snapshot, agencyEntries, jobEntries)
  const agencyItems = [...snapshot.legacyAgencies]
    .sort(byId)
    .map((legacy) => planAgency(snapshot, legacy, agencyEntries.get(legacy.id), decisionAsOf, validityAt))
  const agencyPlans = new Map(agencyItems.map((item) => [item.legacyId, item]))
  const plannedExternalIdCounts = preferredRecruitmentWave2ExternalIdCounts(snapshot, manifest)
  const jobItems = [...snapshot.legacyJobs]
    .sort(byId)
    .map((legacy) => planJob(
      snapshot, legacy, jobEntries.get(legacy.id), agencyEntries, agencyPlans, plannedExternalIdCounts, decisionAsOf,
    ))
  const agencies = summarize(agencyItems)
  const jobs = summarize(jobItems)
  const manifestChecksum = digest(canonicalJson({
    ...manifest,
    agencies: [...manifest.agencies].sort((a, b) => a.legacyAgencyId.localeCompare(b.legacyAgencyId)),
    jobs: [...manifest.jobs].sort((a, b) => a.legacyJobId.localeCompare(b.legacyJobId)),
  }))
  const stablePlan = {
    ruleVersion: RECRUITMENT_WAVE2_RULE_VERSION as typeof RECRUITMENT_WAVE2_RULE_VERSION,
    snapshotSha256: manifest.snapshotSha256,
    manifestChecksum,
    plannedJobState: {
      contentVersion: 1 as const,
      hashAlgorithmVersion: 'job-content-v1' as const,
      reviewStatus: 'pending' as const,
      publishStatus: 'draft' as const,
      approvedContentHash: null,
      reviewedBy: null,
      reviewedAt: null,
      rejectReason: null,
      sourceLastSeenAt: null,
    },
    agencies: agencyItems,
    jobs: jobItems,
  }
  return { ...stablePlan, planChecksum: digest(canonicalJson(stablePlan)), agencies, jobs }
}

function planAgency(
  snapshot: RecruitmentWave2Snapshot,
  legacy: RecruitmentWave2Snapshot['legacyAgencies'][number],
  entry: AgencyManifestEntry | undefined,
  decisionAsOf: Date,
  validityAt: Date,
): RecruitmentWave2PlanItem {
  if (!entry) return blocked(legacy.id, 'manifest_entry_missing')
  if (entry.disposition === 'blocker') return blocked(legacy.id, ...normalizeReasons(entry.reasonCodes))
  if (entry.disposition === 'archived_skip') return archiveSkip(legacy.id, entry.reasonCode, entry.authorizationRef)

  const reasons: string[] = []
  const organization = snapshot.organizations.find((row) => row.id === entry.organizationId)
  const profile = snapshot.profiles.find((row) => row.id === entry.profileId)
  const branch = snapshot.branches.find((row) => row.id === entry.branchId)
  if (!organization) reasons.push('organization_missing')
  if (!profile) reasons.push('profile_missing')
  if (!branch) reasons.push('branch_missing')
  if (legacy.sourceOrgId !== entry.organizationId) reasons.push('legacy_organization_mismatch')
  if (profile && profile.organizationId !== entry.organizationId) reasons.push('profile_organization_mismatch')
  if (branch && branch.agencyProfileId !== entry.profileId) reasons.push('branch_profile_mismatch')
  if (organization?.archivedAt) reasons.push('organization_archived')
  if (organization?.contentTrustStatus !== 'active') reasons.push('organization_trust_inactive')
  if (organization && !hasDecision(snapshot, {
    targetType: 'organization_content_trust', targetId: organization.id,
    action: 'trust_activate', actions: ['trust_activate', 'trust_suspend', 'trust_revoke'],
    toStatus: 'active', asOf: decisionAsOf,
  })) reasons.push('organization_trust_decision_missing')
  if (profile) {
    reasons.push(...contentBlockers(profile).map((code) => `profile_${code}`))
    if (!hasContentDecision(snapshot, 'offline_agency_profile', profile,
      ['approve', 'reject'], 'approve', 'approved', decisionAsOf)) {
      reasons.push('profile_approve_decision_missing')
    }
    if (!hasContentDecision(snapshot, 'offline_agency_profile', profile,
      ['publish', 'unpublish', 'archive'], 'publish', 'published', decisionAsOf)) {
      reasons.push('profile_publish_decision_missing')
    }
  }
  if (branch) {
    reasons.push(...contentBlockers(branch).map((code) => `branch_${code}`))
    if (!branch.cityCode?.trim()) reasons.push('branch_structured_city_missing')
    if (!hasContentDecision(snapshot, 'offline_agency_branch', branch,
      ['approve', 'reject'], 'approve', 'approved', decisionAsOf)) {
      reasons.push('branch_approve_decision_missing')
    }
    if (!hasContentDecision(snapshot, 'offline_agency_branch', branch,
      ['publish', 'unpublish', 'archive'], 'publish', 'published', decisionAsOf)) {
      reasons.push('branch_publish_decision_missing')
    }
  }
  if (organization && profile && branch) {
    reasons.push(...qualificationBlockers(snapshot, organization, profile, branch, validityAt, decisionAsOf))
  }
  return reasons.length ? blocked(legacy.id, ...reasons) : candidate(legacy.id, entry.branchId)
}

function planJob(
  snapshot: RecruitmentWave2Snapshot,
  legacy: RecruitmentWave2Snapshot['legacyJobs'][number],
  entry: JobManifestEntry | undefined,
  agencyEntries: Map<string, AgencyManifestEntry>,
  agencyPlans: Map<string, RecruitmentWave2PlanItem>,
  plannedExternalIdCounts: Map<string, number>,
  decisionAsOf: Date,
): RecruitmentWave2PlanItem {
  if (!entry) return blocked(legacy.id, 'manifest_entry_missing')
  if (Boolean(legacy.canonicalJobId) !== Boolean(legacy.migrationChecksum)) {
    return blocked(legacy.id, 'partial_migration_state')
  }
  if (entry.disposition !== 'map' && legacy.canonicalJobId) {
    return blocked(legacy.id, 'canonical_state_requires_map_disposition')
  }
  if (entry.disposition === 'blocker') return blocked(legacy.id, ...normalizeReasons(entry.reasonCodes))
  if (entry.disposition === 'archived_skip') return archiveSkip(legacy.id, entry.reasonCode, entry.authorizationRef)

  const reasons: string[] = []
  const organization = snapshot.organizations.find((row) => row.id === entry.organizationId)
  const source = snapshot.sources.find((row) => row.id === entry.jobSourceId)
  const branch = snapshot.branches.find((row) => row.id === entry.offlineBranchId)
  const agencyEntry = agencyEntries.get(legacy.agencyId)
  const agencyPlan = agencyPlans.get(legacy.agencyId)
  if (agencyPlan?.result !== 'candidate') reasons.push('agency_mapping_not_candidate')
  if (!agencyEntry || agencyEntry.disposition !== 'map') reasons.push('agency_mapping_missing')
  else if (agencyEntry.organizationId !== entry.organizationId || agencyEntry.branchId !== entry.offlineBranchId) {
    reasons.push('agency_job_mapping_mismatch')
  }
  if (!organization) reasons.push('organization_missing')
  if (!source) reasons.push('job_source_missing')
  if (!branch) reasons.push('branch_missing')
  if (source && source.orgId !== entry.organizationId) reasons.push('source_organization_mismatch')
  if (source?.approvalStatus !== 'approved') reasons.push('source_not_approved')
  if (source?.trustStatus !== 'active') reasons.push('source_trust_inactive')
  if (source?.archivedAt) reasons.push('source_archived')
  if (!source?.name.trim()) reasons.push('source_name_missing')
  if (source && source.redirectPolicy !== 'allowlist_only' && source.redirectPolicy !== 'same_host_only') {
    reasons.push('source_redirect_policy_invalid')
  }
  if (source && !hasDecision(snapshot, {
    targetType: 'job_source', targetId: source.id, action: 'source_approve',
    actions: ['source_approve', 'source_reject', 'source_revoke'], toStatus: 'approved', asOf: decisionAsOf,
  })) reasons.push('source_approval_decision_missing')
  if (source && !hasDecision(snapshot, {
    targetType: 'job_source', targetId: source.id, action: 'trust_activate',
    actions: ['trust_activate', 'trust_suspend', 'trust_revoke'], toStatus: 'active', asOf: decisionAsOf,
  })) reasons.push('source_trust_decision_missing')
  const legacyFacts = evaluateRecruitmentWave2LegacyJobFacts(legacy, entry, branch?.cityCode)
  const category = legacyFacts.category
  reasons.push(...legacyFacts.reasons)
  const domains = source?.allowedContentDomainsJson
    ? parseDomainPolicy(source.allowedContentDomainsJson)
    : { valid: false, domains: [] }
  if (!domains.valid) reasons.push('source_domain_policy_invalid')
  const initial = validateLandingUrl(entry.sourceUrl, domains.domains)
  const final = validateLandingUrl(entry.finalUrl, domains.domains)
  if (!initial.validUrl) reasons.push('source_url_invalid')
  else if (!initial.allowedDomain) reasons.push('source_url_domain_blocked')
  if (!final.validUrl) reasons.push('final_url_invalid')
  else if (!final.allowedDomain) reasons.push('final_url_domain_blocked')
  if (source?.redirectPolicy === 'same_host_only' && initial.validUrl && final.validUrl
    && new URL(entry.sourceUrl).hostname.toLowerCase() !== new URL(entry.finalUrl).hostname.toLowerCase()) {
    reasons.push('redirect_host_mismatch')
  }
  if (reasons.length) return blocked(legacy.id, ...reasons)

  const preferredExternalId = entry.externalId?.trim() || legacy.externalId?.trim() || `offline-job:${legacy.id}`
  const externalId = resolveRecruitmentWave2ExternalId(snapshot, legacy, entry, preferredExternalId, plannedExternalIdCounts)
  if (!externalId) return blocked(legacy.id, 'external_id_conflict')
  const targetId = legacy.canonicalJobId ?? `job-offline-${digest(legacy.id).slice(0, 24)}`
  if (!legacy.canonicalJobId && snapshot.jobs.some((job) => job.id === targetId)) {
    return blocked(legacy.id, 'canonical_target_id_conflict')
  }
  const plannedContent = {
    sourceOrgId: entry.organizationId,
    sourceId: entry.jobSourceId,
    externalId,
    sourceName: source!.name.trim(),
    sourceUrl: entry.sourceUrl,
    title: legacy.title,
    company: entry.employer.trim(),
    city: entry.cityName.trim(),
    category,
    salary: null,
    salaryMin: legacy.salaryMin,
    salaryMax: legacy.salaryMax,
    salaryUnit: legacy.salaryUnit,
    description: legacy.description,
    requirements: legacy.requirements,
    educationRequirement: legacy.education,
    experienceRequirement: legacy.experience,
    tagsJson: '[]',
    skillsJson: '[]',
    benefitsJson: '[]',
    validThrough: null,
    companyProfileId: null,
    offlineBranchId: entry.offlineBranchId,
  }
  const contentHash = digest(canonicalJson(plannedContent))
  const profile = agencyEntry?.disposition === 'map'
    ? snapshot.profiles.find((row) => row.id === agencyEntry.profileId)
    : undefined
  const qualifications = snapshot.qualifications
    .filter((row) => row.organizationId === entry.organizationId
      && (!row.appliesToBranchId || row.appliesToBranchId === entry.offlineBranchId))
    .sort(byId)
    .map((row) => ({
      id: row.id,
      qualificationType: row.qualificationType,
      appliesToBranchId: row.appliesToBranchId,
      status: row.status,
      contentVersion: row.contentVersion,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
      contentHash: row.contentHash,
      approvedContentHash: row.approvedContentHash,
      hashAlgorithmVersion: row.hashAlgorithmVersion,
      issuerName: row.issuerName,
      jurisdiction: row.jurisdiction,
      verificationSource: row.verificationSource,
      verifiedBy: row.verifiedBy,
      verifiedAt: row.verifiedAt,
      archivedAt: row.archivedAt,
      evidenceFile: row.evidenceFile,
    }))
  const dependencyTargetIds = new Set([
    entry.organizationId,
    entry.jobSourceId,
    profile?.id ?? '',
    entry.offlineBranchId,
    ...qualifications.map((row) => row.id),
  ])
  const decisions = snapshot.decisions
    .filter((row) => dependencyTargetIds.has(row.targetId))
    .sort((a, b) => a.id.localeCompare(b.id))
  const legacySource = {
    ...legacy,
    canonicalJobId: undefined,
    migrationChecksum: undefined,
    // The future writer will update the two migration-link fields through Prisma,
    // which also advances @updatedAt. Business source fields are fingerprinted above.
    updatedAt: undefined,
  }
  const migrationChecksum = digest(canonicalJson({
    ruleVersion: RECRUITMENT_WAVE2_RULE_VERSION,
    targetId,
    legacy: legacySource,
    entry,
    externalId,
    dependencies: {
      organization,
      source,
      profile: profile ? {
        id: profile.id,
        organizationId: profile.organizationId,
        serviceScopeJson: profile.serviceScopeJson,
        contentVersion: profile.contentVersion,
        reviewStatus: profile.reviewStatus,
        publishStatus: profile.publishStatus,
        contentHash: profile.contentHash,
        approvedContentHash: profile.approvedContentHash,
        hashAlgorithmVersion: profile.hashAlgorithmVersion,
        reviewedBy: profile.reviewedBy,
        reviewedAt: profile.reviewedAt,
        rejectReason: profile.rejectReason,
        archivedAt: profile.archivedAt,
      } : null,
      branch,
      qualifications,
      decisions,
    },
  }))
  if (legacy.canonicalJobId) {
    const existing = snapshot.jobs.find((job) => job.id === legacy.canonicalJobId)
    if (!existing) return blocked(legacy.id, 'canonical_target_missing')
    if (legacy.migrationChecksum !== migrationChecksum) return blocked(legacy.id, 'migration_checksum_drift')
    if (existing.sourceOrgId !== entry.organizationId || existing.sourceId !== entry.jobSourceId
      || existing.offlineBranchId !== entry.offlineBranchId || existing.externalId !== externalId
      || existing.contentHash !== contentHash || existing.contentVersion !== 1
      || existing.hashAlgorithmVersion !== 'job-content-v1') return blocked(legacy.id, 'canonical_target_mismatch')
    if (digest(canonicalJson(existingJobContent(existing))) !== contentHash) {
      return blocked(legacy.id, 'canonical_target_content_drift')
    }
    if (existing.reviewStatus !== 'pending' || existing.publishStatus !== 'draft' || existing.approvedContentHash
      || existing.reviewedBy || existing.reviewedAt || existing.rejectReason || existing.sourceLastSeenAt
      || existing.archivedAt) {
      return blocked(legacy.id, 'canonical_target_visibility_unsafe')
    }
  }
  return candidate(legacy.id, targetId, migrationChecksum, contentHash)
}

function qualificationBlockers(
  snapshot: RecruitmentWave2Snapshot,
  organization: RecruitmentWave2Snapshot['organizations'][number],
  profile: RecruitmentWave2Snapshot['profiles'][number],
  branch: RecruitmentWave2Snapshot['branches'][number],
  validityAt: Date,
  decisionAsOf: Date,
): string[] {
  const serviceScope = parseStringArrayPolicy(profile.serviceScopeJson)
  if (!serviceScope.valid) return ['profile_service_scope_invalid']
  const required = requiredQualificationTypes(organization.type, serviceScope.values)
  if (!required) return ['organization_type_not_offline_agency']
  return required.flatMap((type) => {
    const valid = snapshot.qualifications.some((row) => row.organizationId === organization.id
      && row.qualificationType === type
      && (!row.appliesToBranchId || row.appliesToBranchId === branch.id)
      && qualificationValid(snapshot, row, validityAt, decisionAsOf))
    return valid ? [] : [`qualification_${type}_invalid`]
  })
}

function qualificationValid(
  snapshot: RecruitmentWave2Snapshot,
  row: RecruitmentWave2Snapshot['qualifications'][number],
  validityAt: Date,
  decisionAsOf: Date,
): boolean {
  const file = row.evidenceFile
  return row.status === 'valid' && !row.archivedAt && Boolean(row.contentHash)
    && row.contentHash === row.approvedContentHash && Boolean(row.hashAlgorithmVersion)
    && Boolean(row.issuerName.trim() && row.jurisdiction.trim() && row.verificationSource.trim())
    && Boolean(row.verifiedBy && row.verifiedAt)
    && (!row.validFrom || row.validFrom <= validityAt) && (!row.validUntil || row.validUntil >= validityAt)
    && Boolean(file && file.purpose === 'qualification_evidence' && file.visibility === 'private'
      && file.status === 'active' && !file.deletedAt && (!file.expiresAt || file.expiresAt >= validityAt))
    && hasDecision(snapshot, {
      targetType: 'qualification_record', targetId: row.id, action: 'qualification_verify',
      actions: ['qualification_verify', 'qualification_reject', 'qualification_revoke', 'qualification_expire'],
      toStatus: 'valid',
      contentVersion: row.contentVersion, contentHash: row.contentHash,
      hashAlgorithmVersion: row.hashAlgorithmVersion, asOf: decisionAsOf,
    })
}

function assertNoOrphanEntries(
  snapshot: RecruitmentWave2Snapshot,
  agencyEntries: Map<string, AgencyManifestEntry>,
  jobEntries: Map<string, JobManifestEntry>,
): void {
  const agencyIds = new Set(snapshot.legacyAgencies.map((row) => row.id))
  const jobIds = new Set(snapshot.legacyJobs.map((row) => row.id))
  if ([...agencyEntries.keys()].some((id) => !agencyIds.has(id))) {
    throw new Error('RECRUITMENT_WAVE2_MANIFEST_ORPHAN_AGENCY')
  }
  if ([...jobEntries.keys()].some((id) => !jobIds.has(id))) {
    throw new Error('RECRUITMENT_WAVE2_MANIFEST_ORPHAN_JOB')
  }
}

function uniqueById<T extends AgencyManifestEntry | JobManifestEntry>(items: T[], key: 'legacyAgencyId' | 'legacyJobId'): Map<string, T> {
  const result = new Map<string, T>()
  for (const item of items) {
    const id = key === 'legacyAgencyId' && 'legacyAgencyId' in item
      ? item.legacyAgencyId.trim()
      : key === 'legacyJobId' && 'legacyJobId' in item
        ? item.legacyJobId.trim()
        : ''
    if (!id || result.has(id)) throw new Error(`RECRUITMENT_WAVE2_MANIFEST_${key.toUpperCase()}_INVALID`)
    result.set(id, item)
  }
  return result
}

function normalizeReasons(reasons: string[]): string[] {
  const normalized = [...new Set(reasons.map((value) => value.trim()).filter((value) => /^[a-z][a-z0-9_]{2,63}$/u.test(value)))]
  return normalized.length ? normalized.sort() : ['manual_blocker_reason_missing']
}

function candidate(legacyId: string, targetId: string, migrationChecksum?: string, contentHash?: string): RecruitmentWave2PlanItem {
  return { legacyId, result: 'candidate', reasonCodes: [], targetId, migrationChecksum, contentHash }
}

function blocked(legacyId: string, ...reasonCodes: string[]): RecruitmentWave2PlanItem {
  return { legacyId, result: 'blocker', reasonCodes: [...new Set(reasonCodes)].sort() }
}

function archiveSkip(legacyId: string, reasonCode: string, authorizationRef: string): RecruitmentWave2PlanItem {
  if (!/^[a-z][a-z0-9_]{2,63}$/u.test(reasonCode.trim()) || authorizationRef.trim().length < 6) {
    return blocked(legacyId, 'archive_skip_authorization_invalid')
  }
  return { legacyId, result: 'archived_skip', reasonCodes: [reasonCode.trim()] }
}

function summarize(items: RecruitmentWave2PlanItem[]) {
  const candidateCount = items.filter((item) => item.result === 'candidate').length
  const blocker = items.filter((item) => item.result === 'blocker').length
  const archivedSkipped = items.filter((item) => item.result === 'archived_skip').length
  if (candidateCount + blocker + archivedSkipped !== items.length) throw new Error('RECRUITMENT_WAVE2_CONSERVATION_FAILED')
  return { total: items.length, candidate: candidateCount, blocker, archivedSkipped, items }
}

function byId(a: { id: string }, b: { id: string }): number { return a.id.localeCompare(b.id) }
