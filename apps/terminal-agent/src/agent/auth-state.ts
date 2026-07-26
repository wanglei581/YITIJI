/**
 * Process-local auth latch for revoked / invalid terminal credentials.
 *
 * When the API returns 401, the Agent cannot truthfully report a cloud
 * "unauthorized" heartbeat status (that call itself is rejected). Instead we
 * latch locally and stop claiming / printing / offline retries.
 *
 * Sticky until process restart after a successful re-bind (BindCode exchange /
 * persistRegistration). Never logs tokens.
 *
 * Diagnostic write is done by callers (avoids import cycles with config-manager).
 */

let unauthorized = false

export function isUnauthorized(): boolean {
  return unauthorized
}

export function markUnauthorized(): void {
  unauthorized = true
}

export function clearUnauthorized(): void {
  unauthorized = false
}

/** Test-only reset so verifies can isolate cases without process restart. */
export function __resetUnauthorizedForTests(): void {
  unauthorized = false
}
