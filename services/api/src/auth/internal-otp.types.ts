export type InternalOtpPurpose =
  | 'login'
  /** 管理员密码登录后的短信第二步（P1-4）；与 'login' 分开存，短信登录的码不能拿来过第二步。 */
  | 'admin_login_2fa'
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
