import { createElement, useSyncExternalStore } from 'react'
import { DEFAULT_BRANDING_FILING, DEFAULT_BRAND_MARK, DEFAULT_BRAND_NAME, type PublicKioskProfile } from '@ai-job-print/shared'
import { subscribeTerminalSession } from '../terminalAuth'
import { API_BASE_URL } from './client'
import { getTerminalId, subscribeTerminalIdentity } from './screensaver'

const DEFAULT_PROFILE: PublicKioskProfile = {
  brandName: DEFAULT_BRAND_NAME, brandMark: DEFAULT_BRAND_MARK, logoUrl: null,
  filing: DEFAULT_BRANDING_FILING, location: null, licenseState: null,
  acceptsNewSessions: true, currentSessionMayContinue: false, currentSessionEndsAt: null, noticeLine: null,
}
let profile = DEFAULT_PROFILE
let generation = 0
const listeners = new Set<() => void>()

export function getKioskProfile(): PublicKioskProfile { return profile }
export function subscribeKioskProfile(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function useKioskProfile(): PublicKioskProfile {
  return useSyncExternalStore(subscribeKioskProfile, getKioskProfile, getKioskProfile)
}
function publish(next: PublicKioskProfile): void {
  if (JSON.stringify(profile) === JSON.stringify(next)) return
  profile = next
  listeners.forEach((listener) => listener())
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
function parseProfile(body: unknown): PublicKioskProfile | null {
  if (!body || typeof body !== 'object' || !('data' in body)) return null
  const data = body.data
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  if (typeof row.acceptsNewSessions !== 'boolean' || typeof row.currentSessionMayContinue !== 'boolean' ||
      ![null, 'ok', 'grace', 'inactive'].includes(row.licenseState as string | null) ||
      (row.currentSessionEndsAt !== null && typeof row.currentSessionEndsAt !== 'string') ||
      (row.noticeLine !== null && typeof row.noticeLine !== 'string')) return null
  const filing = row.filing && typeof row.filing === 'object' ? row.filing as Record<string, unknown> : {}
  const logo = text(row.logoUrl)
  return {
    brandName: text(row.brandName) ?? DEFAULT_BRAND_NAME,
    brandMark: text(row.brandMark) ?? DEFAULT_BRAND_MARK,
    logoUrl: logo && /^\/api\/v1\/public\/brand-logo\/[A-Za-z0-9_-]+$/.test(logo)
      ? new URL(logo, new URL(API_BASE_URL, window.location.origin).origin).href : null,
    filing: {
      icp: text(filing.icp) ?? DEFAULT_BRANDING_FILING.icp, icpUrl: text(filing.icpUrl) ?? DEFAULT_BRANDING_FILING.icpUrl,
      police: text(filing.police) ?? DEFAULT_BRANDING_FILING.police, policeUrl: text(filing.policeUrl) ?? DEFAULT_BRANDING_FILING.policeUrl,
    },
    location: text(row.location), licenseState: row.licenseState as PublicKioskProfile['licenseState'],
    acceptsNewSessions: row.acceptsNewSessions, currentSessionMayContinue: row.currentSessionMayContinue,
    currentSessionEndsAt: row.currentSessionEndsAt as string | null, noticeLine: row.noticeLine as string | null,
  }
}

/** 强制重新读取；失败保留当前终端上一次成功的结果。 */
export async function refreshKioskProfile(): Promise<PublicKioskProfile> {
  const requestGeneration = ++generation
  const terminalId = getTerminalId()
  let token: string | null = null
  try { token = window.sessionStorage.getItem('terminal_session_token_v1') } catch { /* storage unavailable */ }
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (terminalId) headers['x-terminal-id'] = terminalId
  if (token) headers['x-terminal-session-token'] = token
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`${API_BASE_URL}/public/kiosk-profile`, { headers, signal: controller.signal, cache: 'no-store' })
    if (response.ok) {
      const next = parseProfile(await response.json())
      if (next && generation === requestGeneration && terminalId === getTerminalId()) publish(next)
    }
  } catch { /* retain last success */ } finally { window.clearTimeout(timer) }
  return profile
}

export function startKioskProfileKeeper(): () => void {
  let terminalId = getTerminalId()
  void refreshKioskProfile()
  const timer = window.setInterval(() => { void refreshKioskProfile() }, 3 * 60 * 1000)
  const unsubscribeIdentity = subscribeTerminalIdentity(() => {
    const next = getTerminalId()
    if (next === terminalId) return
    terminalId = next
    generation++
    publish(DEFAULT_PROFILE)
    void refreshKioskProfile()
  })
  const unsubscribeSession = subscribeTerminalSession((state) => {
    if (state === 'ready' || state === 'failed') void refreshKioskProfile()
  })
  return () => { window.clearInterval(timer); unsubscribeIdentity(); unsubscribeSession(); generation++ }
}

/** 图标加载失败时保留字标。 */
export function kioskBrandMark(brand: PublicKioskProfile) {
  return createElement('span', { style: { display: 'flex', position: 'relative', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' } },
    brand.brandMark,
    brand.logoUrl && createElement('img', { key: brand.logoUrl, src: brand.logoUrl, alt: '', onError: (event: React.SyntheticEvent<HTMLImageElement>) => { event.currentTarget.style.display = 'none' }, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', borderRadius: 'inherit' } }),
  )
}
