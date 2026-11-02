import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PublicKioskProfile } from '@ai-job-print/shared'
import { useKioskProfile } from './api/kioskProfile'
import {
  recheckTerminalSessionAfterLicensePause, subscribeTerminalLicenseRenewalRejected,
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
      endsAt: verified ? profile.currentSessionEndsAt : previous.endsAt,
      notice: verified ? profile.noticeLine : previous.notice,
    }
  }
  if (next.mode === 'winding-down') {
    const deadline = next.endsAt === null ? NaN : Date.parse(next.endsAt)
    if (useEnded || sessionState === 'failed' || (Number.isFinite(deadline) && now >= deadline)) {
      next = { ...next, mode: 'paused' }
    }
  }
  return next
}

export const LICENSE_RECHECK_INTERVAL_MS = 5 * 60_000

/** 停止计时不重置上次尝试时间；即使重新挂载也不会缩短两次间隔。 */
export function createLicenseRecheckTimer(
  recheck: () => Promise<void>,
  clock: { now: () => number; set: (fn: () => void, delay: number) => ReturnType<typeof setTimeout>; clear: (id: ReturnType<typeof setTimeout>) => void },
) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastAttempt: number | null = null
  let active = false
  let inFlight = false
  function schedule(): void {
    if (!active || timer !== null || inFlight) return
    const delay = lastAttempt === null ? LICENSE_RECHECK_INTERVAL_MS : Math.max(0, lastAttempt + LICENSE_RECHECK_INTERVAL_MS - clock.now())
    timer = clock.set(() => {
      timer = null
      if (!active) return
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
const recheckTimer = createLicenseRecheckTimer(() => {
  const deadline = recheckEndsAt === null ? NaN : Date.parse(recheckEndsAt)
  return recheckTerminalSessionAfterLicensePause({ credentialExpired: Number.isFinite(deadline) && Date.now() >= deadline })
}, {
  now: () => Date.now(), set: (fn, delay) => setTimeout(fn, delay), clear: (id) => clearTimeout(id),
})

/** useEnded 由统一的结束使用 / 清场链路提供。 */
export function useKioskLicenseGate(useEnded: boolean): KioskLicenseGate {
  const profile = useKioskProfile()
  const sessionState = useSyncExternalStore(subscribeTerminalSession, terminalSessionState, terminalSessionState)
  const rejected = useSyncExternalStore(subscribeTerminalLicenseRenewalRejected, wasTerminalLicenseRenewalRejected, wasTerminalLicenseRenewalRejected)
  const [gate, setGate] = useState(INITIAL_KIOSK_LICENSE_GATE)
  const [now, setNow] = useState(() => Date.now())
  const seenProfile = useRef<PublicKioskProfile | null>(null)
  const seenRejection = useRef(false)
  const needsRecheck = gate.mode !== 'normal'

  useEffect(() => { recheckEndsAt = gate.endsAt }, [gate.endsAt])

  useEffect(() => {
    const freshProfile = seenProfile.current === profile ? null : profile
    seenProfile.current = profile
    const newRejection = rejected && !seenRejection.current
    seenRejection.current = rejected
    setGate((previous) => decideKioskLicenseGate(previous, { profile: freshProfile, rejected: newRejection, now: Date.now(), sessionState, useEnded }))
  }, [profile, rejected, sessionState, useEnded, now])

  useEffect(() => {
    if (!needsRecheck) return
    recheckTimer.start()
    return () => recheckTimer.stop()
  }, [needsRecheck])

  useEffect(() => {
    if (gate.mode !== 'winding-down' || gate.endsAt === null) return
    const deadline = Date.parse(gate.endsAt)
    if (!Number.isFinite(deadline)) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, deadline - Date.now()))
    return () => clearTimeout(timer)
  }, [gate.mode, gate.endsAt])
  return gate
}
