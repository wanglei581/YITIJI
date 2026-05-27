/**
 * agent/registration.ts — Phase 8.1B
 *
 * Handles terminal registration with the backend:
 *   POST /auth/terminal/register
 *
 * On first startup (no terminalId/agentToken in config):
 *   1. Compute device fingerprint (SHA-256 of hostname + first non-internal MAC address)
 *   2. POST /auth/terminal/register with terminalCode + deviceFingerprint + adminSecret
 *   3. Persist terminalId + agentToken (= terminalToken) to config file
 *
 * On subsequent startups (terminalId/agentToken already in config):
 *   - Skip registration, use persisted credentials.
 *   - If heartbeat returns 401, the caller should re-register (not handled here in 8.1B).
 *
 * Security note:
 *   - adminSecret is only used once, but stays in the config file.
 *     Production hardening: clear adminSecret after successful registration (Phase 8.1C).
 *   - agentToken stored plain text in Phase 8.1B. Phase 8.1C: DPAPI encryption.
 *   - deviceFingerprint is a non-reversible hash; no PII.
 */

import os from 'os'
import crypto from 'crypto'
import type { AgentConfig, RegistrationRequest, RegistrationResponse } from './types'
import { createApiClient, axiosErrorMessage } from './api-client'
import { persistRegistration } from './config-manager'
import { log } from '../logger'

/**
 * Compute a stable device fingerprint:
 *   SHA-256( hostname + ":" + sorted non-internal MAC addresses )
 *
 * Falls back to hostname-only hash if no MACs are found (e.g., during testing).
 */
function deviceFingerprint(): string {
  const hostname = os.hostname()
  const macs: string[] = []

  const interfaces = os.networkInterfaces()
  for (const ifaces of Object.values(interfaces)) {
    if (!ifaces) continue
    for (const addr of ifaces) {
      if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
        macs.push(addr.mac.toLowerCase())
      }
    }
  }
  macs.sort()

  const raw = `${hostname}:${macs.join(',') || 'no-mac'}`
  return crypto.createHash('sha256').update(raw, 'utf-8').digest('hex')
}

/**
 * Register terminal with backend, or load existing registration from config.
 *
 * @throws  If registration HTTP call fails (network error or backend rejects).
 * @returns Updated AgentConfig with terminalId + agentToken populated.
 */
export async function registerOrLoad(config: AgentConfig): Promise<AgentConfig> {
  // Already registered — skip
  if (config.terminalId && config.agentToken) {
    log(`registration: already registered — terminalId=${config.terminalId}`)
    return config
  }

  log(`registration: first-time registration — terminalCode="${config.terminalCode}"`)

  const client = createApiClient(config.apiBaseUrl)

  const body: RegistrationRequest = {
    terminalCode: config.terminalCode,
    deviceFingerprint: deviceFingerprint(),
    adminSecret: config.adminSecret,
  }

  try {
    const resp = await client.post<RegistrationResponse>('/auth/terminal/register', body)
    const { terminalId, terminalToken } = resp.data

    log(`registration: success — terminalId=${terminalId}`)
    return persistRegistration(config, terminalId, terminalToken)
  } catch (e) {
    // Re-throw with a clear message so the caller can decide whether to exit
    throw new Error(`Registration failed: ${axiosErrorMessage(e)}`)
  }
}
