import { getTerminalId } from '../api/screensaver'

const BROWSER_DEVICE_ID_STORAGE_KEY = 'ai-job-print:member-auth-device-id'
let cachedBrowserDeviceId: string | null = null

function randomDeviceId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()
  if (cryptoApi?.getRandomValues) {
    const values = new Uint32Array(2)
    cryptoApi.getRandomValues(values)
    return `${values[0].toString(36)}${values[1].toString(36)}`
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

function normalizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
}

function getBrowserDeviceId(): string {
  if (cachedBrowserDeviceId) return cachedBrowserDeviceId

  try {
    const stored = window.localStorage.getItem(BROWSER_DEVICE_ID_STORAGE_KEY)
    const normalized = stored ? normalizeSegment(stored) : ''
    if (normalized) {
      cachedBrowserDeviceId = normalized
      return cachedBrowserDeviceId
    }
  } catch {
    // localStorage may be unavailable in privacy modes; fall back to per-tab stability.
  }

  cachedBrowserDeviceId = normalizeSegment(randomDeviceId()) || 'unknown'
  try {
    window.localStorage.setItem(BROWSER_DEVICE_ID_STORAGE_KEY, cachedBrowserDeviceId)
  } catch {
    // Best-effort persistence only. The value remains stable for the current tab.
  }

  return cachedBrowserDeviceId
}

/**
 * 短信登录频控用设备标识。
 * 只用于风控计数，不承载会员身份；公共终端上保持稳定，确保后端设备级频控有效。
 */
export function getMemberAuthDeviceId(): string {
  const terminalId = normalizeSegment(getTerminalId())
  return terminalId ? `kiosk:${terminalId}` : `browser:${getBrowserDeviceId()}`
}
