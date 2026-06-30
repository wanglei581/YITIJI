/**
 * agent/offline-queue.ts — Phase 8.1C
 *
 * Retry queue for PATCH /print-tasks/:taskId/status calls that failed due to
 * network outage or transient 5xx server errors.
 *
 * Retry policy:
 *   - Poll every 60s.
 *   - Exponential back-off: nextRetryAt = now + min(2^attempts * 30s, 30min).
 *   - 4xx response → abandon (remove from queue; log warning).
 *   - attempts >= 10 → abandon.
 *   - 2xx → success (remove from queue; log confirmation).
 *   - timer.unref() → never prevents the process from exiting cleanly.
 */

import axios from 'axios'
import { createApiClient, axiosErrorMessage } from './api-client'
import {
  getPendingPatches,
  markPatchAttempt,
  isDatabaseAvailable,
  type AgentDatabase,
  type PendingPatch,
} from './db'
import type { AgentConfig } from './types'
import { log, warn } from '../logger'

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 10
const RETRY_INTERVAL_MS = 60_000
const BASE_DELAY_MS = 30_000      // first retry after 30s
const MAX_DELAY_MS = 30 * 60_000  // cap at 30 min

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Exponential back-off in ms, capped at MAX_DELAY_MS. */
function nextRetryDelayMs(attempts: number): number {
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempts), MAX_DELAY_MS)
}

// ── Per-patch retry ───────────────────────────────────────────────────────────

async function processPatch(
  patch: PendingPatch,
  config: AgentConfig,
  db: AgentDatabase,
): Promise<void> {
  // Max attempts guard
  if (patch.attempts >= MAX_ATTEMPTS) {
    warn(
      `offline-queue: abandoning patch id=${patch.id} task=${patch.taskId}` +
        ` — max ${MAX_ATTEMPTS} attempts reached`,
    )
    markPatchAttempt(db, patch.id, false, undefined, /* abandon */ true)
    return
  }

  const { terminalId, agentToken, apiBaseUrl } = config
  if (!terminalId || !agentToken) {
    // Not yet registered; skip this cycle — will retry after registration completes
    return
  }

  const client = createApiClient(apiBaseUrl, agentToken, terminalId)
  const payload: Record<string, string> = { status: patch.status }
  if (patch.errorCode) payload['errorCode'] = patch.errorCode
  if (patch.errorMessage) payload['errorMessage'] = patch.errorMessage

  try {
    await client.patch(`/print-tasks/${patch.taskId}/status`, payload)
    log(
      `offline-queue: PATCH status=${patch.status} for ${patch.taskId} ✓` +
        ` (attempt ${patch.attempts + 1})`,
    )
    markPatchAttempt(db, patch.id, /* success */ true)
  } catch (e) {
    const httpStatus = axios.isAxiosError(e) ? e.response?.status : undefined

    if (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500) {
      // 4xx → abandon; no point retrying a client-side error
      warn(
        `offline-queue: abandoning patch id=${patch.id} task=${patch.taskId}` +
          ` — 4xx (${httpStatus}): ${axiosErrorMessage(e)}`,
      )
      markPatchAttempt(db, patch.id, false, undefined, /* abandon */ true)
    } else {
      // 5xx / network error → schedule next retry with back-off
      const delay = nextRetryDelayMs(patch.attempts + 1)
      const nextRetryAt = new Date(Date.now() + delay).toISOString()
      warn(
        `offline-queue: patch id=${patch.id} task=${patch.taskId} failed` +
          ` (attempt ${patch.attempts + 1}/${MAX_ATTEMPTS})` +
          ` — retry in ${Math.round(delay / 1000)}s — ${axiosErrorMessage(e)}`,
      )
      markPatchAttempt(db, patch.id, false, nextRetryAt)
    }
  }
}

// ── Polling loop ──────────────────────────────────────────────────────────────

async function runRetryLoop(config: AgentConfig, db: AgentDatabase): Promise<void> {
  const patches = getPendingPatches(db)
  if (patches.length === 0) return

  log(`offline-queue: processing ${patches.length} pending patch(es)`)
  for (const patch of patches) {
    await processPatch(patch, config, db)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the offline-retry polling loop.
 * Returns the NodeJS.Timeout handle; pass to clearInterval() on shutdown.
 */
export function startOfflineRetry(config: AgentConfig, db: AgentDatabase): NodeJS.Timeout {
  if (!isDatabaseAvailable(db)) {
    warn('offline-queue: local task database unavailable; status retry queue disabled')
    const timer = setInterval(() => undefined, RETRY_INTERVAL_MS)
    timer.unref()
    return timer
  }

  log(`offline-queue: starting — interval=${RETRY_INTERVAL_MS / 1000}s, max attempts=${MAX_ATTEMPTS}`)
  const timer = setInterval(() => {
    runRetryLoop(config, db).catch((e) =>
      warn(`offline-queue: unexpected error — ${e instanceof Error ? e.message : String(e)}`),
    )
  }, RETRY_INTERVAL_MS)
  timer.unref() // Don't keep the process alive for retries alone
  return timer
}
