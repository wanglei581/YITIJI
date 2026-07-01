import type { RecordToolboxLaunchEventInput } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'
import { getTerminalId } from './screensaver'

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
  void fetch(url, {
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
  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const sent = navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))
    if (sent) return
  }
  void fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'omit',
    body: payload,
    keepalive: true,
  }).catch(() => {
    /* redirect continues even if telemetry is unavailable */
  })
}
