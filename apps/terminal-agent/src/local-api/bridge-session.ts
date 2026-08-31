import { createHash, randomBytes } from 'crypto'

const DEFAULT_SESSION_TTL_SECONDS = 5 * 60
const MAX_ACTIVE_SESSIONS = 32

interface StoredSession {
  origin: string
  expiresAt: number
}

export interface LocalBridgeSession {
  token: string
  expiresInSeconds: number
}

export interface LocalBridgeSessionStore {
  issue(origin: string): LocalBridgeSession
  validate(headerValue: string | string[] | undefined, origin: string): boolean
}

/**
 * Short-lived, process-local browser credential for protected loopback routes.
 *
 * The credential is returned only after the request Origin passes the Agent's
 * exact allowlist. Only a SHA-256 digest is retained in memory, it is bound to
 * that Origin, and it disappears on Agent restart. This lets a newly provisioned
 * terminal work without baking a fleet-wide bridge secret into either the MSI
 * or the public Kiosk bundle.
 */
export function createLocalBridgeSessionStore(
  ttlSeconds = DEFAULT_SESSION_TTL_SECONDS,
): LocalBridgeSessionStore {
  const sessions = new Map<string, StoredSession>()

  function cleanup(now: number): void {
    for (const [digest, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(digest)
    }
    while (sessions.size >= MAX_ACTIVE_SESSIONS) {
      const oldest = sessions.keys().next().value as string | undefined
      if (!oldest) break
      sessions.delete(oldest)
    }
  }

  return {
    issue(origin) {
      const now = Date.now()
      cleanup(now)
      const token = randomBytes(32).toString('base64url')
      sessions.set(digestToken(token), {
        origin,
        expiresAt: now + ttlSeconds * 1000,
      })
      return { token, expiresInSeconds: ttlSeconds }
    },

    validate(headerValue, origin) {
      const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue
      if (!provided) return false
      const now = Date.now()
      cleanup(now)
      const stored = sessions.get(digestToken(provided))
      return Boolean(stored && stored.origin === origin && stored.expiresAt > now)
    },
  }
}

function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
