import type { KioskTerminalConfig } from '@ai-job-print/shared'
import { DEFAULT_SMART_CAMPUS_MODULES } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'
import { ApiHttpError } from './httpAdapter'
import { getTerminalId } from './screensaver'

const OFF_CONFIG: KioskTerminalConfig = {
  smartCampus: { enabled: false, modules: { ...DEFAULT_SMART_CAMPUS_MODULES } },
  configVersion: 'mock-off',
  refreshIntervalMs: 5 * 60 * 1000,
  serverTime: new Date(0).toISOString(),
}

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

export { getTerminalId }
