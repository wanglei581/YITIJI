import { canonicalJson, digest } from './recruitment-wave2-target'
import { parseStringArrayPolicy, requiredQualificationTypes,
  validateLandingUrl } from './recruitment-content-readiness'
import type { JobManifestEntry, RecruitmentWave2Manifest, RecruitmentWave2Snapshot } from './recruitment-wave2-target'
import type {
  ProposedAction,
  ProposedBranch,
  ProposedProfile,
  ProposedQualification,
  RecruitmentWave2ProposedGovernance,
} from './recruitment-wave2-proposed-governance.types'

export const PROPOSED_QUALIFICATION_TYPES = new Set([
  'business_license',
  'hr_service_license',
  'labor_dispatch_permit',
  'public_service_authority',
  'school_authority',
  'organizer_authorization',
])

export function proposedProfileHash(row: ProposedProfile): string {
  return digest(canonicalJson({
    organizationId: row.organizationId,
    displayName: row.displayName,
    description: row.description,
    serviceScope: [...row.serviceScope].sort(),
  }))
}

export function proposedBranchHash(row: ProposedBranch): string {
  return digest(canonicalJson({
    profileId: row.profileId,
    branchName: row.branchName,
    provinceCode: row.provinceCode,
    cityCode: row.cityCode,
    districtCode: row.districtCode,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    geoSource: row.geoSource,
    serviceHours: row.serviceHours,
    serviceHoursSource: row.serviceHoursSource,
    publicPhone: row.publicPhone,
    website: row.website,
    status: row.status,
  }))
}

export function proposedQualificationHash(row: ProposedQualification): string {
  return digest(canonicalJson({
    organizationId: row.organizationId,
    qualificationType: row.qualificationType,
    licenseNumber: row.licenseNumber,
    issuerName: row.issuerName,
    jurisdiction: row.jurisdiction,
    branchId: row.branchId,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    evidenceFileId: row.evidenceFileId,
    verificationSource: row.verificationSource,
    verifiedBy: row.verifiedBy,
    verifiedAt: row.verifiedAt,
  }))
}

export function proposedActionFamily(action: string): string {
  if (action.startsWith('trust_')) return 'trust'
  if (action.startsWith('source_')) return 'source_approval'
  if (action === 'approve' || action === 'reject') return 'content_review'
  if (action === 'publish' || action === 'unpublish' || action === 'archive') return 'content_publication'
  if (action.startsWith('qualification_')) return 'qualification_status'
  return action
}

export function hasFinalProposedAction(
  actions: ProposedAction[],
  targetType: string,
  targetId: string,
  action: string | null,
  toStatus: string,
): boolean {
  if (!action) return false
  const family = proposedActionFamily(action)
  const latest = actions.filter((row) => row.targetType === targetType && row.targetId === targetId
    && proposedActionFamily(row.action) === family).sort((a, b) => b.sequence - a.sequence)[0]
  return latest?.action === action && latest.toStatus === toStatus
}

export function validateProposedGovernanceReachability(
  governance: RecruitmentWave2ProposedGovernance, snapshot: RecruitmentWave2Snapshot,
  manifest: RecruitmentWave2Manifest,
  add: (scope: string, id: string | null, ...reasons: string[]) => void,
): void {
  const profiles = new Map(governance.profiles.map((row) => [row.profileId, row]))
  const branches = new Map(governance.branches.map((row) => [row.branchId, row]))
  const mappedAgencies = manifest.agencies.filter((row) => row.disposition === 'map')
  const mappedJobs = manifest.jobs.filter((row) => row.disposition === 'map')
  const organizationIds = new Set([
    ...governance.sources.map((row) => row.organizationId),
    ...governance.orphanJobs.filter((row) => row.disposition === 'propose' && row.organizationId)
      .map((row) => row.organizationId!),
    ...governance.fairs.filter((row) => row.disposition === 'propose' && row.organizationId)
      .map((row) => row.organizationId!),
    ...mappedAgencies.map((row) => row.organizationId), ...mappedJobs.map((row) => row.organizationId),
  ])
  for (const row of governance.organizations) if (!organizationIds.has(row.organizationId)) {
    add('organization', row.organizationId, 'organization_unreferenced')
  }
  const profileIds = new Set(mappedAgencies.map((row) => row.profileId))
  const profileOrganizations = new Set<string>()
  for (const profile of governance.profiles) {
    if (!profileIds.has(profile.profileId)) add('profile', profile.profileId, 'profile_unreferenced')
    if (profileOrganizations.has(profile.organizationId)
      || snapshot.profiles.some((row) => row.organizationId === profile.organizationId)) {
      add('profile', profile.profileId, 'profile_organization_unique_conflict')
    }
    profileOrganizations.add(profile.organizationId)
  }
  const branchIds = new Set([...mappedAgencies.map((row) => row.branchId), ...mappedJobs.map((row) => row.offlineBranchId)])
  for (const branch of governance.branches) if (!branchIds.has(branch.branchId)) {
    add('branch', branch.branchId, 'branch_unreferenced')
  }
  const qualificationScopes = new Set<string>()
  for (const qualification of governance.qualifications) {
    const key = `${qualification.organizationId}\0${qualification.qualificationType}\0${qualification.branchId ?? ''}`
    if (qualificationScopes.has(key)) add('qualification', qualification.qualificationId, 'qualification_scope_duplicate')
    qualificationScopes.add(key)
    const profile = qualification.branchId
      ? profiles.get(branches.get(qualification.branchId)?.profileId ?? '')
      : [...profiles.values()].find((row) => row.organizationId === qualification.organizationId)
    const organization = snapshot.organizations.find((row) => row.id === qualification.organizationId)
    const scope = profile ? parseStringArrayPolicy(JSON.stringify(profile.serviceScope)) : null
    const required = organization && scope?.valid ? requiredQualificationTypes(organization.type, scope.values) : null
    if (!profile || !required?.includes(qualification.qualificationType)) {
      add('qualification', qualification.qualificationId, 'qualification_unreferenced')
    }
  }
}

export function evaluateRecruitmentWave2LegacyJobFacts(
  legacy: RecruitmentWave2Snapshot['legacyJobs'][number],
  entry: Extract<JobManifestEntry, { disposition: 'map' }>, branchCityCode: string | null | undefined,
): { category: string | null; reasons: string[] } {
  const reasons: string[] = []
  if (!entry.employer.trim()) reasons.push('employer_missing')
  if (!entry.cityName.trim()) reasons.push('city_name_missing')
  if (!/^\d{6}$/u.test(entry.cityCode.trim())) reasons.push('structured_city_invalid')
  if (branchCityCode !== entry.cityCode.trim()) reasons.push('branch_city_mismatch')
  const category = legacyJobCategory(legacy.jobType)
  if (!category) reasons.push('job_type_unknown')
  if (legacy.salaryMin !== null && legacy.salaryMax !== null && legacy.salaryMin > legacy.salaryMax) {
    reasons.push('salary_range_invalid')
  }
  if (!entry.linkCheckRef.trim()) reasons.push('link_check_ref_missing')
  return { category, reasons }
}

export function preferredRecruitmentWave2ExternalIdCounts(
  snapshot: RecruitmentWave2Snapshot, manifest: RecruitmentWave2Manifest,
): Map<string, number> {
  const legacyById = new Map(snapshot.legacyJobs.map((row) => [row.id, row]))
  const counts = new Map<string, number>()
  for (const entry of manifest.jobs) {
    if (entry.disposition !== 'map') continue
    const legacy = legacyById.get(entry.legacyJobId)
    if (!legacy) continue
    const externalId = entry.externalId?.trim() || legacy.externalId?.trim() || `offline-job:${legacy.id}`
    for (const key of [`source\0${entry.jobSourceId}\0${externalId}`,
      `organization\0${entry.organizationId}\0${externalId}`]) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

export function resolveRecruitmentWave2ExternalId(
  snapshot: RecruitmentWave2Snapshot, legacy: RecruitmentWave2Snapshot['legacyJobs'][number],
  entry: Extract<JobManifestEntry, { disposition: 'map' }>, preferred: string,
  plannedCounts: Map<string, number>,
): string | null {
  const conflicts = (value: string) => snapshot.jobs.some((job) => job.id !== legacy.canonicalJobId
    && ((job.sourceId === entry.jobSourceId && job.externalId === value)
      || (job.sourceOrgId === entry.organizationId && job.externalId === value)))
  const sourceKey = `source\0${entry.jobSourceId}\0${preferred}`
  const organizationKey = `organization\0${entry.organizationId}\0${preferred}`
  if (plannedCounts.get(sourceKey) === 1 && plannedCounts.get(organizationKey) === 1 && !conflicts(preferred)) return preferred
  const fallback = `offline-job:${legacy.id}`
  const fallbackPreferred = (plannedCounts.get(`source\0${entry.jobSourceId}\0${fallback}`) ?? 0) > 0
    || (plannedCounts.get(`organization\0${entry.organizationId}\0${fallback}`) ?? 0) > 0
  return conflicts(fallback) || fallbackPreferred ? null : fallback
}

export function validateProposedLegacyMappings(
  governance: RecruitmentWave2ProposedGovernance, snapshot: RecruitmentWave2Snapshot,
  manifest: RecruitmentWave2Manifest,
): Array<{ scope: string; targetId: string; reasons: string[] }> {
  const result: Array<{ scope: string; targetId: string; reasons: string[] }> = []
  const organizations = new Set(governance.organizations.map((row) => row.organizationId))
  const profiles = new Map(governance.profiles.map((row) => [row.profileId, row]))
  const branches = new Map(governance.branches.map((row) => [row.branchId, row]))
  const plannedExternalIds = preferredRecruitmentWave2ExternalIdCounts(snapshot, manifest)
  for (const entry of manifest.agencies) {
    const reasons: string[] = []
    const legacy = snapshot.legacyAgencies.find((row) => row.id === entry.legacyAgencyId)
    if (!legacy) reasons.push('legacy_agency_missing')
    if (entry.disposition === 'blocker') reasons.push('explicit_business_blocker')
    if (entry.disposition === 'archived_skip') reasons.push(...archiveDispositionReasons(entry))
    if (entry.disposition !== 'map') {
      if (reasons.length) result.push({ scope: 'legacy_agency_proposal', targetId: entry.legacyAgencyId, reasons })
      continue
    }
    const organization = governance.organizations.find((row) => row.organizationId === entry.organizationId)
    if (!organizations.has(entry.organizationId)) reasons.push('legacy_agency_organization_proposal_missing')
    if (legacy && legacy.sourceOrgId !== entry.organizationId) reasons.push('legacy_organization_mismatch')
    if (organization?.contentTrustStatus !== 'active') reasons.push('legacy_agency_organization_trust_inactive')
    if (profiles.get(entry.profileId)?.organizationId !== entry.organizationId) reasons.push('legacy_agency_profile_mismatch')
    if (branches.get(entry.branchId)?.profileId !== entry.profileId) reasons.push('legacy_agency_branch_mismatch')
    if (reasons.length) result.push({ scope: 'legacy_agency_proposal', targetId: entry.legacyAgencyId, reasons })
  }
  for (const entry of manifest.jobs) {
    const reasons: string[] = []
    const legacy = snapshot.legacyJobs.find((row) => row.id === entry.legacyJobId)
    if (!legacy) reasons.push('legacy_job_missing')
    if (legacy && Boolean(legacy.canonicalJobId) !== Boolean(legacy.migrationChecksum)) reasons.push('partial_migration_state')
    if (entry.disposition !== 'map' && legacy?.canonicalJobId) reasons.push('canonical_state_requires_map_disposition')
    if (entry.disposition === 'blocker') reasons.push('explicit_business_blocker')
    if (entry.disposition === 'archived_skip') reasons.push(...archiveDispositionReasons(entry))
    if (entry.disposition !== 'map') {
      if (reasons.length) result.push({ scope: 'legacy_job_proposal', targetId: entry.legacyJobId, reasons })
      continue
    }
    const source = governance.sources.find((row) => row.sourceId === entry.jobSourceId)
    const organization = governance.organizations.find((row) => row.organizationId === entry.organizationId)
    const branch = branches.get(entry.offlineBranchId)
    const agencyEntry = legacy ? manifest.agencies.find((row) => row.legacyAgencyId === legacy.agencyId) : undefined
    if (legacy) {
      if (legacy.canonicalJobId || legacy.migrationChecksum) reasons.push('existing_migration_requires_current_plan')
      reasons.push(...evaluateRecruitmentWave2LegacyJobFacts(legacy, entry, branch?.cityCode).reasons)
      const preferred = entry.externalId?.trim() || legacy.externalId?.trim() || `offline-job:${legacy.id}`
      if (!resolveRecruitmentWave2ExternalId(snapshot, legacy, entry, preferred, plannedExternalIds)) {
        reasons.push('external_id_conflict')
      }
      const targetId = `job-offline-${digest(legacy.id).slice(0, 24)}`
      if (!legacy.canonicalJobId && snapshot.jobs.some((row) => row.id === targetId)) {
        reasons.push('canonical_target_id_conflict')
      }
    }
    if (!agencyEntry || agencyEntry.disposition !== 'map' || agencyEntry.organizationId !== entry.organizationId
      || agencyEntry.branchId !== entry.offlineBranchId) reasons.push('legacy_job_agency_mapping_mismatch')
    if (organization?.contentTrustStatus !== 'active') reasons.push('legacy_job_organization_trust_inactive')
    if (!source || source.organizationId !== entry.organizationId) reasons.push('legacy_job_source_mismatch')
    if (source?.approvalStatus !== 'approved') reasons.push('legacy_job_source_not_approved')
    if (source?.trustStatus !== 'active') reasons.push('legacy_job_source_trust_inactive')
    if (!branch) reasons.push('legacy_job_branch_missing')
    if (!snapshot.sources.find((row) => row.id === entry.jobSourceId)?.name.trim()) reasons.push('legacy_job_source_name_missing')
    if (source) reasons.push(...proposedSourceUrlReasons(entry.sourceUrl, entry.finalUrl, source))
    if (reasons.length) result.push({ scope: 'legacy_job_proposal', targetId: entry.legacyJobId, reasons })
  }
  return result
}

function archiveDispositionReasons(row: { reasonCode: string; authorizationRef: string }): string[] {
  return /^[a-z][a-z0-9_]{2,63}$/u.test(row.reasonCode.trim()) && row.authorizationRef.trim().length >= 6
    ? [] : ['archive_skip_authorization_invalid']
}

export function proposedSourceUrlReasons(
  initialUrl: string, finalUrl: string,
  source: { allowedContentDomains: string[]; redirectPolicy: string },
): string[] {
  const reasons: string[] = []
  const initial = validateLandingUrl(initialUrl, source.allowedContentDomains)
  const final = validateLandingUrl(finalUrl, source.allowedContentDomains)
  if (!initial.validUrl || !initial.allowedDomain) reasons.push('initial_url_not_allowed')
  if (!final.validUrl || !final.allowedDomain) reasons.push('final_url_not_allowed')
  if (source.redirectPolicy === 'same_host_only' && initial.validUrl && final.validUrl
    && new URL(initialUrl).hostname.toLowerCase() !== new URL(finalUrl).hostname.toLowerCase()) {
    reasons.push('redirect_host_mismatch')
  }
  return reasons
}

function legacyJobCategory(value: string): string | null {
  if (value === 'fulltime' || value === 'parttime') return value
  return value === 'internship' ? 'intern' : null
}
