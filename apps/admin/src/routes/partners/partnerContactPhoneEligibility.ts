// 登记按钮只看服务端下发的 canRegisterContactPhone。
// 字段缺失（响应里没有这个键，或不是布尔值）不显示按钮，也不根据停用、
// 手机验证或验证方式推断。phoneRegisteredByAdminAt 非空表示管理员已登记、
// 机构本人尚未自证。

export const CONTACT_PHONE_REGISTER_LABEL = '登记手机号'
export const CONTACT_PHONE_REREGISTER_LABEL = '重新登记'
export const CONTACT_PHONE_PENDING_STATUS = '已登记，待机构本人自证'
export const CONTACT_PHONE_DISABLED_REASON = '账号已停用'
export const CONTACT_PHONE_OWNER_VERIFIED_REASON = '手机号已由机构本人验证，无需登记'
export const CONTACT_PHONE_INELIGIBLE_REASON = '当前不符合登记条件'

export interface ContactPhoneAccountSignals {
  enabled: boolean
  phoneVerifiedAt?: string | null
  phoneMasked?: string | null
  phoneRegisteredByAdminAt?: string | null
  canRegisterContactPhone?: boolean
}

export interface ContactPhonePending {
  status: typeof CONTACT_PHONE_PENDING_STATUS
  phoneMasked: string | null
  registeredAtLabel: string
}

export interface ContactPhoneRegistrationOffer {
  visible: boolean
  label: typeof CONTACT_PHONE_REGISTER_LABEL | typeof CONTACT_PHONE_REREGISTER_LABEL | null
  pending: ContactPhonePending | null
  reason: string | null
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** 登记时间按北京时间展示。解析不了时原样返回，不改写成别的时区。 */
export function formatContactPhoneRegisteredAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}:${pick('second')}`
}

function pendingFor(account: ContactPhoneAccountSignals): ContactPhonePending | null {
  const registeredAt = nonEmpty(account.phoneRegisteredByAdminAt)
  if (!registeredAt) return null
  return {
    status: CONTACT_PHONE_PENDING_STATUS,
    phoneMasked: nonEmpty(account.phoneMasked),
    registeredAtLabel: formatContactPhoneRegisteredAt(registeredAt),
  }
}

function deniedReason(account: ContactPhoneAccountSignals): string {
  if (account.enabled === false) return CONTACT_PHONE_DISABLED_REASON
  // 后台拿不到原始密码状态（#1139）：不能登记且手机已由本人验证，就是「已自证，无需登记」。
  if (nonEmpty(account.phoneVerifiedAt) !== null) return CONTACT_PHONE_OWNER_VERIFIED_REASON
  return CONTACT_PHONE_INELIGIBLE_REASON
}

export function contactPhoneRegistrationOffer(account: ContactPhoneAccountSignals): ContactPhoneRegistrationOffer {
  const pending = pendingFor(account)
  if (account.canRegisterContactPhone === true) {
    return {
      visible: true,
      label: pending ? CONTACT_PHONE_REREGISTER_LABEL : CONTACT_PHONE_REGISTER_LABEL,
      pending,
      reason: null,
    }
  }
  if (account.canRegisterContactPhone === false) {
    return { visible: false, label: null, pending, reason: deniedReason(account) }
  }
  return { visible: false, label: null, pending, reason: null }
}
