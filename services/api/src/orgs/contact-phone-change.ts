/**
 * 机构联系人手机是否算「改过」。
 *
 * 放在这里，而不是 admin-orgs.service.ts：那个文件已经超过 800 行，不能再往里加功能。
 * 也不放进登记服务：登记服务要依赖机构账号操作服务，而后者又依赖 AdminOrgsService，
 * 从档案更新再引回去会绕成循环引用。
 */
import { normalizePhone } from '../common/crypto/phone-identity'

export const CONTACT_PHONE_CHANGE_COOLDOWN_MS = 24 * 60 * 60 * 1000

/** 规范化后的号码变了才记变更时间。只改空格或横线不算改号。 */
export function contactPhoneAssignment(
  current: string | null | undefined,
  submitted: string | null,
  now: Date = new Date(),
): { contactPhone: string | null; contactPhoneChangedAt?: Date } {
  if (normalizePhone(current ?? '') !== normalizePhone(submitted ?? '')) {
    return { contactPhone: submitted, contactPhoneChangedAt: now }
  }
  return { contactPhone: submitted }
}

/** 满 24 小时整可以登记；不满 24 小时不行。从未记过变更时间则不拦截。 */
export function contactPhoneRecentlyChanged(changedAt: Date | null | undefined, now: Date): boolean {
  if (!changedAt) return false
  return now.getTime() - changedAt.getTime() < CONTACT_PHONE_CHANGE_COOLDOWN_MS
}
