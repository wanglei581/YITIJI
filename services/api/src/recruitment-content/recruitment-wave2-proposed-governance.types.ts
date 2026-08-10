export const RECRUITMENT_WAVE2_PROPOSED_GOVERNANCE_RULE_VERSION =
  'recruitment-wave2-proposed-governance-v1' as const

export interface CoverageExpectation { count: number; idsSha256: string }
export interface ProposedGovernanceCoverage {
  sources: CoverageExpectation
  sourceBoundJobs: CoverageExpectation
  orphanJobs: CoverageExpectation
  fairs: CoverageExpectation
  legacyAgencies: CoverageExpectation
  legacyJobs: CoverageExpectation
  auditCandidates: CoverageExpectation
}

export interface ProposedOrganization {
  organizationId: string; baseFingerprint: string; contentTrustStatus: string; evidenceRef: string
}
export interface ProposedSource {
  sourceId: string; baseFingerprint: string; organizationId: string; approvalStatus: string; trustStatus: string
  syncEnabled: boolean; allowedContentDomains: string[]; redirectPolicy: string; evidenceRef: string
}
export interface ProposedJobLinkEvidence {
  ref: string; jobId: string; baseFingerprint: string; sourceId: string
  sourceUrl: string; finalUrl: string; linkCheckRef: string
}
export interface ProposedOrphanJob {
  jobId: string; baseFingerprint: string; disposition: string; organizationId: string | null
  sourceId: string | null; reasonCode: string | null; authorizationRef: string | null
}
export interface ProposedFair {
  fairId: string; baseFingerprint: string; disposition: string; organizationId: string | null
  sourceId: string | null; sourceUrl: string | null; finalUrl: string | null; checkinUrl: string | null
  finalCheckinUrl: string | null; sourceLinkCheckRef: string | null; checkinLinkCheckRef: string | null
  organizerAuthorizationRef: string | null; organizerAuthorizationSha256: string | null
  authorizationValidFrom: string | null; authorizationValidUntil: string | null
  reasonCode: string | null; authorizationRef: string | null
}
export interface ProposedProfile {
  profileId: string; mustBeAbsent: true; organizationId: string; displayName: string; description: string | null
  serviceScope: string[]; reviewStatus: string; publishStatus: string; contentVersion: number
  contentHash: string; approvedContentHash: string | null; hashAlgorithmVersion: string; evidenceRef: string
}
export interface ProposedBranch {
  branchId: string; mustBeAbsent: true; profileId: string; branchName: string; provinceCode: string | null
  cityCode: string | null; districtCode: string | null; address: string; lat: number | null; lng: number | null
  geoSource: string | null; serviceHours: string | null; serviceHoursSource: string | null
  publicPhone: string | null; website: string | null; status: string; reviewStatus: string; publishStatus: string
  contentVersion: number; contentHash: string; approvedContentHash: string | null
  hashAlgorithmVersion: string; evidenceRef: string
}
export interface ProposedQualification {
  qualificationId: string; mustBeAbsent: true; organizationId: string; qualificationType: string
  licenseNumber: string | null; issuerName: string; jurisdiction: string; branchId: string | null
  validFrom: string | null; validUntil: string | null; status: string; contentVersion: number
  contentHash: string; approvedContentHash: string | null; hashAlgorithmVersion: string
  evidenceFileId: string; verificationSource: string; verifiedBy: string; verifiedAt: string; evidenceRef: string
}
export interface ProposedAction {
  ref: string; targetType: string; targetId: string; action: string; toStatus: string
  sequence: number; reasonCode?: string
}
export interface ProposedAuditCandidate {
  auditLogId: string; baseFingerprint: string; payloadSha256: string; disposition: string; reasonCode: string
  evidenceRef: string; authorizationRef: string | null
}

export interface RecruitmentWave2ProposedGovernance {
  schemaVersion: 1
  ruleVersion: typeof RECRUITMENT_WAVE2_PROPOSED_GOVERNANCE_RULE_VERSION
  sourceInventoryReportSha256: string
  sourceDatabaseSnapshotDigest: string
  restoreSnapshotSha256: string
  asOf: string
  preparedAt: string
  preparedByRef: string
  expectedCoverage: ProposedGovernanceCoverage
  organizations: ProposedOrganization[]
  sources: ProposedSource[]
  jobLinkEvidence: ProposedJobLinkEvidence[]
  orphanJobs: ProposedOrphanJob[]
  fairs: ProposedFair[]
  profiles: ProposedProfile[]
  branches: ProposedBranch[]
  qualifications: ProposedQualification[]
  proposedActions: ProposedAction[]
  auditCandidates: ProposedAuditCandidate[]
}

type Row = Record<string, unknown>
const SHA256 = /^[a-f0-9]{64}$/u
const ID = /^[A-Za-z0-9_-]{1,128}$/u
const REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{5,127}$/u
const CODE = /^[a-z][a-z0-9_]{2,63}$/u
const DOMAIN = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/u
const MAX_ITEMS = 50_000

export function parseRecruitmentWave2ProposedGovernance(input: unknown): RecruitmentWave2ProposedGovernance {
  const row = object(input, [
    'schemaVersion', 'ruleVersion', 'sourceInventoryReportSha256', 'sourceDatabaseSnapshotDigest',
    'restoreSnapshotSha256', 'asOf', 'preparedAt', 'preparedByRef', 'expectedCoverage', 'organizations',
    'sources', 'jobLinkEvidence', 'orphanJobs', 'fairs', 'profiles', 'branches', 'qualifications',
    'proposedActions', 'auditCandidates',
  ])
  if (row.schemaVersion !== 1 || row.ruleVersion !== RECRUITMENT_WAVE2_PROPOSED_GOVERNANCE_RULE_VERSION) fieldInvalid()
  return {
    schemaVersion: 1, ruleVersion: RECRUITMENT_WAVE2_PROPOSED_GOVERNANCE_RULE_VERSION,
    sourceInventoryReportSha256: hash(row.sourceInventoryReportSha256),
    sourceDatabaseSnapshotDigest: hash(row.sourceDatabaseSnapshotDigest),
    restoreSnapshotSha256: hash(row.restoreSnapshotSha256), asOf: date(row.asOf), preparedAt: date(row.preparedAt),
    preparedByRef: ref(row.preparedByRef), expectedCoverage: coverage(row.expectedCoverage),
    organizations: list(row.organizations, parseOrganization), sources: list(row.sources, parseSource),
    jobLinkEvidence: list(row.jobLinkEvidence, parseJobLink), orphanJobs: list(row.orphanJobs, parseOrphanJob),
    fairs: list(row.fairs, parseFair), profiles: list(row.profiles, parseProfile),
    branches: list(row.branches, parseBranch), qualifications: list(row.qualifications, parseQualification),
    proposedActions: list(row.proposedActions, parseAction), auditCandidates: list(row.auditCandidates, parseAudit),
  }
}

function coverage(value: unknown): ProposedGovernanceCoverage {
  const row = object(value, ['sources', 'sourceBoundJobs', 'orphanJobs', 'fairs', 'legacyAgencies', 'legacyJobs', 'auditCandidates'])
  const item = (input: unknown): CoverageExpectation => {
    const entry = object(input, ['count', 'idsSha256'])
    return { count: integer(entry.count, 0, MAX_ITEMS), idsSha256: hash(entry.idsSha256) }
  }
  return { sources: item(row.sources), sourceBoundJobs: item(row.sourceBoundJobs), orphanJobs: item(row.orphanJobs),
    fairs: item(row.fairs), legacyAgencies: item(row.legacyAgencies), legacyJobs: item(row.legacyJobs),
    auditCandidates: item(row.auditCandidates) }
}

function parseOrganization(value: unknown): ProposedOrganization {
  const r = object(value, ['organizationId', 'baseFingerprint', 'contentTrustStatus', 'evidenceRef'])
  return { organizationId: id(r.organizationId), baseFingerprint: hash(r.baseFingerprint),
    contentTrustStatus: one(r.contentTrustStatus, ['pending', 'active', 'suspended', 'revoked']), evidenceRef: ref(r.evidenceRef) }
}
function parseSource(value: unknown): ProposedSource {
  const r = object(value, ['sourceId', 'baseFingerprint', 'organizationId', 'approvalStatus', 'trustStatus',
    'syncEnabled', 'allowedContentDomains', 'redirectPolicy', 'evidenceRef'])
  return { sourceId: id(r.sourceId), baseFingerprint: hash(r.baseFingerprint), organizationId: id(r.organizationId),
    approvalStatus: one(r.approvalStatus, ['pending', 'approved', 'rejected']),
    trustStatus: one(r.trustStatus, ['pending', 'active', 'suspended', 'revoked']), syncEnabled: bool(r.syncEnabled),
    allowedContentDomains: uniqueList(r.allowedContentDomains, domain, 100),
    redirectPolicy: one(r.redirectPolicy, ['allowlist_only', 'same_host_only']), evidenceRef: ref(r.evidenceRef) }
}
function parseJobLink(value: unknown): ProposedJobLinkEvidence {
  const r = object(value, ['ref', 'jobId', 'baseFingerprint', 'sourceId', 'sourceUrl', 'finalUrl', 'linkCheckRef'])
  return { ref: ref(r.ref), jobId: id(r.jobId), baseFingerprint: hash(r.baseFingerprint), sourceId: id(r.sourceId),
    sourceUrl: httpsUrl(r.sourceUrl), finalUrl: httpsUrl(r.finalUrl), linkCheckRef: ref(r.linkCheckRef) }
}
function parseOrphanJob(value: unknown): ProposedOrphanJob {
  const r = object(value, ['jobId', 'baseFingerprint', 'disposition', 'organizationId', 'sourceId', 'reasonCode', 'authorizationRef'])
  return { jobId: id(r.jobId), baseFingerprint: hash(r.baseFingerprint),
    disposition: one(r.disposition, ['propose', 'blocker', 'archived_skip']), organizationId: nullable(r.organizationId, id),
    sourceId: nullable(r.sourceId, id), reasonCode: nullable(r.reasonCode, code), authorizationRef: nullable(r.authorizationRef, ref) }
}
function parseFair(value: unknown): ProposedFair {
  const r = object(value, ['fairId', 'baseFingerprint', 'disposition', 'organizationId', 'sourceId', 'sourceUrl',
    'finalUrl', 'checkinUrl', 'finalCheckinUrl', 'sourceLinkCheckRef', 'checkinLinkCheckRef',
    'organizerAuthorizationRef', 'organizerAuthorizationSha256', 'authorizationValidFrom',
    'authorizationValidUntil', 'reasonCode', 'authorizationRef'])
  return { fairId: id(r.fairId), baseFingerprint: hash(r.baseFingerprint),
    disposition: one(r.disposition, ['propose', 'blocker', 'archived_skip']), organizationId: nullable(r.organizationId, id),
    sourceId: nullable(r.sourceId, id), sourceUrl: nullable(r.sourceUrl, httpsUrl), finalUrl: nullable(r.finalUrl, httpsUrl),
    checkinUrl: nullable(r.checkinUrl, httpsUrl), finalCheckinUrl: nullable(r.finalCheckinUrl, httpsUrl),
    sourceLinkCheckRef: nullable(r.sourceLinkCheckRef, ref), checkinLinkCheckRef: nullable(r.checkinLinkCheckRef, ref),
    organizerAuthorizationRef: nullable(r.organizerAuthorizationRef, ref),
    organizerAuthorizationSha256: nullable(r.organizerAuthorizationSha256, hash),
    authorizationValidFrom: nullable(r.authorizationValidFrom, date),
    authorizationValidUntil: nullable(r.authorizationValidUntil, date), reasonCode: nullable(r.reasonCode, code),
    authorizationRef: nullable(r.authorizationRef, ref) }
}
function parseProfile(value: unknown): ProposedProfile {
  const r = object(value, ['profileId', 'mustBeAbsent', 'organizationId', 'displayName', 'description', 'serviceScope',
    'reviewStatus', 'publishStatus', 'contentVersion', 'contentHash', 'approvedContentHash', 'hashAlgorithmVersion', 'evidenceRef'])
  return { profileId: id(r.profileId), mustBeAbsent: absent(r.mustBeAbsent), organizationId: id(r.organizationId),
    displayName: text(r.displayName, 200), description: nullable(r.description, (v) => text(v, 2_000)),
    serviceScope: uniqueList(r.serviceScope, code, 100), reviewStatus: review(r.reviewStatus),
    publishStatus: publish(r.publishStatus), contentVersion: integer(r.contentVersion, 1, 1_000_000),
    contentHash: hash(r.contentHash), approvedContentHash: nullable(r.approvedContentHash, hash),
    hashAlgorithmVersion: one(r.hashAlgorithmVersion, ['offline-agency-profile-v1']), evidenceRef: ref(r.evidenceRef) }
}
function parseBranch(value: unknown): ProposedBranch {
  const r = object(value, ['branchId', 'mustBeAbsent', 'profileId', 'branchName', 'provinceCode', 'cityCode', 'districtCode',
    'address', 'lat', 'lng', 'geoSource', 'serviceHours', 'serviceHoursSource', 'publicPhone', 'website', 'status',
    'reviewStatus', 'publishStatus', 'contentVersion', 'contentHash', 'approvedContentHash', 'hashAlgorithmVersion', 'evidenceRef'])
  return { branchId: id(r.branchId), mustBeAbsent: absent(r.mustBeAbsent), profileId: id(r.profileId), branchName: text(r.branchName, 200),
    provinceCode: nullable(r.provinceCode, region), cityCode: nullable(r.cityCode, region), districtCode: nullable(r.districtCode, region),
    address: text(r.address, 500), lat: nullable(r.lat, (v) => number(v, -90, 90)), lng: nullable(r.lng, (v) => number(v, -180, 180)),
    geoSource: nullable(r.geoSource, code), serviceHours: nullable(r.serviceHours, (v) => text(v, 500)),
    serviceHoursSource: nullable(r.serviceHoursSource, ref), publicPhone: nullable(r.publicPhone, (v) => text(v, 64)),
    website: nullable(r.website, httpsUrl), status: one(r.status, ['active', 'suspended', 'closed']), reviewStatus: review(r.reviewStatus),
    publishStatus: publish(r.publishStatus), contentVersion: integer(r.contentVersion, 1, 1_000_000), contentHash: hash(r.contentHash),
    approvedContentHash: nullable(r.approvedContentHash, hash),
    hashAlgorithmVersion: one(r.hashAlgorithmVersion, ['offline-agency-branch-v1']), evidenceRef: ref(r.evidenceRef) }
}
function parseQualification(value: unknown): ProposedQualification {
  const r = object(value, ['qualificationId', 'mustBeAbsent', 'organizationId', 'qualificationType', 'licenseNumber',
    'issuerName', 'jurisdiction', 'branchId', 'validFrom', 'validUntil', 'status', 'contentVersion', 'contentHash',
    'approvedContentHash', 'hashAlgorithmVersion', 'evidenceFileId', 'verificationSource', 'verifiedBy',
    'verifiedAt', 'evidenceRef'])
  return { qualificationId: id(r.qualificationId), mustBeAbsent: absent(r.mustBeAbsent), organizationId: id(r.organizationId),
    qualificationType: one(r.qualificationType, ['business_license', 'hr_service_license', 'labor_dispatch_permit',
      'public_service_authority', 'school_authority', 'organizer_authorization']),
    licenseNumber: nullable(r.licenseNumber, (v) => text(v, 200)),
    issuerName: text(r.issuerName, 300), jurisdiction: text(r.jurisdiction, 100), branchId: nullable(r.branchId, id),
    validFrom: nullable(r.validFrom, date), validUntil: nullable(r.validUntil, date), status: one(r.status, ['pending', 'valid', 'rejected', 'expired', 'revoked']),
    contentVersion: integer(r.contentVersion, 1, 1_000_000), contentHash: hash(r.contentHash),
    approvedContentHash: nullable(r.approvedContentHash, hash),
    hashAlgorithmVersion: one(r.hashAlgorithmVersion, ['qualification-record-v1']),
    evidenceFileId: id(r.evidenceFileId), verificationSource: ref(r.verificationSource),
    verifiedBy: id(r.verifiedBy), verifiedAt: date(r.verifiedAt), evidenceRef: ref(r.evidenceRef) }
}
function parseAction(value: unknown): ProposedAction {
  const r = object(value, ['ref', 'targetType', 'targetId', 'action', 'toStatus', 'sequence', 'reasonCode'], ['reasonCode'])
  return { ref: ref(r.ref), targetType: code(r.targetType), targetId: id(r.targetId), action: code(r.action),
    toStatus: code(r.toStatus), sequence: integer(r.sequence, 1, 1_000_000),
    ...('reasonCode' in r ? { reasonCode: code(r.reasonCode) } : {}) }
}
function parseAudit(value: unknown): ProposedAuditCandidate {
  const r = object(value, ['auditLogId', 'baseFingerprint', 'payloadSha256', 'disposition', 'reasonCode', 'evidenceRef', 'authorizationRef'])
  return { auditLogId: id(r.auditLogId), baseFingerprint: hash(r.baseFingerprint),
    payloadSha256: hash(r.payloadSha256),
    disposition: one(r.disposition, ['false_positive', 'accepted_historical_gap', 'followup_required']),
    reasonCode: code(r.reasonCode), evidenceRef: ref(r.evidenceRef), authorizationRef: nullable(r.authorizationRef, ref) }
}

function object(value: unknown, keys: string[], optional: string[] = []): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fieldInvalid()
  const row = value as Row
  if (Object.keys(row).some((key) => !keys.includes(key))) throw new Error('RECRUITMENT_WAVE2_PROPOSED_GOVERNANCE_UNKNOWN_FIELD')
  if (keys.some((key) => !optional.includes(key) && !Object.prototype.hasOwnProperty.call(row, key))) fieldInvalid()
  return row
}
function list<T>(value: unknown, parser: (item: unknown) => T, max = MAX_ITEMS): T[] {
  if (!Array.isArray(value) || value.length > max) fieldInvalid()
  return value.map(parser)
}
function uniqueList<T extends string>(value: unknown, parser: (item: unknown) => T, max: number): T[] {
  const parsed = list(value, parser, max)
  if (new Set(parsed).size !== parsed.length) fieldInvalid()
  return parsed
}
function string(value: unknown, pattern: RegExp, max: number): string {
  if (typeof value !== 'string' || value.length > max || !pattern.test(value)) fieldInvalid()
  return value
}
function id(value: unknown): string { return string(value, ID, 128) }
function ref(value: unknown): string { return string(value, REF, 128) }
function code(value: unknown): string { return string(value, CODE, 64) }
function hash(value: unknown): string { return string(value, SHA256, 64) }
function domain(value: unknown): string { return string(value, DOMAIN, 253) }
function region(value: unknown): string { return string(value, /^\d{6}$/u, 6) }
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.trim() !== value) fieldInvalid()
  return value
}
function date(value: unknown): string {
  const result = string(value, ISO_UTC, 27)
  if (!Number.isFinite(new Date(result).getTime())) fieldInvalid()
  return result
}
function httpsUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2_048) fieldInvalid()
  try { const parsed = new URL(value); if (parsed.protocol !== 'https:' || parsed.username || parsed.password) fieldInvalid() } catch { fieldInvalid() }
  return value
}
function bool(value: unknown): boolean { if (typeof value !== 'boolean') fieldInvalid(); return value }
function absent(value: unknown): true { if (value !== true) fieldInvalid(); return true }
function integer(value: unknown, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) fieldInvalid()
  return value as number
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fieldInvalid()
  return value
}
function nullable<T>(value: unknown, parser: (item: unknown) => T): T | null { return value === null ? null : parser(value) }
function one<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fieldInvalid()
  return value as T
}
function review(value: unknown): string { return one(value, ['pending', 'reviewing', 'approved', 'rejected']) }
function publish(value: unknown): string { return one(value, ['draft', 'published', 'unpublished', 'expired']) }
function fieldInvalid(): never { throw new Error('RECRUITMENT_WAVE2_PROPOSED_GOVERNANCE_FIELD_INVALID') }
