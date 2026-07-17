import { createHash, randomBytes } from 'node:crypto'
import { InjectQueue } from '@nestjs/bullmq'
import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import type { Queue } from 'bullmq'
import { AuditService } from '../audit/audit.service'
import {
  MemberDataExportRedisService,
  type MemberExportDownloadTicketPayload,
} from '../common/redis/member-data-export-redis.service'
import { MemberDataExportFileService } from '../files/member-data-export-file.service'
import { MEMBER_DATA_EXPORT_FILE_POLICY } from '../files/file-validation'
import { MemberStepUpService } from '../member-auth/member-step-up.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  MEMBER_EXPORT_RECONCILE_JOB,
  MEMBER_PRIVACY_QUEUE,
  type MemberExportReconcileJobData,
  type MemberPrivacyJobData,
} from './member-privacy.queue'

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const DEFAULT_TICKET_TTL_SECONDS = 10 * 60
const DEFAULT_CLAIM_TTL_SECONDS = 15 * 60

export interface MemberDataExportDownloadAuthorization {
  requestId: string
  downloadUrl: string
  expiresAt: string
}

export interface MemberDataExportDelivery {
  claimId: string
  buffer: Buffer
  filename: string
  mimeType: 'application/json'
}

@Injectable()
export class MemberDataExportDownloadService {
  private readonly logger = new Logger(MemberDataExportDownloadService.name)
  private readonly ticketTtlSeconds = boundedSeconds(
    'MEMBER_EXPORT_TICKET_TTL_SECONDS',
    DEFAULT_TICKET_TTL_SECONDS,
    10 * 60,
    60 * 60,
  )
  private readonly claimTtlSeconds = boundedSeconds(
    'MEMBER_EXPORT_CLAIM_TTL_SECONDS',
    DEFAULT_CLAIM_TTL_SECONDS,
    10 * 60,
    30 * 60,
  )

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: MemberDataExportRedisService,
    private readonly stepUp: MemberStepUpService,
    private readonly files: MemberDataExportFileService,
    @Optional() @InjectQueue(MEMBER_PRIVACY_QUEUE)
    private readonly queue?: Queue<MemberPrivacyJobData>,
  ) {}

  async authorizeDownload(
    endUserId: string,
    requestId: string,
    stepUpToken?: string | null,
    deviceId?: string | null,
  ): Promise<MemberDataExportDownloadAuthorization> {
    this.assertIdentifier(endUserId)
    this.assertIdentifier(requestId)
    const downloadPageBase = this.downloadPageBase()
    await this.stepUp.consumeGrant(
      endUserId,
      'export_data_download',
      stepUpToken ?? '',
      deviceId ?? undefined,
    )

    const row = await this.prisma.userDataRequest.findFirst({
      where: {
        id: requestId,
        endUserId,
        requestType: 'export',
        status: 'ready',
        downloadConsumedAt: null,
      },
      select: {
        id: true,
        endUserId: true,
        exportFileId: true,
        exportExpiresAt: true,
        executionVersion: true,
      },
    })
    const now = Date.now()
    if (!row?.exportFileId || !row.exportExpiresAt || row.exportExpiresAt.getTime() <= now) {
      this.downloadUnavailable()
    }

    const requestDigest = digest(row.id)
    const endUserDigest = digest(row.endUserId)
    const effectiveTtl = Math.min(
      this.ticketTtlSeconds,
      Math.max(1, Math.floor((row.exportExpiresAt.getTime() - now) / 1_000)),
    )
    const payload: MemberExportDownloadTicketPayload = {
      requestId: row.id,
      endUserId: row.endUserId,
      fileId: row.exportFileId,
      executionVersion: row.executionVersion,
      requestDigest,
      endUserDigest,
    }
    try {
      await this.redis.revokeTicketsByRequest(requestDigest)
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const ticket = randomBytes(32).toString('base64url')
        const stored = await this.redis.registerTicket({
          ticketDigest: digest(ticket),
          payload,
          ttlSeconds: effectiveTtl,
        })
        if (stored === 'stored') {
          const expiresAt = new Date(now + effectiveTtl * 1_000)
          return {
            requestId: row.id,
            downloadUrl: this.fragmentDownloadUrl(downloadPageBase, row.id, ticket),
            expiresAt: expiresAt.toISOString(),
          }
        }
      }
    } catch {
      throw this.serviceUnavailable()
    }
    throw this.serviceUnavailable()
  }

  async claimDownload(requestId: string, ticket?: string): Promise<MemberDataExportDelivery> {
    if (!IDENTIFIER_PATTERN.test(requestId) || !ticket || !CAPABILITY_PATTERN.test(ticket)) {
      this.downloadUnavailable()
    }
    const claimId = randomBytes(32).toString('base64url')
    let claim
    try {
      claim = await this.redis.claimTicket({
        ticketDigest: digest(ticket),
        expectedRequestId: requestId,
        claimDigest: digest(claimId),
        claimTtlSeconds: this.claimTtlSeconds,
      })
    } catch {
      throw this.serviceUnavailable()
    }
    if (claim.status !== 'claimed') this.downloadUnavailable()

    const payload = parsePayload(claim.payload)
    if (!payload || payload.requestId !== requestId) {
      await this.redis.abortClaim(digest(claimId)).catch(() => undefined)
      this.downloadUnavailable()
    }
    try {
      const row = await this.prisma.userDataRequest.findUnique({
        where: { id: requestId },
        select: {
          id: true,
          endUserId: true,
          requestType: true,
          status: true,
          executionVersion: true,
          exportFileId: true,
          exportExpiresAt: true,
          downloadConsumedAt: true,
        },
      })
      const valid = row
        && row.requestType === 'export'
        && row.status === 'ready'
        && row.downloadConsumedAt === null
        && row.exportExpiresAt !== null
        && row.exportExpiresAt.getTime() > Date.now()
        && row.endUserId === payload.endUserId
        && row.exportFileId === payload.fileId
        && row.executionVersion === payload.executionVersion
        && digest(row.id) === payload.requestDigest
        && digest(row.endUserId) === payload.endUserDigest
      if (!valid) this.downloadUnavailable()
      const file = await this.files.read(payload.fileId, payload.endUserId, MEMBER_DATA_EXPORT_FILE_POLICY.maxBytes)
      return { claimId, ...file }
    } catch (error) {
      await this.redis.abortClaim(digest(claimId)).catch(() => undefined)
      if (isStableCode(error, 'FILE_EXPORT_STORAGE_UNAVAILABLE')) throw this.serviceUnavailable()
      this.downloadUnavailable()
    }
  }

  async finishDownload(claimId: string): Promise<void> {
    if (!CAPABILITY_PATTERN.test(claimId)) return
    const claimDigest = digest(claimId)
    const begun = await this.redis.beginFinish(claimDigest)
    if (begun.status !== 'matched') return
    const payload = parsePayload(begun.payload)
    if (!payload) {
      await this.redis.completeClaim(claimDigest)
      return
    }

    let consumedAt: Date | null
    try {
      consumedAt = await this.persistDelivery(payload)
    } catch (error) {
      await this.enqueueReconcile(payload).catch((enqueueError: unknown) => {
        this.logger.error(`Member export delivery compensation enqueue failed code=EXPORT_RECONCILE_ENQUEUE_FAILED errorType=${safeErrorType(enqueueError)}`)
      })
      // Claim stays in finishing state until its TTL; close cannot undo a response finish.
      throw error
    }
    if (!consumedAt) return

    try {
      await this.enqueueReconcile(payload)
    } catch (error) {
      this.logger.error(`Member export reconcile enqueue failed code=EXPORT_RECONCILE_ENQUEUE_FAILED errorType=${safeErrorType(error)}`)
    } finally {
      await this.redis.completeClaim(claimDigest).catch((error: unknown) => {
        this.logger.warn(`Member export claim finalization failed code=EXPORT_CLAIM_FINALIZE_FAILED errorType=${safeErrorType(error)}`)
      })
    }
  }

  async abortDownload(claimId: string): Promise<void> {
    if (!CAPABILITY_PATTERN.test(claimId)) return
    await this.redis.abortClaim(digest(claimId))
  }

  private async persistDelivery(payload: MemberExportDownloadTicketPayload): Promise<Date | null> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.userDataRequest.findUnique({
        where: { id: payload.requestId },
        select: {
          endUserId: true,
          requestType: true,
          status: true,
          executionVersion: true,
          executionStep: true,
          exportFileId: true,
          exportExpiresAt: true,
          downloadConsumedAt: true,
        },
      })
      const alreadyConsumed = current?.endUserId === payload.endUserId
        && current.requestType === 'export'
        && current.executionVersion === payload.executionVersion
        && current.exportFileId === payload.fileId
        && current.downloadConsumedAt !== null
        && ['download_cleanup_pending', 'download_cleanup_failed', 'completed'].includes(current.executionStep ?? '')
      if (alreadyConsumed) return current.downloadConsumedAt
      const now = new Date()
      const canConsume = current?.endUserId === payload.endUserId
        && current.requestType === 'export'
        && current.status === 'ready'
        && current.executionVersion === payload.executionVersion
        && current.exportFileId === payload.fileId
        && current.downloadConsumedAt === null
        && current.exportExpiresAt !== null
        && current.exportExpiresAt.getTime() > now.getTime()
      if (!canConsume) return null
      const auditRef = await this.audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'end_user',
        action: 'member_data_export.delivery_finished',
        targetType: 'user_data_request',
        targetId: payload.requestId,
        payload: { executionVersion: payload.executionVersion },
      })
      const cas = await tx.userDataRequest.updateMany({
        where: {
          id: payload.requestId,
          endUserId: payload.endUserId,
          requestType: 'export',
          status: 'ready',
          executionVersion: payload.executionVersion,
          exportFileId: payload.fileId,
          downloadConsumedAt: null,
          exportExpiresAt: { gt: now },
        },
        data: {
          status: 'handling',
          executionStep: 'download_cleanup_pending',
          downloadConsumedAt: now,
          lastAttemptAt: now,
          failureCode: null,
          failureMessage: null,
          auditRef,
        },
      })
      if (cas.count !== 1) throw new Error('DATA_EXPORT_DELIVERY_CAS_CONFLICT')
      return now
    })
  }

  private async enqueueReconcile(payload: MemberExportDownloadTicketPayload): Promise<void> {
    if (!this.queue) throw new Error('queue unavailable')
    const data: MemberExportReconcileJobData = {
      requestId: payload.requestId,
      reason: 'delivery_finished',
      executionVersion: payload.executionVersion,
    }
    await this.queue.add(MEMBER_EXPORT_RECONCILE_JOB, data, {
      jobId: `export-reconcile-${payload.requestDigest}-${payload.executionVersion}-delivery-finished`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400 },
      removeOnFail: { age: 7 * 86_400 },
    })
  }

  private downloadPageBase(): URL {
    const configured = process.env['MEMBER_EXPORT_PUBLIC_WEB_BASE_URL']?.trim()
    try {
      if (!configured) throw new Error('missing URL')
      const base = new URL(configured)
      const secure = base.protocol === 'https:'
        || (process.env['NODE_ENV'] !== 'production' && base.protocol === 'http:' && isLoopback(base.hostname))
      if (!secure || base.username || base.password || base.search || base.hash) throw new Error('unsafe URL')
      return base
    } catch {
      throw new ServiceUnavailableException({
        error: { code: 'DATA_EXPORT_DOWNLOAD_CONFIG_UNAVAILABLE', message: '数据导出下载暂不可用' },
      })
    }
  }

  private fragmentDownloadUrl(base: URL, requestId: string, ticket: string): string {
    const page = new URL('/member/export-download', base.origin)
    page.hash = `request=${encodeURIComponent(requestId)}&ticket=${encodeURIComponent(ticket)}`
    return page.toString()
  }

  private assertIdentifier(value: string): void {
    if (!IDENTIFIER_PATTERN.test(value)) this.downloadUnavailable()
  }

  private downloadUnavailable(): never {
    throw new NotFoundException({
      error: { code: 'DATA_EXPORT_DOWNLOAD_UNAVAILABLE', message: '下载授权无效或已过期' },
    })
  }

  private serviceUnavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException({
      error: { code: 'DATA_EXPORT_DOWNLOAD_SERVICE_UNAVAILABLE', message: '数据导出下载暂不可用，请稍后重试' },
    })
  }
}

function boundedSeconds(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} is outside the safe range`)
  return value
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function parsePayload(raw: string): MemberExportDownloadTicketPayload | null {
  try {
    const value = JSON.parse(raw) as Partial<MemberExportDownloadTicketPayload>
    if (!value || !IDENTIFIER_PATTERN.test(value.requestId ?? '') || !IDENTIFIER_PATTERN.test(value.endUserId ?? '')
      || !IDENTIFIER_PATTERN.test(value.fileId ?? '') || !Number.isSafeInteger(value.executionVersion)
      || !/^[a-f0-9]{64}$/.test(value.requestDigest ?? '') || !/^[a-f0-9]{64}$/.test(value.endUserDigest ?? '')) return null
    return value as MemberExportDownloadTicketPayload
  } catch {
    return null
  }
}

function isStableCode(error: unknown, code: string): boolean {
  if (!error || typeof error !== 'object') return false
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  return JSON.stringify(response).includes(`"code":"${code}"`)
}

function safeErrorType(error: unknown): string {
  const value = error instanceof Error ? error.name : typeof error
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value) ? value : 'UnknownError'
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}
