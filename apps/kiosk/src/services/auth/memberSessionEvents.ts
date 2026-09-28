type MemberSessionExpiredListener = (failedToken?: string) => void

const SESSION_INVALID_CODES = new Set([
  'ACCOUNT_DISABLED',
  'MEMBER_SESSION_EXPIRED',
  'MEMBER_TOKEN_INVALID',
  'MEMBER_MISSING_TOKEN',
])

/**
 * 已登录会员做二次验证、换绑手机号时，验证码错、过期、锁定也回 401，但登录本身仍然有效：
 * 只让这一步重来（换绑面板会要求重新验证旧手机号），不清场、不回登录页。
 * 2026-09-28 之前任何 401 都清场，换绑时新号验证码填错一位就被整个登出。
 * 只放行这几条明确的「本步失败」码；没有码或码不认识的 401 照旧清场 —— 公共终端宁可多清一次。
 */
const STEP_FAILURE_CODES = new Set([
  'STEP_UP_CHALLENGE_INVALID',
  'STEP_UP_CODE_INVALID',
  'STEP_UP_TOKEN_INVALID',
  'REBIND_CODE_INVALID',
  'REBIND_CODE_EXPIRED',
  'REBIND_CODE_LOCKED',
])

const listeners = new Set<MemberSessionExpiredListener>()
let lastNotifiedAt = 0

export function isMemberSessionInvalidError(status: number, code: string | undefined, usedMemberToken: boolean): boolean {
  if (!usedMemberToken) return false
  if (code !== undefined && SESSION_INVALID_CODES.has(code)) return true
  if (code !== undefined && STEP_FAILURE_CODES.has(code)) return false
  return status === 401
}

export function notifyMemberSessionExpired(failedToken?: string): void {
  const now = Date.now()
  if (now - lastNotifiedAt < 300) return
  lastNotifiedAt = now
  for (const listener of listeners) listener(failedToken)
}

export function onMemberSessionExpired(listener: MemberSessionExpiredListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
