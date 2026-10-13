export type MemberAiConsentScope = 'job_ai' | 'contract_review' | 'resume_ai' | 'age_14_plus' | 'voice_recording'
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
  /** 这个范围当前版本。不是这条记录写下时的版本。 */
  consentVersion: string
  granted: boolean
  grantedAt: string | null
  revokedAt: string | null
  /** granted 时是这条记录自己的版本，否则 null。 */
  grantedVersion: string | null
  /** granted 时：登录勾选版本为 login_checkbox，其余为 prompt；未声明为 null。 */
  grantedSource: 'login_checkbox' | 'prompt' | null
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
