export type MemberAiConsentScope = 'job_ai'
export type MemberDataRequestType = 'export' | 'delete' | 'revoke_consent'
export type MemberDataRequestStatus = 'pending' | 'handling' | 'completed' | 'rejected'

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
  handledBy: string | null
  auditRef: string | null
}

export interface AdminMemberDataRequestItem extends MemberDataRequestItem {
  endUserId: string
}
