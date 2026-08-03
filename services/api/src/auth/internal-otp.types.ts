export type InternalOtpPurpose =
  | 'login'
  | 'reset_password'
  | 'bind_phone'
  | 'transfer_phone'
  | 'partner_account_delete'
  | 'partner_phone_rebind_authorize'
  | 'partner_phone_rebind_new'

export interface InternalOtpVerificationDescriptor {
  codeKey: string
  attemptKey: string
  lockedKey: string
  submittedCode: string
  maxAttempts: 5
  lockSeconds: 300
}
