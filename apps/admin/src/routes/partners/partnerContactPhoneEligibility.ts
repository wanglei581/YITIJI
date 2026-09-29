// GET /admin/orgs/:id 的账号视图（services/api/src/orgs/admin-org-account-view.ts）
// 查询了 passwordProofState，但 mapAdminOrgAccount 没有返回它。
// 也没有「联系人手机已登记、本人尚未自证」字段。phoneMasked 在创建账号时就会有，不能当成已登记。
// 这两个字段缺省时：能用现有字段否掉的先否掉（停用、已验证、已有密码验证方式），
// 其余显示「登记手机号」，由服务端 409 PARTNER_CONTACT_PHONE_NOT_ELIGIBLE 兜底。
// 建议后端在 AdminOrgAccount 增加：
//   passwordProofState: 'temporary' | 'owner_managed' | 'legacy'
//   contactPhoneRegisteredAt: string | null  （仅本登记接口写入后才有值，自证完成前 phoneVerifiedAt 仍为 null）

export const CONTACT_PHONE_REGISTER_LABEL = '登记手机号'
export const CONTACT_PHONE_REREGISTER_LABEL = '重新登记手机号'
export const CONTACT_PHONE_DISABLED_REASON = '账号已停用'
export const CONTACT_PHONE_OWNER_PASSWORD_REASON = '已由本人设置密码，无需登记'
export const CONTACT_PHONE_VERIFIED_REASON = '手机号已由本人验证，无需登记'
export const CONTACT_PHONE_NOT_TEMPORARY_REASON = '这个账号不是临时密码，不能登记手机号'

export interface ContactPhoneAccountSignals {
  enabled: boolean
  phoneVerifiedAt: string | null
  availableActionVerificationMethods: readonly string[]
  passwordProofState?: string | null
  contactPhoneRegisteredAt?: string | null
}

export type ContactPhoneRegistrationOffer =
  | { visible: true; label: typeof CONTACT_PHONE_REGISTER_LABEL | typeof CONTACT_PHONE_REREGISTER_LABEL }
  | { visible: false; reason: string }

export function contactPhoneRegistrationOffer(account: ContactPhoneAccountSignals): ContactPhoneRegistrationOffer {
  if (!account.enabled) return { visible: false, reason: CONTACT_PHONE_DISABLED_REASON }
  const proof = account.passwordProofState
  const ownerManaged = proof === 'owner_managed' || account.availableActionVerificationMethods.includes('password')
  if (ownerManaged) return { visible: false, reason: CONTACT_PHONE_OWNER_PASSWORD_REASON }
  if (account.phoneVerifiedAt) return { visible: false, reason: CONTACT_PHONE_VERIFIED_REASON }
  if (proof != null && proof !== '' && proof !== 'temporary') {
    return { visible: false, reason: CONTACT_PHONE_NOT_TEMPORARY_REASON }
  }
  const registered = typeof account.contactPhoneRegisteredAt === 'string' && account.contactPhoneRegisteredAt.length > 0
  return {
    visible: true,
    label: registered ? CONTACT_PHONE_REREGISTER_LABEL : CONTACT_PHONE_REGISTER_LABEL,
  }
}
