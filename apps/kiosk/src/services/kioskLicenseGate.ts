import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PublicKioskProfile } from '@ai-job-print/shared'
import { useKioskProfile } from './api/kioskProfile'
import {
  lastTerminalRenewalAttemptAt, recheckTerminalSessionAfterLicensePause, setLicenseRenewalSuspended, subscribeTerminalLicenseRenewalRejected,
  subscribeTerminalSession, terminalSessionState, wasTerminalLicenseRenewalRejected,
  type TerminalSessionState,
} from './terminalAuth'

export type KioskLicenseMode = 'normal' | 'winding-down' | 'paused'
export interface KioskLicenseGate { mode: KioskLicenseMode; endsAt: string | null; notice: string | null }
export interface KioskLicenseGateInput {
  profile: PublicKioskProfile | null
  rejected: boolean
  now: number
  sessionState: TerminalSessionState
  useEnded: boolean
}
export const INITIAL_KIOSK_LICENSE_GATE: KioskLicenseGate = { mode: 'normal', endsAt: null, notice: null }
// 与服务端 terminal-session 的 SESSION_TTL_SECONDS（30 分钟）对齐。
export const LICENSE_UNKNOWN_DEADLINE_GRACE_MS = 30 * 60_000
const PAUSED_STORAGE_KEY = 'kiosk_license_paused_v1'
const WIND_DOWN_STORAGE_KEY = 'kiosk_license_winddown_v1'
export interface StoredWindDown { service: string | null; endsAt: string | null }

export function loadStoredWindDown(): StoredWindDown | null {
  try {
    const raw = window.localStorage.getItem(WIND_DOWN_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw)
    if ((typeof value.service !== 'string' && value.service !== null) ||
        (value.endsAt !== null && (typeof value.endsAt !== 'string' || !Number.isFinite(Date.parse(value.endsAt))))) return null
    return { service: value.service, endsAt: value.endsAt }
  } catch { return null }
}
export function saveStoredWindDown(value: StoredWindDown): void {
  try { window.localStorage.setItem(WIND_DOWN_STORAGE_KEY, JSON.stringify(value)) } catch { /* storage unavailable */ }
}

export function loadInitialLicenseGate(): KioskLicenseGate {
  try { if (window.localStorage.getItem(PAUSED_STORAGE_KEY) === '1') return { ...INITIAL_KIOSK_LICENSE_GATE, mode: 'paused' } } catch { /* storage unavailable */ }
  const stored = loadStoredWindDown()
  return stored ? { ...INITIAL_KIOSK_LICENSE_GATE, mode: 'winding-down', endsAt: stored.endsAt } : INITIAL_KIOSK_LICENSE_GATE
}

export function persistLicenseGate(gate: KioskLicenseGate, profile: PublicKioskProfile | null): void {
  try {
    if (gate.mode === 'paused') window.localStorage.setItem(PAUSED_STORAGE_KEY, '1')
    else if (profile && profile.licenseState !== null && profile.acceptsNewSessions) {
      window.localStorage.removeItem(PAUSED_STORAGE_KEY)
      window.localStorage.removeItem(WIND_DOWN_STORAGE_KEY)
    } else if (gate.mode === 'winding-down') {
      const stored = loadStoredWindDown()
      if (stored) saveStoredWindDown({ ...stored, endsAt: gate.endsAt })
    }
  } catch { /* storage unavailable */ }
}

/** profile 只传新收到的响应；null 表示没有新证据。 */
export function decideKioskLicenseGate(previous: KioskLicenseGate, input: KioskLicenseGateInput): KioskLicenseGate {
  const { profile, rejected, now, sessionState, useEnded } = input
  const verified = profile != null && profile.licenseState !== null
  if (verified && profile.acceptsNewSessions) {
    return { mode: 'normal', endsAt: profile.currentSessionEndsAt, notice: profile.noticeLine }
  }
  let next = previous
  if ((verified && !profile.acceptsNewSessions) || rejected) {
    next = {
      mode: previous.mode === 'paused' ? 'paused' : 'winding-down',
      endsAt: (verified ? profile.currentSessionEndsAt : null) ??
        (verified && previous.mode !== 'winding-down' ? null : previous.endsAt) ?? new Date(now + LICENSE_UNKNOWN_DEADLINE_GRACE_MS).toISOString(),
      notice: verified ? profile.noticeLine : previous.notice,
    }
  }
  if (next.mode === 'winding-down') {
    const deadline = next.endsAt === null ? NaN : Date.parse(next.endsAt)
    if (useEnded || (sessionState === 'failed' && rejected) || (Number.isFinite(deadline) && now >= deadline)) {
      next = { ...next, mode: 'paused' }
    }
  }
  return next
}

export const LICENSE_RECHECK_INTERVAL_MS = 5 * 60_000

/** 停止计时不重置上次尝试时间；即使重新挂载也不会缩短两次间隔。 */
export function createLicenseRecheckTimer(
  recheck: () => Promise<void>,
  clock: { now: () => number; set: (fn: () => void, delay: number) => ReturnType<typeof setTimeout>; clear: (id: ReturnType<typeof setTimeout>) => void; lastExternalAttempt?: () => number | null },
) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastAttempt: number | null = null
  let active = false
  let inFlight = false
  function latestAttempt(): number | null {
    const external = clock.lastExternalAttempt?.() ?? null
    return lastAttempt === null ? external : external === null ? lastAttempt : Math.max(lastAttempt, external)
  }
  function schedule(): void {
    if (!active || timer !== null || inFlight) return
    const latest = latestAttempt()
    const delay = latest === null ? LICENSE_RECHECK_INTERVAL_MS : Math.max(0, latest + LICENSE_RECHECK_INTERVAL_MS - clock.now())
    timer = clock.set(() => {
      timer = null
      if (!active) return
      const latest = latestAttempt()
      if (latest !== null && clock.now() < latest + LICENSE_RECHECK_INTERVAL_MS) { schedule(); return }
      lastAttempt = clock.now()
      inFlight = true
      void recheck().catch(() => undefined).finally(() => { inFlight = false; schedule() })
    }, delay)
  }
  return {
    start() { active = true; schedule() },
    stop() { active = false; if (timer !== null) clock.clear(timer); timer = null },
  }
}

let recheckEndsAt: string | null = null
let recheckSessionState: TerminalSessionState = 'checking'
export function licenseCredentialExpired(endsAt: string | null, sessionState: TerminalSessionState, now: number): boolean {
  const deadline = endsAt === null ? NaN : Date.parse(endsAt)
  return sessionState === 'failed' || !Number.isFinite(deadline) || now >= deadline
}
export function scheduleLicenseDeadline(deadline: number, onDeadline: () => void, clock: {
  now: () => number; set: (fn: () => void, delay: number) => ReturnType<typeof setTimeout>; clear: (id: ReturnType<typeof setTimeout>) => void
}): () => void {
  let timer: ReturnType<typeof setTimeout>
  const check = () => {
    const remaining = deadline - clock.now()
    if (remaining > 0) timer = clock.set(check, remaining + 50)
    else onDeadline()
  }
  timer = clock.set(check, Math.max(0, deadline - clock.now()))
  return () => clock.clear(timer)
}
const recheckTimer = createLicenseRecheckTimer(() => {
  return recheckTerminalSessionAfterLicensePause({ credentialExpired: licenseCredentialExpired(recheckEndsAt, recheckSessionState, Date.now()) })
}, {
  now: () => Date.now(), set: (fn, delay) => setTimeout(fn, delay), clear: (id) => clearTimeout(id),
  lastExternalAttempt: lastTerminalRenewalAttemptAt,
})

/** useEnded 由统一的结束使用 / 清场链路提供。 */
export function useKioskLicenseGate(useEnded: boolean): KioskLicenseGate {
  const profile = useKioskProfile()
  const sessionState = useSyncExternalStore(subscribeTerminalSession, terminalSessionState, terminalSessionState)
  const rejected = useSyncExternalStore(subscribeTerminalLicenseRenewalRejected, wasTerminalLicenseRenewalRejected, wasTerminalLicenseRenewalRejected)
  const [gate, setGate] = useState(loadInitialLicenseGate)
  const [now, setNow] = useState(() => Date.now())
  const seenProfile = useRef<PublicKioskProfile | null>(null)

  useEffect(() => { recheckEndsAt = gate.endsAt; recheckSessionState = sessionState }, [gate.endsAt, sessionState])

  useEffect(() => {
    const freshProfile = seenProfile.current === profile ? null : profile
    seenProfile.current = profile
    setGate((previous) => {
      const next = decideKioskLicenseGate(previous, { profile: freshProfile, rejected, now: Date.now(), sessionState, useEnded })
      persistLicenseGate(next, freshProfile)
      return next
    })
  }, [profile, rejected, sessionState, useEnded, now])

  useEffect(() => {
    setLicenseRenewalSuspended(gate.mode !== 'normal')
    // 收尾中的凭证仍可用，profile 可发现恢复；复查换票会清场，打断正在办理的人。
    if (gate.mode !== 'paused') return
    recheckTimer.start()
    return () => recheckTimer.stop()
  }, [gate.mode])

  useEffect(() => {
    if (gate.mode !== 'winding-down' || gate.endsAt === null) return
    const deadline = Date.parse(gate.endsAt)
    if (!Number.isFinite(deadline)) return
    return scheduleLicenseDeadline(deadline, () => setNow(Date.now()), {
      now: () => Date.now(), set: (fn, delay) => setTimeout(fn, delay), clear: (id) => clearTimeout(id),
    })
  }, [gate.mode, gate.endsAt])
  return gate
}
