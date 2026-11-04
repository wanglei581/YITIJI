/**
 * 到机码认领被免费额度拒绝时，屏上给哪一种出口。
 *
 * 判据只看错误码，不看文案：
 * - login：游客单次额度。登录后按会员额度再认领同一单，主按钮「去登录」。
 * - wait：这台机器今天的额度，或本人今天的额度。登录也过不了，不给「去登录」。
 * 文案仍用 userErrorMessage 里已有的原话，不在这里另写一句。
 */

const LOGIN_AFTER_QUOTA = new Set(['PRINT_GUEST_ORDER_QUOTA_EXCEEDED'])

const WAIT_UNTIL_RESET = new Set([
  'PRINT_TERMINAL_DAILY_QUOTA_REACHED',
  'PRINT_MEMBER_DAILY_QUOTA_REACHED',
])

export type PickupQuotaExit = 'login' | 'wait'

export function pickupQuotaExit(code: string | null | undefined): PickupQuotaExit | null {
  if (!code) return null
  if (LOGIN_AFTER_QUOTA.has(code)) return 'login'
  if (WAIT_UNTIL_RESET.has(code)) return 'wait'
  return null
}

/** 这些码给主按钮「去登录」。机器日额度、会员日额度不在里面。 */
export function pickupQuotaOffersLogin(code: string | null | undefined): boolean {
  return pickupQuotaExit(code) === 'login'
}
