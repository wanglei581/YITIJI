// ============================================================
// Screensaver Service — 待机宣传屏
//
// 根据 API_MODE 选择适配器:
//   API_MODE=mock → screensaverMockAdapter(无后端,返回 enabled:false)
//   API_MODE=http → screensaverHttpAdapter(真实 /terminals/:id/screensaver)
// ============================================================

import type { KioskScreensaverPlaylist } from '@ai-job-print/shared'
import { API_MODE } from './client'
import { screensaverHttpAdapter } from './screensaverHttpAdapter'
import { screensaverMockAdapter } from './screensaverMockAdapter'

const configuredLocalAgentBaseUrl = (import.meta.env['VITE_TERMINAL_AGENT_LOCAL_URL'] ?? '').trim()
const LOCAL_AGENT_BASE_URL = configuredLocalAgentBaseUrl || 'http://127.0.0.1:9527'
const IDENTITY_TIMEOUT_MS = 2_000
const IDENTITY_RETRY_DELAY_MS = 3_000
const IDENTITY_MONITOR_DELAY_MS = 30_000
const TERMINAL_ID_RE = /^[A-Za-z0-9_-]{1,128}$/

interface LocalTerminalIdentity {
  terminalId: string
  terminalCode: string
}

interface LocalTerminalIdentityEnvelope {
  success: boolean
  data?: LocalTerminalIdentity
}

let resolvedIdentity: LocalTerminalIdentity | null = null
let identityInitialization: Promise<void> | null = null
let identityRetryTimer: number | null = null
const identityListeners = new Set<() => void>()

export interface ScreensaverServiceInterface {
  getPlaylist(terminalId: string): Promise<KioskScreensaverPlaylist>
}

const adapter: ScreensaverServiceInterface =
  API_MODE === 'http' ? screensaverHttpAdapter : screensaverMockAdapter

export const getScreensaverPlaylist = (terminalId: string): Promise<KioskScreensaverPlaylist> =>
  adapter.getPlaylist(terminalId)

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function validIdentity(value: unknown): value is LocalTerminalIdentity {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LocalTerminalIdentity>
  const terminalCode = candidate.terminalCode
  return (
    typeof candidate.terminalId === 'string' &&
    TERMINAL_ID_RE.test(candidate.terminalId) &&
    typeof terminalCode === 'string' &&
    terminalCode.length > 0 &&
    terminalCode.length <= 128 &&
    terminalCode === terminalCode.trim() &&
    !hasControlCharacters(terminalCode)
  )
}

async function loadLocalTerminalIdentity(): Promise<LocalTerminalIdentity | null> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), IDENTITY_TIMEOUT_MS)
  try {
    const response = await fetch(`${LOCAL_AGENT_BASE_URL}/local/terminal-identity`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return null
    const envelope = (await response.json()) as LocalTerminalIdentityEnvelope
    return envelope.success && validIdentity(envelope.data) ? envelope.data : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timeout)
  }
}

function setResolvedIdentity(identity: LocalTerminalIdentity): void {
  if (
    resolvedIdentity?.terminalId === identity.terminalId &&
    resolvedIdentity.terminalCode === identity.terminalCode
  ) {
    return
  }
  resolvedIdentity = identity
  identityListeners.forEach((listener) => listener())
}

/** Resolve once before React renders so every terminal-scoped request uses one identity. */
export function initializeTerminalIdentity(): Promise<void> {
  if (identityInitialization) return identityInitialization
  identityInitialization = loadLocalTerminalIdentity().then((identity) => {
    if (identity) {
      setResolvedIdentity(identity)
      return
    }

    // Build-time identity is retained only for `vite dev`; production kiosks
    // fail closed instead of silently routing another host's tasks.
    if (import.meta.env.DEV) {
      const fallbackId = (import.meta.env['VITE_TERMINAL_ID'] ?? '').trim()
      if (TERMINAL_ID_RE.test(fallbackId)) {
        setResolvedIdentity({ terminalId: fallbackId, terminalCode: fallbackId })
      }
    }
  })
  return identityInitialization
}

/** Recover late Agent startup and detect an explicit terminal rebind without manual refresh. */
export function startTerminalIdentityRecovery(): void {
  if (identityRetryTimer !== null) return
  const delay = resolvedIdentity ? IDENTITY_MONITOR_DELAY_MS : IDENTITY_RETRY_DELAY_MS
  identityRetryTimer = window.setTimeout(() => {
    identityRetryTimer = null
    void loadLocalTerminalIdentity().then((identity) => {
      if (identity) setResolvedIdentity(identity)
      startTerminalIdentityRecovery()
    })
  }, delay)
}

export function subscribeTerminalIdentity(listener: () => void): () => void {
  identityListeners.add(listener)
  return () => identityListeners.delete(listener)
}

/** Empty means this browser has no verified local terminal identity. */
export const getTerminalId = (): string => resolvedIdentity?.terminalId ?? ''

export const getTerminalCode = (): string => resolvedIdentity?.terminalCode ?? ''
