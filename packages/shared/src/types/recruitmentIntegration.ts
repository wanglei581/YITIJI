import type { AccessMode } from './job'

export const RECRUITMENT_INTEGRATION_CONTRACT_VERSION = '2026-08-10.v1' as const

export type RecruitmentIntegrationDataType = 'job' | 'fair'

export interface RecruitmentIntegrationSchema {
  dataType: RecruitmentIntegrationDataType
  allowed: boolean
  requiredFields: string[]
  optionalFields: string[]
}

export interface RecruitmentIntegrationContract {
  contractVersion: typeof RECRUITMENT_INTEGRATION_CONTRACT_VERSION
  orgType: string
  allowedAccessModes: AccessMode[]
  schemas: RecruitmentIntegrationSchema[]
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
  importTargetState: {
    reviewStatus: 'pending'
    publishStatus: 'draft'
    publiclyVisible: false
  }
  forbiddenFields: string[]
}

export interface RecruitmentIntegrationPreflightResult {
  contractVersion: typeof RECRUITMENT_INTEGRATION_CONTRACT_VERSION
  dataType: RecruitmentIntegrationDataType
  accepted: true
  itemCount: number
  persistence: 'none'
  optionalFieldsPresent: string[]
  normalizedDimensions: Record<string, number>
  importTargetState: {
    reviewStatus: 'pending'
    publishStatus: 'draft'
    publiclyVisible: false
  }
}
