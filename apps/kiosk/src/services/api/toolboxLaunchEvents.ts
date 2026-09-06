import type { RecordToolboxLaunchEventInput } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'
import { getTerminalId } from './screensaver'
import { terminalProtectedFetch } from '../terminalAuth'

function endpoint(): string | null {
  if (API_MODE !== 'http') return null
  const terminalId = getTerminalId()
  if (!terminalId) return null
  return new URL(
    `${API_BASE_URL}/terminals/${encodeURIComponent(terminalId)}/toolbox-events`,
    window.location.origin,
  ).toString()
}

export function recordToolboxLaunchEvent(input: RecordToolboxLaunchEventInput): void {
  const url = endpoint()
  if (!url) return
  void terminalProtectedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'omit',
    body: JSON.stringify(input),
  }).catch(() => {
    /* fire-and-forget telemetry must not block kiosk workflows */
  })
}

export function recordToolboxLaunchEventBeforeUnload(input: RecordToolboxLaunchEventInput): void {
  const url = endpoint()
  if (!url) return
  const payload = JSON.stringify(input)
  // sendBeacon cannot carry the terminal session token. Keepalive fetch preserves
  // the same protected transport even during navigation.
  void terminalProtectedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'omit',
    body: payload,
    keepalive: true,
  }).catch(() => {
    /* redirect continues even if telemetry is unavailable */
  })
}
