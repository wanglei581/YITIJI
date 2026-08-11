const configuredBaseUrl = (import.meta.env['VITE_TERMINAL_AGENT_LOCAL_URL'] ?? '').trim()
export const LOCAL_AGENT_BASE_URL = (configuredBaseUrl || 'http://127.0.0.1:9527').replace(/\/+$/, '')

const STATIC_BRIDGE_TOKEN = (import.meta.env['VITE_TERMINAL_AGENT_BRIDGE_TOKEN'] ?? '').trim()
const SESSION_REFRESH_BUFFER_MS = 10_000

interface BridgeSessionEnvelope {
  success: true
  data: {
    token: string
    expiresInSeconds: number
  }
}

let sessionToken = ''
let sessionExpiresAt = 0
let pendingSession: Promise<string> | null = null

export function isLocalAgentBridgeAvailable(): boolean {
  return true
}

/**
 * Call a protected loopback route with backwards compatibility:
 * existing terminals may keep using the build-time static token, while a new
 * Agent can issue an Origin-bound five-minute session without MSI credentials.
 */
export async function fetchProtectedLocalAgent(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = currentToken() || await issueSession()
  let response = await fetchWithToken(path, init, token)
  if (response.status !== 403 || !(await isBridgeTokenRejection(response))) return response

  sessionToken = ''
  sessionExpiresAt = 0
  const refreshed = await issueSession()
  response = await fetchWithToken(path, init, refreshed)
  return response
}

function currentToken(): string {
  if (sessionToken && Date.now() + SESSION_REFRESH_BUFFER_MS < sessionExpiresAt) return sessionToken
  return STATIC_BRIDGE_TOKEN
}

async function issueSession(): Promise<string> {
  if (pendingSession) return pendingSession
  pendingSession = (async () => {
    const response = await fetch(`${LOCAL_AGENT_BASE_URL}/local/bridge/session`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`LOCAL_BRIDGE_SESSION_FAILED:${response.status}`)
    const envelope = (await response.json()) as BridgeSessionEnvelope
    const token = envelope.data?.token?.trim()
    const ttl = envelope.data?.expiresInSeconds
    if (!token || !Number.isFinite(ttl) || ttl <= 0) throw new Error('LOCAL_BRIDGE_SESSION_INVALID')
    sessionToken = token
    sessionExpiresAt = Date.now() + ttl * 1000
    return token
  })().finally(() => {
    pendingSession = null
  })
  return pendingSession
}

function fetchWithToken(path: string, init: RequestInit, token: string): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('X-Local-Bridge-Token', token)
  return fetch(`${LOCAL_AGENT_BASE_URL}${path}`, { ...init, headers })
}

async function isBridgeTokenRejection(response: Response): Promise<boolean> {
  try {
    const payload = (await response.clone().json()) as { error?: { code?: string } }
    return /^LOCAL_(?:QR|USB|PRINT)_BRIDGE_TOKEN_INVALID$/.test(payload.error?.code ?? '')
  } catch {
    return false
  }
}
