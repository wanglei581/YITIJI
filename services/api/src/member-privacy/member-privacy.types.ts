export type MemberAiConsentScope = 'job_ai'

export const MEMBER_DATA_REQUEST_TYPES = ['export', 'delete', 'revoke_consent'] as const
export type MemberDataRequestType = (typeof MEMBER_DATA_REQUEST_TYPES)[number]

export const MEMBER_DATA_REQUEST_STATUSES = [
  'pending',
  'handling',
  'ready',
  'completed',
  'expired',
  'failed',
  'rejected',
  'cancelled',
] as const
export type MemberDataRequestStatus = (typeof MEMBER_DATA_REQUEST_STATUSES)[number]

export const MEMBER_DATA_REQUEST_STEP_UP_ACTIONS = [
  'export_data_request',
  'export_data_download',
  'close_account',
] as const
export type MemberDataRequestStepUpAction = (typeof MEMBER_DATA_REQUEST_STEP_UP_ACTIONS)[number]

export interface MemberAiConsentStatus {
  scope: MemberAiConsentScope
  consentVersion: string
  granted: boolean
  grantedAt: string | null
  revokedAt: string | null
}

export interface MemberDataRequestItem {
  id: string
  requestType: MemberDataRequestType
  status: MemberDataRequestStatus
  requestedAt: string
  handledAt: string | null
  executionStep: string | null
  exportExpiresAt: string | null
  failureCode: string | null
  canRetry: boolean
  canDownload: boolean
}

export interface MemberDataRequestPage {
  items: MemberDataRequestItem[]
  nextCursor: string | null
}

export interface AdminMemberDataRequestItem extends MemberDataRequestItem {
  endUserId: string
}
