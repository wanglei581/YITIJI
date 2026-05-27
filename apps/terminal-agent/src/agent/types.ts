/**
 * agent/types.ts — Phase 8.1B
 *
 * Types for the Agent runtime:
 *   - AgentConfig   : persisted to config/agent-config.json
 *   - HeartbeatPayload / HeartbeatResponse : PUT /terminals/:id/heartbeat
 *   - ClaimTask     : response item from POST /terminals/:id/tasks/claim
 *   - PatchStatusPayload : PATCH /print-tasks/:taskId/status
 *
 * PrintJobParams is defined in ../printer/types and re-exported here
 * to keep agent code self-contained.
 */

export type { PrintJobParams } from '../printer/types'

// ── Config ──────────────────────────────────────────────────────────────────

/**
 * Persisted agent configuration (config/agent-config.json).
 * Fields with ? are written on first registration and must not be manually set.
 *
 * Security note (Phase 8.1B):
 *   agentToken is stored in plain text. Phase 8.1C will encrypt it with DPAPI.
 *   Never commit a filled-in agent-config.json to version control.
 */
export interface AgentConfig {
  /** Backend API base URL. e.g. "http://localhost:3000/api/v1" */
  apiBaseUrl: string
  /** Human-readable terminal code. e.g. "T-001". Used for registration. */
  terminalCode: string
  /**
   * One-time admin secret for first-time registration.
   * After registration completes, this field is still present but ignored.
   */
  adminSecret: string
  /**
   * Printer name. Must be configurable; never hard-code model string.
   * Default: "Pantum CM2800ADN Series" (Windows driver name, confirmed on real machine).
   */
  printerName: string
  /** Agent version echoed in heartbeat. e.g. "0.2.0" */
  agentVersion: string
  /** Heartbeat interval in ms. Default: 30000. May be overridden by server response. */
  heartbeatIntervalMs?: number
  /** Claim poll interval in ms. Default: 5000. May be overridden by server response. */
  claimIntervalMs?: number

  // ── Written on first registration ─────────────────────────────────────────
  /** Assigned by backend on registration. Persisted to config file. */
  terminalId?: string
  /**
   * Bearer token for all backend API calls (Authorization: Bearer <agentToken>).
   * Phase 8.1B: stored plain text. Phase 8.1C: DPAPI-encrypted.
   */
  agentToken?: string
}

// ── Heartbeat ────────────────────────────────────────────────────────────────

export type TerminalStatus = 'online' | 'offline' | 'error'
export type PrinterStatus = 'ready' | 'offline' | 'error' | 'low_paper' | 'unknown'

export interface HeartbeatPayload {
  status: TerminalStatus
  /** Phase 8.1B: 'unknown' (real WMI query in Phase 8.1C). */
  printerStatus: PrinterStatus
  /** Free disk space in GB. Phase 8.1B: -1 (real WMI query in Phase 8.1C). */
  diskFreeGB: number
  agentVersion: string
  ipAddress: string
  reportedAt: string
}

export interface HeartbeatResponse {
  acknowledged: boolean
  /** Server may push config overrides (e.g. updated poll intervals). */
  config?: {
    heartbeatIntervalMs?: number
    claimIntervalMs?: number
  }
}

// ── Task claim ────────────────────────────────────────────────────────────────

import type { PrintJobParams } from '../printer/types'

export interface ClaimTask {
  taskId: string
  type: 'print'
  fileUrl: string
  /** Expected MD5 hex digest of the downloaded file. May be empty string if server omits it. */
  fileMd5: string
  actionToken: string
  claimedBy: string
  claimExpiresAt: string
  params: PrintJobParams
  createdAt: string
}

// ── Status PATCH ──────────────────────────────────────────────────────────────

export type ReportableStatus = 'printing' | 'completed' | 'failed'

export interface PatchStatusPayload {
  status: ReportableStatus
  errorCode?: string
  errorMessage?: string
}

export interface PatchStatusResponse {
  acknowledged: boolean
}

// ── Registration ──────────────────────────────────────────────────────────────

export interface RegistrationRequest {
  terminalCode: string
  deviceFingerprint: string
  adminSecret: string
}

export interface RegistrationResponse {
  terminalId: string
  /** Bearer token to use for subsequent API calls. */
  terminalToken: string
  expiresAt: string
}
