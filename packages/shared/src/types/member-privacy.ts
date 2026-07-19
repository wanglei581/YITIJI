export const END_USER_STATUSES = ['active', 'disabled', 'closing', 'anonymized'] as const
export type EndUserStatus = (typeof END_USER_STATUSES)[number]

export const MEMBER_STEP_UP_ACTIONS = [
  'export_data_request',
  'export_data_download',
  'close_account',
  'phone_rebind',
] as const
export type MemberStepUpAction = (typeof MEMBER_STEP_UP_ACTIONS)[number]

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

export type MemberPrivacyErrorCode =
  | 'STEP_UP_REQUIRED'
  | 'STEP_UP_CHALLENGE_EXPIRED'
  | 'STEP_UP_CODE_INVALID'
  | 'STEP_UP_TOKEN_INVALID'
  | 'DATA_REQUEST_EXECUTION_INCOMPLETE'
  | 'DATA_REQUEST_ALREADY_ACTIVE'
  | 'DATA_REQUEST_IN_PROGRESS'
  | 'DATA_REQUEST_INVALID_TRANSITION'
  | 'DATA_REQUEST_QUEUE_UNAVAILABLE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'QUEUE_ENQUEUE_FAILED'
  | 'EXPORT_NOT_READY'
  | 'EXPORT_DOWNLOAD_IN_PROGRESS'
  | 'EXPORT_ALREADY_DOWNLOADED'
  | 'EXPORT_EXPIRED'
  | 'EXPORT_TOO_LARGE'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'ACCOUNT_CLOSURE_NOT_AVAILABLE'

export const MEMBER_PRIVACY_FAILURE_CODES = [
  'QUEUE_ENQUEUE_FAILED',
  'EXPORT_ARTIFACT_MISSING',
  'EXPORT_TOO_LARGE',
  'EXPORT_CLEANUP_FAILED',
] as const
export type MemberPrivacyFailureCode = (typeof MEMBER_PRIVACY_FAILURE_CODES)[number]

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
  capabilities: {
    accountClosureAvailable: boolean
  }
}

export interface AdminMemberDataRequestItem extends MemberDataRequestItem {
  endUserId: string
  phoneMasked: string
  nickname: string | null
  retryCount: number
  lastAttemptAt: string | null
  handledBy: string | null
  auditRef: string | null
}

export interface CreateMemberDataRequestInput {
  requestType: MemberDataRequestType
}

export interface MemberExportDownloadAuthorization {
  requestId: string
  downloadUrl: string
  expiresAt: string
}
