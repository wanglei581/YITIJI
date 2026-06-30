import type { KioskTerminalConfig } from '@ai-job-print/shared'
import { DEFAULT_SMART_CAMPUS_MODULES } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'
import { ApiHttpError } from './httpAdapter'
import { getTerminalId } from './screensaver'

const OFF_CONFIG: KioskTerminalConfig = {
  smartCampus: { enabled: false, modules: { ...DEFAULT_SMART_CAMPUS_MODULES }, items: [] },
  toolbox: { enabled: true, items: [] },
  configVersion: 'mock-off',
  refreshIntervalMs: 5 * 60 * 1000,
  serverTime: new Date(0).toISOString(),
}

const DEFAULT_CACHE_TTL_MS = 30_000
let cachedTerminalId: string | null = null
let cachedConfig: KioskTerminalConfig | null = null
let cachedAt = 0
let inflightTerminalId: string | null = null
let inflight: Promise<KioskTerminalConfig> | null = null

export async function getKioskTerminalConfig(terminalId: string): Promise<KioskTerminalConfig> {
  if (API_MODE !== 'http') return { ...OFF_CONFIG, serverTime: new Date().toISOString() }

  const url = new URL(
    `${API_BASE_URL}/terminals/${encodeURIComponent(terminalId)}/config`,
    window.location.origin,
  )
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  })
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      /* non-JSON */
    }
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<KioskTerminalConfig>
}

export async function getCachedKioskTerminalConfig(
  terminalId: string,
  maxAgeMs = DEFAULT_CACHE_TTL_MS,
): Promise<KioskTerminalConfig> {
  const now = Date.now()
  if (cachedConfig && cachedTerminalId === terminalId && now - cachedAt <= maxAgeMs) {
    return cachedConfig
  }
  if (inflight && inflightTerminalId === terminalId) return inflight

  inflightTerminalId = terminalId
  inflight = getKioskTerminalConfig(terminalId)
    .then((config) => {
      cachedTerminalId = terminalId
      cachedConfig = config
      cachedAt = Date.now()
      return config
    })
    .finally(() => {
      inflight = null
      inflightTerminalId = null
    })
  return inflight
}

export { getTerminalId }
