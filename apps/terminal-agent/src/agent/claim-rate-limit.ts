const CLAIM_BACKOFF_BASE_MS = 5_000
const CLAIM_BACKOFF_MAX_MS = 60_000
/** Upper bound for a server-supplied Retry-After; a misconfigured header must not park the Agent for hours. */
const CLAIM_RETRY_AFTER_CAP_MS = 5 * 60_000

export interface ClaimPauseDecision {
  consecutive429: number
  pauseMs: number
  pausedUntil: number
}

/** Pure claim rate-limit transition used by the runtime and reliability gate. */
export function computeClaimPause(
  status: number | undefined,
  retryAfterHeader: unknown,
  consecutive429: number,
  now: number,
  jitterMs: number,
): ClaimPauseDecision {
  if (status !== 429) {
    return { consecutive429: 0, pauseMs: 0, pausedUntil: 0 }
  }

  const nextConsecutive429 = Math.max(0, Math.floor(consecutive429)) + 1
  const fallbackMs = Math.min(
    CLAIM_BACKOFF_MAX_MS,
    CLAIM_BACKOFF_BASE_MS * (2 ** Math.min(nextConsecutive429 - 1, 4)),
  )
  const header = Array.isArray(retryAfterHeader) ? retryAfterHeader[0] : retryAfterHeader
  const value = typeof header === 'string' || typeof header === 'number'
    ? String(header).trim()
    : ''
  let requestedMs: number | undefined
  if (/^\d+$/.test(value)) {
    requestedMs = Number(value) * 1_000
  } else if (value) {
    const retryAt = Date.parse(value)
    if (Number.isFinite(retryAt)) requestedMs = Math.max(0, retryAt - now)
  }
  const boundedJitterMs = Math.min(1_000, Math.max(0, Math.floor(jitterMs)))
  // A Retry-After that already elapsed (clock skew, or a date in the past) carries no
  // information: fall back to exponential backoff instead of pausing for jitter only.
  const boundedRequestedMs = requestedMs !== undefined && requestedMs > 0
    ? Math.min(CLAIM_RETRY_AFTER_CAP_MS, requestedMs)
    : undefined
  const pauseMs = (boundedRequestedMs ?? fallbackMs) + boundedJitterMs
  return {
    consecutive429: nextConsecutive429,
    pauseMs,
    pausedUntil: now + pauseMs,
  }
}
