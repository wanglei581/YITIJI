import type { ImportFairItemDto } from './dto/import-fairs.dto'
import type { ImportJobItemDto } from './dto/import-jobs.dto'
import type { AccessMode, SourceKind } from './jobs-shared'

// services/api 使用 CommonJS，不能直接运行时依赖 ESM-only 的 shared 包。
// 这里的响应形状与 packages/shared/src/types/recruitmentIntegration.ts 保持一致。
export const RECRUITMENT_INTEGRATION_CONTRACT_VERSION = '2026-08-10.v1' as const

export interface PartnerDataSourceCapabilitiesInput {
  orgType: string
  allowedAccessModes: AccessMode[]
  allowedSourceKinds: SourceKind[]
  defaultSourceKind: SourceKind
  adminManagedAccessModes: AccessMode[]
  canImportJobs: boolean
  canImportFairs: boolean
}

export interface RecruitmentIntegrationContract {
  contractVersion: typeof RECRUITMENT_INTEGRATION_CONTRACT_VERSION
  orgType: string
  allowedAccessModes: AccessMode[]
  schemas: Array<{
    dataType: 'job' | 'fair'
    allowed: boolean
    requiredFields: string[]
    optionalFields: string[]
  }>
  routes: {
    contract: string
    dataSources: string
    validateJobs: string
    validateFairs: string
    importJobs: string
    importFairs: string
    excelTemplate: string
    excelPreview: string
    webhook: string | null
  }
  webhook: {
    signatureAlgorithm: 'HMAC-SHA256'
    signatureInput: '${timestamp}.${rawBody}'
    timestampHeader: 'X-Webhook-Timestamp'
    nonceHeader: 'X-Webhook-Nonce'
    signatureHeader: 'X-Webhook-Signature'
    acceptanceWindowSeconds: 300
  } | null
  importTargetState: typeof IMPORT_TARGET_STATE
  forbiddenFields: string[]
}

export interface RecruitmentIntegrationPreflightResult {
  contractVersion: typeof RECRUITMENT_INTEGRATION_CONTRACT_VERSION
  dataType: 'job' | 'fair'
  accepted: true
  itemCount: number
  persistence: 'none'
  optionalFieldsPresent: string[]
  normalizedDimensions: Record<string, number>
  importTargetState: typeof IMPORT_TARGET_STATE
}

const JOB_REQUIRED_FIELDS = ['externalId', 'title', 'company', 'city', 'sourceUrl']
const JOB_OPTIONAL_FIELDS = [
  'salary',
  'tags',
  'description',
  'requirements',
  'industry',
  'workType',
  'headcount',
  'educationRequirement',
  'experienceRequirement',
  'skills',
  'benefits',
  'salaryMin',
  'salaryMax',
  'salaryUnit',
  'validThrough',
]
const FAIR_REQUIRED_FIELDS = [
  'externalId',
  'title',
  'startAt',
  'endAt',
  'venue',
  'city',
  'sourceUrl',
]
const FAIR_OPTIONAL_FIELDS = [
  'theme',
  'address',
  'mapImageUrl',
  'coverImageUrl',
  'description',
  'checkinUrl',
  'companyCount',
  'jobCount',
]
const FORBIDDEN_FIELDS = [
  'candidateName',
  'candidatePhone',
  'candidateEmail',
  'resumeUrl',
  'resumeText',
  'applicationStatus',
  'interviewInvite',
  'offerStatus',
]
const IMPORT_TARGET_STATE = {
  reviewStatus: 'pending',
  publishStatus: 'draft',
  publiclyVisible: false,
} as const

export function buildRecruitmentIntegrationContract(
  capabilities: PartnerDataSourceCapabilitiesInput
): RecruitmentIntegrationContract {
  const webhookAllowed =
    capabilities.allowedAccessModes.includes('webhook') && capabilities.canImportJobs
  return {
    contractVersion: RECRUITMENT_INTEGRATION_CONTRACT_VERSION,
    orgType: capabilities.orgType,
    allowedAccessModes: [...capabilities.allowedAccessModes],
    schemas: [
      {
        dataType: 'job',
        allowed: capabilities.canImportJobs,
        requiredFields: [...JOB_REQUIRED_FIELDS],
        optionalFields: [...JOB_OPTIONAL_FIELDS],
      },
      {
        dataType: 'fair',
        allowed: capabilities.canImportFairs,
        requiredFields: [...FAIR_REQUIRED_FIELDS],
        optionalFields: [...FAIR_OPTIONAL_FIELDS],
      },
    ],
    routes: {
      contract: '/api/v1/partner/data-sources/integration-contract',
      dataSources: '/api/v1/partner/data-sources',
      validateJobs: '/api/v1/partner/data-sources/preflight/jobs',
      validateFairs: '/api/v1/partner/data-sources/preflight/fairs',
      importJobs: '/api/v1/partner/jobs/import',
      importFairs: '/api/v1/partner/fairs/import',
      excelTemplate: '/api/v1/partner/excel/template?dataType=job|fair',
      excelPreview: '/api/v1/partner/excel/preview',
      webhook: webhookAllowed ? '/api/v1/sync/webhook?source={sourceId}' : null,
    },
    webhook: webhookAllowed
      ? {
          signatureAlgorithm: 'HMAC-SHA256',
          signatureInput: '${timestamp}.${rawBody}',
          timestampHeader: 'X-Webhook-Timestamp',
          nonceHeader: 'X-Webhook-Nonce',
          signatureHeader: 'X-Webhook-Signature',
          acceptanceWindowSeconds: 300,
        }
      : null,
    importTargetState: IMPORT_TARGET_STATE,
    forbiddenFields: [...FORBIDDEN_FIELDS],
  }
}

export function summarizeJobPreflight(
  items: ImportJobItemDto[]
): RecruitmentIntegrationPreflightResult {
  return summarize('job', items, JOB_OPTIONAL_FIELDS, 'workType')
}

export function summarizeFairPreflight(
  items: ImportFairItemDto[]
): RecruitmentIntegrationPreflightResult {
  return summarize('fair', items, FAIR_OPTIONAL_FIELDS, 'theme')
}

function summarize(
  dataType: 'job' | 'fair',
  items: object[],
  optionalFields: string[],
  dimensionField: string
): RecruitmentIntegrationPreflightResult {
  const optionalFieldsPresent = optionalFields.filter((field) =>
    items.some((item) => {
      const row = item as Record<string, unknown>
      return row[field] !== undefined && row[field] !== null
    })
  )
  const normalizedDimensions: Record<string, number> = {}
  for (const item of items) {
    const value = (item as Record<string, unknown>)[dimensionField]
    const key = typeof value === 'string' && value.trim() ? value.trim() : 'unspecified'
    normalizedDimensions[key] = (normalizedDimensions[key] ?? 0) + 1
  }
  return {
    contractVersion: RECRUITMENT_INTEGRATION_CONTRACT_VERSION,
    dataType,
    accepted: true,
    itemCount: items.length,
    persistence: 'none',
    optionalFieldsPresent,
    normalizedDimensions,
    importTargetState: IMPORT_TARGET_STATE,
  }
}
