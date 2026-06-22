type MemberSessionExpiredListener = (failedToken?: string) => void

const SESSION_INVALID_CODES = new Set([
  'ACCOUNT_DISABLED',
  'MEMBER_SESSION_EXPIRED',
  'MEMBER_TOKEN_INVALID',
  'MEMBER_MISSING_TOKEN',
])

const listeners = new Set<MemberSessionExpiredListener>()
let lastNotifiedAt = 0

export function isMemberSessionInvalidError(status: number, code: string | undefined, usedMemberToken: boolean): boolean {
  if (!usedMemberToken) return false
  return status === 401 || (code !== undefined && SESSION_INVALID_CODES.has(code))
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
