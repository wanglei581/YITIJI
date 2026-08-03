export type PartnerAccountAction = 'delete_account' | 'rebind_phone'
export type PartnerAccountVerificationMethod = 'sms' | 'password'
export type PasswordProofState = 'legacy' | 'temporary' | 'owner_managed'

export interface ActionChallengeBinding {
  challengeId: string
  adminId: string
  adminTokenVersion: number
  orgId: string
  partnerId: string
  partnerTokenVersion: number
  action: PartnerAccountAction
  verifyMethod: PartnerAccountVerificationMethod
  phoneHash?: string
  otpPurpose?: 'partner_account_delete' | 'partner_phone_rebind_authorize'
}

export interface ActionTicketBinding {
  adminId: string
  adminTokenVersion: number
  orgId: string
  partnerId: string
  partnerTokenVersion: number
  action: PartnerAccountAction
}

export interface RebindTicketBinding extends ActionTicketBinding {
  action: 'rebind_phone'
  newPhoneHash: string
  newPhoneEnc: string
  phoneMasked: string
}

export interface OtpRequestContext {
  ip: string
  deviceId?: string
}

export interface TicketScope {
  adminId: string
  orgId: string
  partnerId: string
  action: PartnerAccountAction
}

export interface ChallengeScope extends TicketScope {
  challengeId: string
}

export interface CreateChallengeResponse {
  challengeId: string
  action: PartnerAccountAction
  verifyMethod: PartnerAccountVerificationMethod
  phoneMasked?: string
  availableMethods: PartnerAccountVerificationMethod[]
  expiresInSeconds: 300
  cooldownSeconds: number
}

export interface StartRebindResponse {
  rebindTicket: string
  phoneMasked: string
  expiresInSeconds: 300
  cooldownSeconds: 60
}

export interface ResendRebindResponse {
  phoneMasked: string
  expiresInSeconds: number
  cooldownSeconds: 60
}

export interface PasswordChallengeConsumeInput {
  scope: ChallengeScope
  challenge: ActionChallengeBinding
  actionTicketHash: string
  actionTicketBinding: ActionTicketBinding
  ticketTtlSeconds: 90
}

export interface SmsChallengeConsumeInput extends PasswordChallengeConsumeInput {
  otp: {
    codeKey: string
    attemptKey: string
    lockedKey: string
    submittedCode: string
    maxAttempts: 5
    lockSeconds: 300
  }
}

export type OtpConsumeBinding = SmsChallengeConsumeInput['otp']

export interface DeleteTicketConsumeInput {
  actionTicketHash: string
  scope: TicketScope & { action: 'delete_account' }
  requestId: string
  lockSeconds: 60
}

export interface RebindStartConsumeInput {
  actionTicketHash: string
  scope: TicketScope & { action: 'rebind_phone' }
  rebindTicketHash: string
  rebindBinding: RebindTicketBinding
  rebindTtlSeconds: 300
}

export interface RebindSmsConsumeInput {
  rebindTicketHash: string
  scope: TicketScope & { action: 'rebind_phone' }
  otp: SmsChallengeConsumeInput['otp']
}

export type ChallengeConsumeResult =
  | 'consumed'
  | 'unavailable'
  | 'credential_invalid'
  | 'credential_locked'

export type TicketLockResult =
  | { kind: 'acquired'; binding: ActionTicketBinding }
  | { kind: 'conflict' }
  | { kind: 'missing_or_scope_mismatch' }
