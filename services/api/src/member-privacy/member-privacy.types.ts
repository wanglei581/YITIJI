export type MemberAiConsentScope = 'job_ai'
export type MemberDataRequestType = 'export' | 'delete' | 'revoke_consent'
export type MemberDataRequestStatus =
  | 'pending'
  | 'handling'
  | 'ready'
  | 'completed'
  | 'expired'
  | 'failed'
  | 'rejected'
  | 'cancelled'

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
  capabilities: {
    accountClosureAvailable: false
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

export interface AdminMemberDataRequestPage {
  items: AdminMemberDataRequestItem[]
  nextCursor: string | null
}

export interface AdminMemberDataRequestQuery {
  status?: MemberDataRequestStatus
  requestType?: MemberDataRequestType
  cursor?: string
  limit?: number
}
