/**
 * Persistent auth latch for revoked / invalid terminal credentials.
 *
 * When the API returns 401, the Agent cannot truthfully report a cloud
 * "unauthorized" heartbeat status (that call itself is rejected). Instead we
 * latch locally and stop claiming / printing / offline retries.
 *
 * Sticky across process / host restarts until a successful re-bind persists a
 * replacement credential. The marker contains no credential material.
 *
 * Diagnostic write is done by callers (avoids import cycles with config-manager).
 */

import fs from 'fs'
import os from 'os'
import path from 'path'

let markerPathOverride: string | undefined

export function getUnauthorizedMarkerPath(): string {
  if (markerPathOverride) return markerPathOverride
  const base = process.env['PROGRAMDATA']
    ? path.join(process.env['PROGRAMDATA'], 'AIJobPrintAgent')
    : path.join(os.tmpdir(), 'AIJobPrintAgent')
  return path.join(base, 'agent.unauthorized')
}

function readPersistedUnauthorized(): boolean {
  return fs.existsSync(getUnauthorizedMarkerPath())
}

let unauthorized = readPersistedUnauthorized()

export function isUnauthorized(): boolean {
  return unauthorized
}

export function markUnauthorized(): boolean {
  unauthorized = true
  const markerPath = getUnauthorizedMarkerPath()
  try {
    fs.mkdirSync(path.dirname(markerPath), { recursive: true })
    fs.writeFileSync(
      markerPath,
      `${JSON.stringify({ schemaVersion: 1, state: 'unauthorized', recordedAt: new Date().toISOString() })}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    )
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EEXIST'
  }
}

export function clearUnauthorized(): void {
  fs.rmSync(getUnauthorizedMarkerPath(), { force: true })
  unauthorized = false
}

/** Test-only marker override + reload to simulate a fresh process. */
export function __setUnauthorizedMarkerPathForTests(filePath?: string): void {
  markerPathOverride = filePath
  unauthorized = readPersistedUnauthorized()
}

/** Test-only cleanup so verifies can isolate cases. */
export function __resetUnauthorizedForTests(removePersisted = false): void {
  if (removePersisted) fs.rmSync(getUnauthorizedMarkerPath(), { force: true })
  unauthorized = readPersistedUnauthorized()
}
