import { randomUUID } from 'node:crypto'
import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger, Optional } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { AuditService } from '../audit/audit.service'
import { RedisService } from '../common/redis/redis.service'
import { MemberStepUpService } from '../member-auth/member-step-up.service'
import { PrismaService } from '../prisma/prisma.service'
import { MemberDataRequestAdminOperations } from './member-data-request.admin'
import {
  badRequest,
  conflict,
  cursorWhere,
  decodeRequestCursor,
  encodeRequestCursor,
  exportJobId,
  exportJobOptions,
  pageSize,
  toMemberDataRequestItem,
  unavailable,
  type DataRequestRow,
} from './member-data-request.helpers'
import {
  MEMBER_EXPORT_JOB,
  MEMBER_PRIVACY_QUEUE,
  type MemberPrivacyJobData,
} from './member-privacy.queue'
import type {
  AdminMemberDataRequestItem,
  AdminMemberDataRequestPage,
  AdminMemberDataRequestQuery,
  MemberDataRequestItem,
  MemberDataRequestPage,
  MemberDataRequestType,
} from './member-privacy.types'

const REQUEST_TYPES = new Set<MemberDataRequestType>(['export', 'delete', 'revoke_consent'])
const IDEMPOTENCY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CREATE_LOCK_TTL_SECONDS = 30

@Injectable()
export class MemberDataRequestService {
  private readonly logger = new Logger(MemberDataRequestService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly stepUp: MemberStepUpService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    @Optional() @InjectQueue(MEMBER_PRIVACY_QUEUE)
    private readonly queue?: Queue<MemberPrivacyJobData>,
  ) {}

  async create(
    endUserId: string,
    requestType: MemberDataRequestType,
    idempotencyKey: string,
    stepUpToken: string | null,
    deviceId: string | null,
  ): Promise<MemberDataRequestItem> {
    this.assertCreateInput(endUserId, requestType, idempotencyKey)
    if (requestType === 'delete') {
      throw badRequest('ACCOUNT_CLOSURE_NOT_AVAILABLE', '账号注销暂未开放')
    }

    const replay = await this.findIdempotent(endUserId, requestType, idempotencyKey)
    if (replay) return toMemberDataRequestItem(replay)
    if (requestType === 'revoke_consent') {
      return this.createConsentRevocation(endUserId, idempotencyKey)
    }
    this.assertQueueAvailable()

    const lockKey = `member:data-request:create:${endUserId}`
    const lockValue = randomUUID()
    let locked: boolean
    try {
      locked = await this.redis.setNxEx(lockKey, lockValue, CREATE_LOCK_TTL_SECONDS)
    } catch {
      throw unavailable('DATA_REQUEST_QUEUE_UNAVAILABLE', '数据请求协调服务暂不可用')
    }
    if (!locked) throw conflict('DATA_REQUEST_IN_PROGRESS', '数据权利请求正在创建，请稍后重试')

    let created: DataRequestRow
    try {
      const lockedReplay = await this.findIdempotent(endUserId, requestType, idempotencyKey)
      if (lockedReplay) return toMemberDataRequestItem(lockedReplay)

      const activeKey = this.activeKey(endUserId)
      const active = await this.prisma.userDataRequest.findFirst({ where: { activeKey } })
      if (active) throw conflict('DATA_REQUEST_ALREADY_ACTIVE', '已有数据权利请求正在处理')

      await this.stepUp.consumeGrant(
        endUserId,
        'export_data_request',
        stepUpToken ?? '',
        deviceId ?? undefined,
      )
      created = await this.createExportRow(endUserId, idempotencyKey, activeKey)
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const uniqueReplay = await this.resolveUniqueConflict(endUserId, requestType, idempotencyKey)
        if (uniqueReplay) return toMemberDataRequestItem(uniqueReplay)
      }
      throw error
    } finally {
      await this.redis.getAndDelIfEquals(lockKey, lockValue).catch(() => {
        this.logger.warn('Member data request create lock release failed')
      })
    }

    const jobId = exportJobId(created.id, created.executionVersion)
    try {
      await this.queue!.add(
        MEMBER_EXPORT_JOB,
        { requestId: created.id, executionVersion: created.executionVersion },
        exportJobOptions(jobId),
      )
    } catch {
      await this.markQueueFailure(created.id, created.executionVersion)
      throw unavailable('QUEUE_ENQUEUE_FAILED', '数据导出任务暂时无法排队，请稍后重试')
    }
    const workerCas = await this.prisma.userDataRequest.updateMany({
      where: {
        id: created.id,
        executionVersion: created.executionVersion,
        workerJobId: null,
      },
      data: { workerJobId: jobId },
    })
    if (workerCas.count !== 1) {
      throw unavailable('DATA_REQUEST_EXECUTION_INCOMPLETE', '数据导出任务状态尚未收敛，请稍后查看')
    }
    return toMemberDataRequestItem({ ...created, workerJobId: jobId })
  }

  async list(endUserId: string, cursor?: string, limit = 20): Promise<MemberDataRequestPage> {
    const take = pageSize(limit)
    const decoded = decodeRequestCursor(cursor)
    const rows = await this.prisma.userDataRequest.findMany({
      where: { endUserId, ...cursorWhere(decoded) },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    })
    const hasMore = rows.length > take
    const items = rows.slice(0, take)
    return {
      items: items.map(toMemberDataRequestItem),
      nextCursor: hasMore && items.length > 0 ? encodeRequestCursor(items[items.length - 1]!) : null,
      capabilities: { accountClosureAvailable: false },
    }
  }

  listForAdmin(query: AdminMemberDataRequestQuery = {}): Promise<AdminMemberDataRequestPage> {
    return this.admin().list(query)
  }

  retry(id: string, handledBy: string): Promise<AdminMemberDataRequestItem> {
    return this.admin().retry(id, handledBy)
  }

  reject(id: string, handledBy: string, reason: string): Promise<AdminMemberDataRequestItem> {
    return this.admin().reject(id, handledBy, reason)
  }

  private async createConsentRevocation(
    endUserId: string,
    idempotencyKey: string,
  ): Promise<MemberDataRequestItem> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const replay = await tx.userDataRequest.findUnique({ where: { idempotencyKey } })
        if (replay) {
          if (replay.endUserId !== endUserId || replay.requestType !== 'revoke_consent') {
            throw conflict('IDEMPOTENCY_KEY_REUSED', '幂等键已用于其他数据请求')
          }
          return replay
        }
        const now = new Date()
        await tx.userAiConsent.updateMany({
          where: { endUserId, scope: 'job_ai', revokedAt: null },
          data: { revokedAt: now },
        })
        const created = await tx.userDataRequest.create({
          data: {
            endUserId,
            requestType: 'revoke_consent',
            status: 'completed',
            idempotencyKey,
            activeKey: null,
            executionVersion: 0,
            handledAt: now,
            handledBy: 'system',
          },
        })
        const auditRef = await this.audit.writeRequired(tx, {
          actorId: null,
          actorRole: 'end_user',
          action: 'member_ai_consent.revoke',
          targetType: 'user_data_request',
          targetId: created.id,
          payload: { scope: 'job_ai' },
        })
        return tx.userDataRequest.update({ where: { id: created.id }, data: { auditRef } })
      })
      return toMemberDataRequestItem(row)
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        const replay = await this.findIdempotent(endUserId, 'revoke_consent', idempotencyKey)
        if (replay) return toMemberDataRequestItem(replay)
      }
      throw error
    }
  }

  private async createExportRow(
    endUserId: string,
    idempotencyKey: string,
    activeKey: string,
  ): Promise<DataRequestRow> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.userDataRequest.create({
        data: {
          endUserId,
          requestType: 'export',
          status: 'pending',
          idempotencyKey,
          activeKey,
          executionVersion: 0,
          executionStep: null,
          progressJson: '{}',
        },
      })
      const auditRef = await this.audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'end_user',
        action: 'member_data_request.create',
        targetType: 'user_data_request',
        targetId: created.id,
        payload: { requestType: 'export' },
      })
      return tx.userDataRequest.update({ where: { id: created.id }, data: { auditRef } })
    })
  }

  private async findIdempotent(
    endUserId: string,
    requestType: MemberDataRequestType,
    idempotencyKey: string,
  ): Promise<DataRequestRow | null> {
    const existing = await this.prisma.userDataRequest.findUnique({ where: { idempotencyKey } })
    if (!existing) return null
    if (existing.endUserId !== endUserId || existing.requestType !== requestType) {
      throw conflict('IDEMPOTENCY_KEY_REUSED', '幂等键已用于其他数据请求')
    }
    return existing
  }

  private async resolveUniqueConflict(
    endUserId: string,
    requestType: MemberDataRequestType,
    idempotencyKey: string,
  ): Promise<DataRequestRow | null> {
    const replay = await this.findIdempotent(endUserId, requestType, idempotencyKey)
    if (replay) return replay
    const active = await this.prisma.userDataRequest.findFirst({ where: { activeKey: this.activeKey(endUserId) } })
    if (active) throw conflict('DATA_REQUEST_ALREADY_ACTIVE', '已有数据权利请求正在处理')
    return null
  }

  private async markQueueFailure(id: string, executionVersion: number): Promise<void> {
    await this.prisma.userDataRequest.updateMany({
      where: { id, status: 'pending', executionVersion, workerJobId: null },
      data: {
        status: 'failed',
        failureCode: 'QUEUE_ENQUEUE_FAILED',
        failureMessage: 'queue enqueue failed',
        lastAttemptAt: new Date(),
      },
    })
  }

  private assertCreateInput(endUserId: string, requestType: string, idempotencyKey: string): void {
    if (typeof endUserId !== 'string' || endUserId.trim().length === 0 || endUserId.length > 128) {
      throw badRequest('INVALID_END_USER', '会员身份无效')
    }
    if (!REQUEST_TYPES.has(requestType as MemberDataRequestType)) {
      throw badRequest('INVALID_DATA_REQUEST_TYPE', '数据请求类型不支持')
    }
    if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
      throw badRequest('INVALID_IDEMPOTENCY_KEY', '幂等键格式无效')
    }
  }

  private assertQueueAvailable(): void {
    if (!this.queue) throw unavailable('DATA_REQUEST_QUEUE_UNAVAILABLE', '数据导出队列暂不可用')
  }

  private activeKey(endUserId: string): string {
    return `${endUserId}:privacy-exclusive`
  }

  private isUniqueConflict(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && (error as { code?: string }).code === 'P2002')
  }

  private admin(): MemberDataRequestAdminOperations {
    return new MemberDataRequestAdminOperations(this.prisma, this.audit, this.queue)
  }
}
