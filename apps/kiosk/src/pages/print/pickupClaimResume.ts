/**
 * 登录后接着认领同一单用的到机码。
 *
 * 到机码是这一单的凭据：只放 sessionStorage，不放网址、不进 history。
 * 「结束使用」清场走 kioskSensitiveSession，会调 clearPickupClaimCode。
 * 本文件不 import 其它模块，清场门禁才能把它当叶子转译。
 */

export const PICKUP_CLAIM_RESUME_KEY = 'ai-job-print:pickup-claim-resume'

export function rememberPickupClaimCode(code: string): void {
  try {
    sessionStorage.setItem(PICKUP_CLAIM_RESUME_KEY, code)
  } catch {
    // 写不进就没有自动接着认领；回来后还可以再输一次。
  }
}

export function readPickupClaimCode(): string | null {
  try {
    const value = sessionStorage.getItem(PICKUP_CLAIM_RESUME_KEY)
    return value && value.length > 0 ? value : null
  } catch {
    return null
  }
}

export function clearPickupClaimCode(): void {
  try {
    sessionStorage.removeItem(PICKUP_CLAIM_RESUME_KEY)
  } catch {
    // 存储不可用时本来也没有这串码。
  }
}
