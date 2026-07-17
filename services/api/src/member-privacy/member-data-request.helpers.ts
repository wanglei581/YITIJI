import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common'
import type { JobsOptions } from 'bullmq'
import type {
  MemberDataRequestItem,
  MemberDataRequestStatus,
  MemberDataRequestType,
} from './member-privacy.types'

export type DataRequestRow = {
  id: string
  endUserId: string
  requestType: string
  status: string
  idempotencyKey: string | null
  activeKey: string | null
  executionVersion: number
  executionStep: string | null
  workerJobId: string | null
  exportFileId: string | null
  exportExpiresAt: Date | null
  failureCode: string | null
  retryCount: number
  lastAttemptAt: Date | null
  requestedAt: Date
  handledAt: Date | null
  handledBy: string | null
  auditRef: string | null
}

interface RequestCursor {
  requestedAt: Date
  id: string
}

export function toMemberDataRequestItem(row: DataRequestRow): MemberDataRequestItem {
  const status = row.status as MemberDataRequestStatus
  return {
    id: row.id,
    requestType: row.requestType as MemberDataRequestType,
    status,
    requestedAt: row.requestedAt.toISOString(),
    handledAt: row.handledAt?.toISOString() ?? null,
    executionStep: row.executionStep,
    exportExpiresAt: row.exportExpiresAt?.toISOString() ?? null,
    failureCode: row.failureCode,
    canRetry: row.requestType === 'export'
      && row.exportFileId === null
      && row.failureCode !== 'EXPORT_CLEANUP_FAILED'
      && (status === 'failed' || (status === 'pending' && !row.workerJobId)),
    canDownload: row.requestType === 'export' && status === 'ready',
  }
}

export function encodeRequestCursor(row: Pick<DataRequestRow, 'id' | 'requestedAt'>): string {
  return Buffer.from(JSON.stringify({ requestedAt: row.requestedAt.toISOString(), id: row.id }), 'utf8')
    .toString('base64url')
}

export function decodeRequestCursor(value?: string): RequestCursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    const requestedAt = new Date(String(parsed['requestedAt'] ?? ''))
    const id = String(parsed['id'] ?? '')
    if (!Number.isFinite(requestedAt.getTime()) || id.length === 0 || id.length > 128) throw new Error()
    return { requestedAt, id }
  } catch {
    throw badRequest('INVALID_DATA_REQUEST_CURSOR', '分页游标无效')
  }
}

export function cursorWhere(cursor: RequestCursor | null): Record<string, unknown> {
  if (!cursor) return {}
  return {
    OR: [
      { requestedAt: { lt: cursor.requestedAt } },
      { requestedAt: cursor.requestedAt, id: { lt: cursor.id } },
    ],
  }
}

export function pageSize(limit: number, defaultSize = 20, maxSize = 100): number {
  if (!Number.isInteger(limit) || limit < 1) return defaultSize
  return Math.min(limit, maxSize)
}

export function exportJobId(id: string, executionVersion: number): string {
  return `member-export-${id}-${executionVersion}`
}

export function exportJobOptions(jobId: string): JobsOptions {
  return {
    jobId,
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 86_400 },
    removeOnFail: { age: 7 * 86_400 },
  }
}

export function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

export function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ error: { code, message } })
}

export function unavailable(code: string, message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({ error: { code, message } })
}
