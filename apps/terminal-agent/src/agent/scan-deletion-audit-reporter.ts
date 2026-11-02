/**
 * Durable reporting for the PII-safe local scan deletion audit ledger.
 *
 * Only a matching server acknowledgement clears pendingReport. Network/5xx
 * failures remain retryable with durable backoff; permanent 4xx responses keep
 * the local event in an operator-visible dead-letter state.
 */

import axios from 'axios'
import { log, warn } from '../logger'
import { createApiClient, isUnauthorizedHttpError } from './api-client'
import { isUnauthorized, markUnauthorized } from './auth-state'
import {
  acknowledgeScanDeletionAuditReport,
  deadLetterScanDeletionAuditReport,
  getPendingScanDeletionAuditReports,
  getScanDeletionAuditReportDeadLetterCount,
  isDatabaseAvailable,
  markScanDeletionAuditReportRetry,
  type AgentDatabase,
  type ScanDeletionAudit,
} from './db'
import { writeStartupDiagnosticSafely } from './startup-diagnostics'
import { SCAN_DEVICE_DELETION_REASONS } from './scan-device/scan-temp-dir'
import type {
  AgentConfig,
  ScanDeletionAuditReportPayload,
  ScanDeletionAuditReportResponse,
} from './types'

/** 与 scan-temp-dir 的原因码列表同源，再加面板路线原有的未领取过期。不要另抄六个数。 */
const REPORTABLE_REASON_CODES = new Set<string>(['UNCLAIMED_TTL_EXPIRED', ...SCAN_DEVICE_DELETION_REASONS])

const REPORT_INTERVAL_MS = 60_000
const BASE_DELAY_MS = 30_000
const MAX_DELAY_MS = 30 * 60_000
const REPORT_BATCH_LIMIT = 50

export type ScanDeletionAuditSender = (
  payload: ScanDeletionAuditReportPayload,
) => Promise<ScanDeletionAuditReportResponse>

export type ScanDeletionAuditReportOutcome =
  | 'processed'
  | 'skipped'
  | 'paused_unauthorized'

function nextRetryDelayMs(attempts: number): number {
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempts), MAX_DELAY_MS)
}

function retryAt(attempts: number): string {
  return new Date(Date.now() + nextRetryDelayMs(attempts)).toISOString()
}

function safeEventLabel(eventId: string): string {
  return eventId.slice(0, 12)
}

function buildPayload(event: ScanDeletionAudit): ScanDeletionAuditReportPayload {
  return {
    eventId: event.eventId,
    reasonCode: event.reasonCode as ScanDeletionAuditReportPayload['reasonCode'],
    identifierHash: event.identifierHash,
    createdAt: event.createdAt,
    deletedAt: event.deletedAt,
    result: event.result,
    deleteAttempts: event.attempts,
    lastDeleteAttemptAt: event.lastAttemptAt,
    lastErrorCode: event.lastErrorCode,
  }
}

function httpStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined
}

export async function processScanDeletionAuditReport(
  event: ScanDeletionAudit,
  config: AgentConfig,
  db: AgentDatabase,
  sendReport?: ScanDeletionAuditSender,
): Promise<ScanDeletionAuditReportOutcome> {
  const { terminalId, agentToken, apiBaseUrl } = config
  if (!terminalId || !agentToken) return 'skipped'
  if (isUnauthorized()) return 'paused_unauthorized'
  if (!REPORTABLE_REASON_CODES.has(event.reasonCode)) {
    deadLetterScanDeletionAuditReport(db, event.eventId, 'REASON_CODE_UNSUPPORTED')
    return 'processed'
  }

  const payload = buildPayload(event)
  try {
    let response: ScanDeletionAuditReportResponse
    if (sendReport) {
      response = await sendReport(payload)
    } else {
      const client = createApiClient(apiBaseUrl, agentToken, terminalId)
      const apiResponse = await client.post<ScanDeletionAuditReportResponse>(
        `/terminals/${terminalId}/scan-deletion-audits`,
        payload,
      )
      response = apiResponse.data
    }

    if (response.acknowledged !== true || response.eventId !== event.eventId) {
      markScanDeletionAuditReportRetry(
        db,
        event.eventId,
        'INVALID_ACK',
        retryAt(event.reportAttempts + 1),
      )
      warn(
        `scan-deletion-audit-reporter: invalid acknowledgement for event=${safeEventLabel(event.eventId)}`,
      )
      return 'processed'
    }

    acknowledgeScanDeletionAuditReport(db, event.eventId)
    log(`scan-deletion-audit-reporter: acknowledged event=${safeEventLabel(event.eventId)}`)
    return 'processed'
  } catch (error) {
    const status = httpStatus(error)
    if (isUnauthorizedHttpError(error)) {
      markScanDeletionAuditReportRetry(
        db,
        event.eventId,
        'HTTP_401',
        retryAt(event.reportAttempts + 1),
      )
      markUnauthorized()
      writeStartupDiagnosticSafely('AGENT_UNAUTHORIZED')
      warn(
        `scan-deletion-audit-reporter: unauthorized event=${safeEventLabel(event.eventId)}` +
          ' — retained for retry after re-bind',
      )
      return 'paused_unauthorized'
    }

    if (status !== undefined && status >= 400 && status < 500) {
      const errorCode = `HTTP_${status}`
      deadLetterScanDeletionAuditReport(db, event.eventId, errorCode)
      warn(
        `scan-deletion-audit-reporter: dead-letter event=${safeEventLabel(event.eventId)}` +
          ` code=${errorCode}; operator action required`,
      )
      return 'processed'
    }

    const errorCode = status !== undefined ? `HTTP_${status}` : 'NETWORK_ERROR'
    markScanDeletionAuditReportRetry(
      db,
      event.eventId,
      errorCode,
      retryAt(event.reportAttempts + 1),
    )
    warn(
      `scan-deletion-audit-reporter: retry scheduled event=${safeEventLabel(event.eventId)}` +
        ` code=${errorCode}`,
    )
    return 'processed'
  }
}

export async function runScanDeletionAuditReportLoop(
  config: AgentConfig,
  db: AgentDatabase,
  sendReport?: ScanDeletionAuditSender,
): Promise<void> {
  if (isUnauthorized()) return
  const events = getPendingScanDeletionAuditReports(db, REPORT_BATCH_LIMIT)
  for (const event of events) {
    const outcome = await processScanDeletionAuditReport(event, config, db, sendReport)
    if (outcome === 'paused_unauthorized') break
  }
}

export function startScanDeletionAuditReporter(
  config: AgentConfig,
  db: AgentDatabase,
): NodeJS.Timeout {
  if (!isDatabaseAvailable(db)) {
    warn('scan-deletion-audit-reporter: local database unavailable; reporting disabled')
    const timer = setInterval(() => undefined, REPORT_INTERVAL_MS)
    timer.unref()
    return timer
  }

  const deadLetterCount = getScanDeletionAuditReportDeadLetterCount(db)
  if (deadLetterCount > 0) {
    warn(
      `scan-deletion-audit-reporter: ${deadLetterCount} durable dead-letter event(s)` +
        ' require operator action',
    )
  }

  void runScanDeletionAuditReportLoop(config, db).catch(() => {
    warn('scan-deletion-audit-reporter: unexpected startup reporting failure')
  })
  const timer = setInterval(() => {
    void runScanDeletionAuditReportLoop(config, db).catch(() => {
      warn('scan-deletion-audit-reporter: unexpected reporting failure')
    })
  }, REPORT_INTERVAL_MS)
  timer.unref()
  return timer
}
