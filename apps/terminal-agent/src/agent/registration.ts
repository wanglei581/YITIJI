/**
 * agent/registration.ts — Phase 8.1C
 *
 * Handles terminal registration with the backend:
 *   POST /auth/terminal/register
 *
 * On first startup (no terminalId/agentToken in config):
 *   1. Compute device fingerprint (SHA-256 of hostname + all non-internal MAC addresses)
 *   2. POST /auth/terminal/register with terminalCode + deviceFingerprint + macAddress + adminSecret
 *   3. Persist terminalId + agentToken (= terminalToken) to config file
 *
 * On subsequent startups (terminalId/agentToken already available):
 *   - agentToken is loaded from DPAPI-encrypted agent.token by loadConfig().
 *   - If both terminalId and agentToken are present, registration is skipped.
 *
 * Security note (Phase 8.1C):
 *   - adminSecret is now optional; it is cleared from config.json after registration.
 *   - agentToken is stored DPAPI-encrypted in agent.token (not in config.json).
 *   - deviceFingerprint is a non-reversible hash; no PII.
 *   - macAddress (added for 终端设备档案) is sent in the clear — it is a hardware
 *     identifier used for Admin-side duplicate-terminal detection, not a secret;
 *     the backend normalizes/validates format and enforces uniqueness.
 */

import os from 'os'
import crypto from 'crypto'
import type { AgentConfig, RegistrationRequest, RegistrationResponse } from './types'
import { createApiClient, axiosErrorMessage } from './api-client'
import { persistRegistration } from './config-manager'
import { log } from '../logger'

/** Sorted, de-duplicated non-internal MAC addresses across all network adapters. */
function nonInternalMacAddresses(): string[] {
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
  return macs
}

/**
 * Compute a stable device fingerprint:
 *   SHA-256( hostname + ":" + sorted non-internal MAC addresses )
 *
 * Falls back to hostname-only hash if no MACs are found (e.g., during testing).
 */
function deviceFingerprint(): string {
  const hostname = os.hostname()
  const raw = `${hostname}:${nonInternalMacAddresses().join(',') || 'no-mac'}`
  return crypto.createHash('sha256').update(raw, 'utf-8').digest('hex')
}

/**
 * Real (non-hashed) MAC address of the primary non-internal adapter, reported
 * to Terminal.macAddress (Admin 终端设备档案 / 唯一性校验). Undefined when no
 * non-internal adapter is found (e.g. a machine with only loopback).
 */
function primaryMacAddress(): string | undefined {
  return nonInternalMacAddresses()[0]
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

  // adminSecret is required for first-time registration but cleared afterwards
  if (!config.adminSecret) {
    throw new Error(
      'registration: adminSecret 缺失，请在 config.json 中填写 adminSecret 后重试',
    )
  }

  const body: RegistrationRequest = {
    terminalCode: config.terminalCode,
    deviceFingerprint: deviceFingerprint(),
    macAddress: primaryMacAddress(),
    adminSecret: config.adminSecret,
  }

  try {
    const resp = await client.post<RegistrationResponse>('/auth/terminal/register', body)
    const { terminalId, terminalToken } = resp.data

    log(`registration: success — terminalId=${terminalId}`)
    return persistRegistration(config, terminalId, terminalToken)
  } catch (e) {
    // Scrub sensitive values before re-throwing so they never appear in logs
    const rawMsg = axiosErrorMessage(e)
    const safeMsg = redactSensitive(rawMsg, [config.adminSecret, config.agentToken])
    throw new Error(`Registration failed: ${safeMsg}`)
  }
}

/** Replace each secret value in `message` with '[redacted]'. */
function redactSensitive(message: string, secrets: Array<string | undefined>): string {
  return secrets.reduce<string>((acc, secret) => {
    if (!secret) return acc
    return acc.split(secret).join('[redacted]')
  }, message)
}
