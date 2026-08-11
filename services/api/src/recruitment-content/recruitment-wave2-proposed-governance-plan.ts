import {
  parseStringArrayPolicy,
  parseDomainPolicy,
  requiredQualificationTypes,
  type EvidenceFileShape,
} from './recruitment-content-readiness'
import {
  buildRecruitmentWave2Plan,
  canonicalJson,
  digest,
  type RecruitmentWave2Manifest,
  type RecruitmentWave2PlanContext,
  type RecruitmentWave2Snapshot,
} from './recruitment-wave2-plan'
import type {
  CoverageExpectation,
  ProposedAction,
  ProposedBranch,
  ProposedFair,
  ProposedProfile,
  ProposedQualification,
  RecruitmentWave2ProposedGovernance,
} from './recruitment-wave2-proposed-governance.types'
import {
  hasFinalProposedAction,
  proposedBranchHash,
  proposedProfileHash,
  proposedQualificationHash,
  proposedSourceUrlReasons,
  validateProposedLegacyMappings,
  validateProposedGovernanceReachability,
} from './recruitment-wave2-proposed-governance-rules'
export interface ProposedGovernanceInventoryEvidence {
  snapshotDigest: string
  counts: Record<string, number>
  issues: Record<string, string[]>
}
export interface ProposedGovernanceExtras {
  fairs: Array<{
    id: string; sourceOrgId: string; sourceId: string | null; externalId: string; sourceName: string
    sourceUrl: string; checkinUrl: string | null; startAt: Date; endAt: Date; reviewStatus: string
    publishStatus: string; reviewedBy: string | null; reviewedAt: Date | null; rejectReason: string | null
    syncTime: Date; updatedAt: Date
  }>
  auditCandidates: Array<{
    id: string; action: string; targetType: string; targetId: string | null; createdAt: Date; payloadJson: string
  }>
  evidenceFiles: EvidenceFileShape[]
}
export interface ProposedGovernancePlanInput {
  governance: RecruitmentWave2ProposedGovernance
  inventory: ProposedGovernanceInventoryEvidence
  snapshot: RecruitmentWave2Snapshot
  extras: ProposedGovernanceExtras
  legacyManifest: RecruitmentWave2Manifest
  context: RecruitmentWave2PlanContext
}
export interface ProposedGovernanceBlocker {
  scope: string
  targetId: string | null
  reasonCodes: string[]
}
interface CountSummary { total: number; candidate: number; blocker: number; archivedSkipped: number }
interface LegacyCurrentPlanSummary {
  agencies: CountSummary & { items: Array<{ legacyId: string; result: string; reasonCodes: string[] }> }
  jobs: CountSummary & { items: Array<{ legacyId: string; result: string; reasonCodes: string[] }> }
}
export interface RecruitmentWave2ProposedGovernancePlan {
  simulatedOnly: true
  currentFactsApplied: false
  databaseWrites: 0
  writeAuthorized: false
  writerEligible: false
  publicationDecision: 'not_evaluated'
  fairTargetSafe: 'unsupported'
  readyForOwnerApproval: boolean
  recommendedExitCode: 0 | 2
  proposalChecksum: string
  combinedValidationChecksum: string
  coverage: Record<string, { expected: number; actual: number; proposed: number }>
  blockers: ProposedGovernanceBlocker[]
  legacyCurrentPlan: LegacyCurrentPlanSummary
  hypotheticalProposalConsistency: { consistent: boolean; blockerCount: number }
  hypotheticalAfterExecution: { evaluated: true; factsPersisted: false; proposedActionCount: number }
}
const ORPHAN_ISSUE = 'job_source_missing_or_orphan'
const AUDIT_ISSUE = 'audit_negative_action_reason_missing_candidate'
export function buildRecruitmentWave2ProposedGovernancePlan(
  input: ProposedGovernancePlanInput,
): RecruitmentWave2ProposedGovernancePlan {
  const { governance: g, snapshot, extras, inventory } = input
  const blockers: ProposedGovernanceBlocker[] = []
  const add = (scope: string, targetId: string | null, ...reasons: string[]) => {
    if (reasons.length) blockers.push({ scope, targetId, reasonCodes: [...new Set(reasons)].sort() })
  }
  if (g.sourceDatabaseSnapshotDigest !== inventory.snapshotDigest) add('input', null, 'source_snapshot_digest_mismatch')
  if (g.restoreSnapshotSha256 !== input.legacyManifest.snapshotSha256) add('input', null, 'restore_snapshot_mismatch')
  const orphanIds = sortedUnique(inventory.issues[ORPHAN_ISSUE] ?? [])
  const orphanSet = new Set(orphanIds)
  const sourceBoundJobIds = sortedUnique(snapshot.jobs.filter((row) => !orphanSet.has(row.id)).map((row) => row.id))
  const auditIds = sortedUnique(inventory.issues[AUDIT_ISSUE] ?? [])
  const actual = {
    sources: sortedUnique(snapshot.sources.map((row) => row.id)), sourceBoundJobs: sourceBoundJobIds,
    orphanJobs: orphanIds, fairs: sortedUnique(extras.fairs.map((row) => row.id)),
    legacyAgencies: sortedUnique(snapshot.legacyAgencies.map((row) => row.id)),
    legacyJobs: sortedUnique(snapshot.legacyJobs.map((row) => row.id)), auditCandidates: auditIds,
  }
  const proposed = {
    sources: g.sources.map((row) => row.sourceId),
    sourceBoundJobs: g.jobLinkEvidence.filter((row) => !orphanSet.has(row.jobId)).map((row) => row.jobId),
    orphanJobs: g.orphanJobs.map((row) => row.jobId), fairs: g.fairs.map((row) => row.fairId),
    legacyAgencies: input.legacyManifest.agencies.map((row) => row.legacyAgencyId),
    legacyJobs: input.legacyManifest.jobs.map((row) => row.legacyJobId),
    auditCandidates: g.auditCandidates.map((row) => row.auditLogId),
  }
  const coverage: RecruitmentWave2ProposedGovernancePlan['coverage'] = {}
  for (const key of Object.keys(actual) as Array<keyof typeof actual>) {
    coverage[key] = cover(key, g.expectedCoverage[key], actual[key], proposed[key], add)
  }
  const organizations = uniqueMap(g.organizations, (row) => row.organizationId, 'organizations', add)
  const sources = uniqueMap(g.sources, (row) => row.sourceId, 'sources', add)
  const jobLinks = uniqueMap(g.jobLinkEvidence, (row) => row.jobId, 'job_link_evidence', add)
  const orphanJobs = uniqueMap(g.orphanJobs, (row) => row.jobId, 'orphan_jobs', add)
  const fairs = uniqueMap(g.fairs, (row) => row.fairId, 'fairs', add)
  const profiles = uniqueMap(g.profiles, (row) => row.profileId, 'profiles', add)
  const branches = uniqueMap(g.branches, (row) => row.branchId, 'branches', add)
  const qualifications = uniqueMap(g.qualifications, (row) => row.qualificationId, 'qualifications', add)
  const auditCandidates = uniqueMap(g.auditCandidates, (row) => row.auditLogId, 'audit_candidates', add)
  validateProposedGovernanceReachability(g, snapshot, input.legacyManifest, add)
  validateActiveSourceConsumers(g, input.legacyManifest, orphanSet, sources, organizations, add)
  for (const proposal of g.organizations) {
    const baseline = snapshot.organizations.find((row) => row.id === proposal.organizationId)
    const reasons: string[] = []
    if (!baseline) reasons.push('organization_missing')
    else { if (fingerprint(baseline) !== proposal.baseFingerprint) reasons.push('organization_baseline_drift')
      if (baseline.archivedAt) reasons.push('organization_archived') }
    if (!hasFinalProposedAction(g.proposedActions, 'organization_content_trust', proposal.organizationId,
      trustAction(proposal.contentTrustStatus), proposal.contentTrustStatus)) reasons.push('organization_action_missing')
    add('organization', proposal.organizationId, ...reasons)
  }
  for (const proposal of g.sources) {
    const baseline = snapshot.sources.find((row) => row.id === proposal.sourceId)
    const organization = organizations.get(proposal.organizationId)
    const reasons: string[] = []
    if (!baseline) reasons.push('source_missing')
    else {
      if (fingerprint(baseline) !== proposal.baseFingerprint) reasons.push('source_baseline_drift')
      if (baseline.orgId !== proposal.organizationId) reasons.push('source_organization_change_unproven')
      if (baseline.archivedAt) reasons.push('source_archived')
    }
    if (!organization) reasons.push('source_organization_proposal_missing')
    if (!parseDomainPolicy(JSON.stringify(proposal.allowedContentDomains)).valid) reasons.push('source_domain_policy_invalid')
    if (!hasFinalProposedAction(g.proposedActions, 'job_source', proposal.sourceId,
      sourceApprovalAction(proposal.approvalStatus), proposal.approvalStatus)) reasons.push('source_approval_action_missing')
    if (!hasFinalProposedAction(g.proposedActions, 'job_source', proposal.sourceId,
      trustAction(proposal.trustStatus), proposal.trustStatus)) reasons.push('source_trust_action_missing')
    add('source', proposal.sourceId, ...reasons)
  }
  for (const evidence of g.jobLinkEvidence) {
    const job = snapshot.jobs.find((row) => row.id === evidence.jobId)
    const source = sources.get(evidence.sourceId)
    const reasons: string[] = []
    if (!job) reasons.push('job_missing')
    else {
      if (fingerprint(job) !== evidence.baseFingerprint) reasons.push('job_baseline_drift')
      if (job.sourceUrl !== evidence.sourceUrl) reasons.push('job_source_url_baseline_mismatch')
      if (!orphanSet.has(job.id) && job.sourceId !== evidence.sourceId) reasons.push('job_source_binding_mismatch')
    }
    if (!source) reasons.push('job_source_proposal_missing')
    else { reasons.push(...proposedSourceUrlReasons(evidence.sourceUrl, evidence.finalUrl, source))
      if (job && !orphanSet.has(job.id) && source.organizationId !== job.sourceOrgId) reasons.push('job_source_organization_mismatch') }
    add('job_link', evidence.jobId, ...reasons)
  }
  for (const proposal of orphanJobs.values()) {
    const job = snapshot.jobs.find((row) => row.id === proposal.jobId)
    const reasons: string[] = []
    if (!job) reasons.push('orphan_job_missing')
    else if (fingerprint(job) !== proposal.baseFingerprint) reasons.push('orphan_job_baseline_drift')
    dispositionReasons(proposal, reasons)
    if (proposal.disposition === 'propose') {
      const source = proposal.sourceId ? sources.get(proposal.sourceId) : undefined
      if (!source || !proposal.organizationId) reasons.push('orphan_job_source_binding_missing')
      else if (source.organizationId !== proposal.organizationId) reasons.push('orphan_job_source_organization_mismatch')
      const link = jobLinks.get(proposal.jobId)
      if (!link || link.sourceId !== proposal.sourceId) reasons.push('orphan_job_link_evidence_missing')
    }
    add('orphan_job', proposal.jobId, ...reasons)
  }
  for (const proposal of fairs.values()) validateFair(proposal, extras, sources, input.context.evaluatedAt, add)
  for (const profile of g.profiles) validateProfile(profile, snapshot, g.proposedActions, add)
  for (const branch of g.branches) validateBranch(branch, snapshot, profiles, g.proposedActions, add)
  for (const qualification of g.qualifications) {
    validateQualification(qualification, snapshot, profiles, branches, extras.evidenceFiles,
      g.proposedActions, input.context.evaluatedAt, add)
  }
  validateRequiredQualifications(g.profiles, g.branches, g.qualifications, snapshot, add)
  validateActions(g.proposedActions, organizations, sources, profiles, branches, qualifications, add)
  for (const proposal of auditCandidates.values()) {
    const baseline = extras.auditCandidates.find((row) => row.id === proposal.auditLogId)
    const reasons: string[] = []
    if (!baseline) reasons.push('audit_candidate_missing')
    else {
      const { payloadJson, ...auditMetadata } = baseline
      const payloadSha256 = digest(payloadJson)
      const safeBaseline = { ...auditMetadata, payloadSha256 }
      if (fingerprint(safeBaseline) !== proposal.baseFingerprint) reasons.push('audit_baseline_drift')
      if (payloadSha256 !== proposal.payloadSha256) reasons.push('audit_payload_digest_mismatch')
    }
    if (proposal.disposition === 'followup_required') reasons.push('audit_followup_open')
    if (proposal.disposition === 'accepted_historical_gap' && !proposal.authorizationRef) {
      reasons.push('audit_gap_authorization_missing')
    }
    add('audit_candidate', proposal.auditLogId, ...reasons)
  }
  for (const blocker of validateProposedLegacyMappings(g, snapshot, input.legacyManifest)) {
    add(blocker.scope, blocker.targetId, ...blocker.reasons)
  }
  const legacy = buildRecruitmentWave2Plan(snapshot, input.legacyManifest, input.context)
  const legacyCurrentPlan = summarizeLegacy(legacy)
  const sortedBlockers = blockers.sort((a, b) => a.scope.localeCompare(b.scope)
    || (a.targetId ?? '').localeCompare(b.targetId ?? '') || a.reasonCodes.join().localeCompare(b.reasonCodes.join()))
  const proposalChecksum = digest(canonicalJson(normalizedGovernance(g)))
  const stable = { proposalChecksum, coverage, blockers: sortedBlockers, legacyCurrentPlan,
    hypotheticalActionCount: g.proposedActions.length }
  const readyForOwnerApproval = sortedBlockers.length === 0
  return {
    simulatedOnly: true, currentFactsApplied: false, databaseWrites: 0, writeAuthorized: false,
    writerEligible: false, publicationDecision: 'not_evaluated',
    fairTargetSafe: 'unsupported', readyForOwnerApproval,
    recommendedExitCode: readyForOwnerApproval ? 0 : 2, proposalChecksum,
    combinedValidationChecksum: digest(canonicalJson(stable)), coverage, blockers: sortedBlockers,
    legacyCurrentPlan, hypotheticalProposalConsistency: { consistent: readyForOwnerApproval, blockerCount: sortedBlockers.length },
    hypotheticalAfterExecution: { evaluated: true, factsPersisted: false, proposedActionCount: g.proposedActions.length },
  }
}
function validateActiveSourceConsumers(
  governance: RecruitmentWave2ProposedGovernance, manifest: RecruitmentWave2Manifest,
  orphanIds: Set<string>, sources: Map<string, { organizationId: string; approvalStatus: string; trustStatus: string }>,
  organizations: Map<string, { contentTrustStatus: string }>, add: Add,
): void {
  const usedSourceIds = new Set(governance.jobLinkEvidence.filter((row) => !orphanIds.has(row.jobId)).map((row) => row.sourceId))
  for (const row of governance.orphanJobs) if (row.disposition === 'propose' && row.sourceId) usedSourceIds.add(row.sourceId)
  for (const row of governance.fairs) if (row.disposition === 'propose' && row.sourceId) usedSourceIds.add(row.sourceId)
  for (const row of manifest.jobs) if (row.disposition === 'map') usedSourceIds.add(row.jobSourceId)
  for (const sourceId of usedSourceIds) {
    const source = sources.get(sourceId)
    const reasons: string[] = []
    if (!source) reasons.push('consumer_source_missing')
    else {
      if (source.approvalStatus !== 'approved') reasons.push('consumer_source_not_approved')
      if (source.trustStatus !== 'active') reasons.push('consumer_source_trust_inactive')
      if (organizations.get(source.organizationId)?.contentTrustStatus !== 'active') {
        reasons.push('consumer_organization_trust_inactive')
      }
    }
    add('source_consumer', sourceId, ...reasons)
  }
}
function validateFair(
  p: ProposedFair, extras: ProposedGovernanceExtras, sources: Map<string, { organizationId: string; allowedContentDomains: string[]; redirectPolicy: string }>,
  evaluatedAt: Date, add: (scope: string, id: string | null, ...reasons: string[]) => void,
): void {
  const baseline = extras.fairs.find((row) => row.id === p.fairId)
  const reasons: string[] = []
  if (!baseline) reasons.push('fair_missing')
  else { if (fingerprint(baseline) !== p.baseFingerprint) reasons.push('fair_baseline_drift')
    if (p.sourceUrl !== baseline.sourceUrl || p.checkinUrl !== baseline.checkinUrl) reasons.push('fair_url_baseline_mismatch')
    if (baseline.endAt < evaluatedAt) reasons.push('fair_ended') }
  dispositionReasons(p, reasons)
  if (p.disposition === 'propose') {
    const source = p.sourceId ? sources.get(p.sourceId) : undefined
    if (!source || !p.organizationId) reasons.push('fair_source_binding_missing')
    else if (source.organizationId !== p.organizationId) reasons.push('fair_source_organization_mismatch')
    if (!p.sourceUrl || !p.finalUrl || !p.sourceLinkCheckRef) reasons.push('fair_source_link_evidence_missing')
    else if (source) reasons.push(...proposedSourceUrlReasons(p.sourceUrl, p.finalUrl, source))
    if (p.checkinUrl && (!p.finalCheckinUrl || !p.checkinLinkCheckRef)) reasons.push('fair_checkin_link_evidence_missing')
    else if (p.checkinUrl && p.finalCheckinUrl && source) {
      reasons.push(...proposedSourceUrlReasons(p.checkinUrl, p.finalCheckinUrl, source))
    }
    if (!p.organizerAuthorizationRef || !p.organizerAuthorizationSha256
      || !p.authorizationValidFrom || !p.authorizationValidUntil) reasons.push('fair_organizer_authorization_missing')
    else if (baseline && (new Date(p.authorizationValidFrom) > baseline.startAt
      || new Date(p.authorizationValidUntil) < baseline.endAt)) reasons.push('fair_organizer_authorization_inactive')
  }
  add('fair', p.fairId, ...reasons)
}
function validateProfile(p: ProposedProfile, s: RecruitmentWave2Snapshot, actions: ProposedAction[], add: Add): void {
  const reasons: string[] = []
  if (s.profiles.some((row) => row.id === p.profileId)) reasons.push('profile_must_be_absent')
  if (p.contentVersion !== 1) reasons.push('profile_version_invalid')
  if (proposedProfileHash(p) !== p.contentHash) reasons.push('profile_content_hash_mismatch')
  if (p.approvedContentHash !== p.contentHash) reasons.push('profile_approved_hash_mismatch')
  if (p.reviewStatus !== 'approved') reasons.push('profile_not_approved')
  if (p.publishStatus !== 'published') reasons.push('profile_not_published')
  contentActionReasons(p, 'offline_agency_profile', p.profileId, actions, reasons)
  add('profile', p.profileId, ...reasons)
}
function validateBranch(p: ProposedBranch, s: RecruitmentWave2Snapshot, profiles: Map<string, ProposedProfile>, actions: ProposedAction[], add: Add): void {
  const reasons: string[] = []
  if (s.branches.some((row) => row.id === p.branchId)) reasons.push('branch_must_be_absent')
  if (p.contentVersion !== 1) reasons.push('branch_version_invalid')
  if (!profiles.has(p.profileId)) reasons.push('branch_profile_missing')
  if (!p.cityCode) reasons.push('branch_structured_city_missing')
  if (proposedBranchHash(p) !== p.contentHash) reasons.push('branch_content_hash_mismatch')
  if (p.approvedContentHash !== p.contentHash) reasons.push('branch_approved_hash_mismatch')
  if (p.status !== 'active') reasons.push('branch_not_active')
  if (p.reviewStatus !== 'approved') reasons.push('branch_not_approved')
  if (p.publishStatus !== 'published') reasons.push('branch_not_published')
  contentActionReasons(p, 'offline_agency_branch', p.branchId, actions, reasons)
  add('branch', p.branchId, ...reasons)
}
function validateQualification(
  q: ProposedQualification, s: RecruitmentWave2Snapshot, profiles: Map<string, ProposedProfile>,
  branches: Map<string, ProposedBranch>, files: EvidenceFileShape[],
  actions: ProposedAction[], evaluatedAt: Date, add: Add,
): void {
  const reasons: string[] = []
  if (s.qualifications.some((row) => row.id === q.qualificationId)) reasons.push('qualification_must_be_absent')
  if (q.contentVersion !== 1) reasons.push('qualification_version_invalid')
  const organization = s.organizations.find((row) => row.id === q.organizationId)
  const branch = q.branchId ? branches.get(q.branchId) : undefined
  const profile = branch ? profiles.get(branch.profileId)
    : [...profiles.values()].find((row) => row.organizationId === q.organizationId)
  if (!organization) reasons.push('qualification_organization_missing')
  if (q.branchId && !branch) reasons.push('qualification_branch_missing')
  if (q.branchId && branch && profile?.organizationId !== q.organizationId) {
    reasons.push('qualification_branch_organization_mismatch')
  }
  if (!profile) reasons.push('qualification_profile_organization_missing')
  if (proposedQualificationHash(q) !== q.contentHash) reasons.push('qualification_content_hash_mismatch')
  if (q.status === 'valid') {
    if (q.approvedContentHash !== q.contentHash) reasons.push('qualification_approved_hash_mismatch')
    if (!hasFinalProposedAction(actions, 'qualification_record', q.qualificationId, 'qualification_verify', 'valid')) {
      reasons.push('qualification_verify_action_missing')
    }
  } else reasons.push('qualification_not_valid')
  const file = files.find((row) => row.id === q.evidenceFileId)
  const at = evaluatedAt
  if (!file || file.purpose !== 'qualification_evidence' || file.visibility !== 'private' || file.status !== 'active'
    || file.deletedAt || (file.expiresAt && file.expiresAt < at)) reasons.push('qualification_evidence_invalid')
  if ((q.validFrom && new Date(q.validFrom) > at) || (q.validUntil && new Date(q.validUntil) < at)) reasons.push('qualification_outside_validity')
  if (new Date(q.verifiedAt) > at) reasons.push('qualification_verification_in_future')
  add('qualification', q.qualificationId, ...reasons)
}
function validateRequiredQualifications(
  profiles: ProposedProfile[], branches: ProposedBranch[], qualifications: ProposedQualification[],
  snapshot: RecruitmentWave2Snapshot, add: Add,
): void {
  for (const profile of profiles) {
    const organization = snapshot.organizations.find((row) => row.id === profile.organizationId)
    const scope = parseStringArrayPolicy(JSON.stringify(profile.serviceScope))
    const required = organization && scope.valid ? requiredQualificationTypes(organization.type, scope.values) : null
    if (!organization) add('profile', profile.profileId, 'profile_organization_missing')
    else if (!required) add('profile', profile.profileId, 'organization_type_not_offline_agency')
    else for (const branch of branches.filter((row) => row.profileId === profile.profileId && row.status === 'active')) {
      for (const type of required) if (!qualifications.some((q) => q.organizationId === profile.organizationId
        && q.qualificationType === type && (!q.branchId || q.branchId === branch.branchId) && q.status === 'valid')) {
        add('branch', branch.branchId, `qualification_${type}_missing`)
      }
    }
  }
}
function validateActions(
  actions: ProposedAction[], organizations: Map<string, unknown>, sources: Map<string, unknown>,
  profiles: Map<string, unknown>, branches: Map<string, unknown>, qualifications: Map<string, unknown>, add: Add,
): void {
  const targets: Record<string, Map<string, unknown>> = {
    organization_content_trust: organizations, job_source: sources, offline_agency_profile: profiles,
    offline_agency_branch: branches, qualification_record: qualifications,
  }
  const matrix: Record<string, Record<string, string[]>> = {
    organization_content_trust: { trust_activate: ['active'], trust_suspend: ['suspended'], trust_revoke: ['revoked'] },
    job_source: { source_approve: ['approved'], source_reject: ['rejected'], source_revoke: ['rejected'],
      trust_activate: ['active'], trust_suspend: ['suspended'], trust_revoke: ['revoked'] },
    offline_agency_profile: { approve: ['approved'], reject: ['rejected'], publish: ['published'],
      unpublish: ['unpublished'], archive: ['archived'] },
    offline_agency_branch: { approve: ['approved'], reject: ['rejected'], publish: ['published'],
      unpublish: ['unpublished'], archive: ['archived'] },
    qualification_record: { qualification_verify: ['valid'], qualification_reject: ['rejected'],
      qualification_revoke: ['revoked'], qualification_expire: ['expired'] },
  }
  const sequences = actions.map((row) => row.sequence).sort((a, b) => a - b)
  if (sequences.some((value, index) => value !== index + 1)) add('proposed_actions', null, 'action_sequence_not_contiguous')
  const refs = new Set<string>()
  for (const action of actions) {
    const reasons: string[] = []
    if (refs.has(action.ref)) reasons.push('action_ref_duplicate'); else refs.add(action.ref)
    if (!targets[action.targetType]?.has(action.targetId)) reasons.push('action_target_missing')
    if (!matrix[action.targetType]?.[action.action]?.includes(action.toStatus)) reasons.push('action_transition_invalid')
    if (/(reject|unpublish|archive|suspend|revoke|expire)$/u.test(action.action) && !action.reasonCode) {
      reasons.push('negative_action_reason_missing')
    }
    add('proposed_action', action.targetId, ...reasons)
  }
}
type Add = (scope: string, id: string | null, ...reasons: string[]) => void
function contentActionReasons(
  row: { reviewStatus: string; publishStatus: string; contentHash: string; approvedContentHash: string | null },
  targetType: string, targetId: string, actions: ProposedAction[], reasons: string[],
): void {
  if (row.reviewStatus === 'approved') {
    if (row.approvedContentHash !== row.contentHash) reasons.push('approved_content_hash_mismatch')
    if (!hasFinalProposedAction(actions, targetType, targetId, 'approve', 'approved')) reasons.push('approve_action_missing')
  }
  if (row.publishStatus === 'published'
    && !hasFinalProposedAction(actions, targetType, targetId, 'publish', 'published')) reasons.push('publish_action_missing')
}
function trustAction(status: string): string | null {
  return ({ active: 'trust_activate', suspended: 'trust_suspend', revoked: 'trust_revoke' } as Record<string, string>)[status] ?? null
}
function sourceApprovalAction(status: string): string | null {
  return ({ approved: 'source_approve', rejected: 'source_reject' } as Record<string, string>)[status] ?? null
}
function dispositionReasons(row: { disposition: string; reasonCode: string | null; authorizationRef: string | null }, reasons: string[]): void {
  if (row.disposition === 'blocker') reasons.push('explicit_business_blocker')
  if (row.disposition !== 'propose' && !row.reasonCode) reasons.push('disposition_reason_missing')
  if (row.disposition === 'archived_skip' && !row.authorizationRef) reasons.push('archive_authorization_missing')
}
function cover(key: string, expected: CoverageExpectation, actual: string[], proposed: string[], add: Add) {
  const normalizedProposed = sortedUnique(proposed)
  if (actual.length !== expected.count || idsDigest(actual) !== expected.idsSha256) add('coverage', key, 'expected_coverage_mismatch')
  if (normalizedProposed.length !== proposed.length) add('coverage', key, 'proposed_coverage_duplicate')
  if (idsDigest(normalizedProposed) !== idsDigest(actual)) add('coverage', key, 'proposed_coverage_mismatch')
  return { expected: expected.count, actual: actual.length, proposed: normalizedProposed.length }
}
function uniqueMap<T>(rows: T[], idOf: (row: T) => string, scope: string, add: Add): Map<string, T> {
  const result = new Map<string, T>()
  for (const row of rows) { const id = idOf(row); if (result.has(id)) add(scope, id, 'proposal_id_duplicate'); else result.set(id, row) }
  return result
}
function sortedUnique(ids: string[]): string[] { return [...new Set(ids)].sort() }
function idsDigest(ids: string[]): string { return digest(canonicalJson(sortedUnique(ids))) }
function fingerprint(value: unknown): string { return digest(canonicalJson(value)) }
function normalizedGovernance(value: RecruitmentWave2ProposedGovernance): unknown {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Array.isArray(item)
    ? [...item].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))) : item]))
}
function summarizeLegacy(plan: ReturnType<typeof buildRecruitmentWave2Plan>): LegacyCurrentPlanSummary {
  const summarize = (group: typeof plan.agencies) => ({ total: group.total, candidate: group.candidate,
    blocker: group.blocker, archivedSkipped: group.archivedSkipped,
    items: group.items.map((row) => ({ legacyId: row.legacyId, result: row.result, reasonCodes: row.reasonCodes })) })
  return { agencies: summarize(plan.agencies), jobs: summarize(plan.jobs) }
}
