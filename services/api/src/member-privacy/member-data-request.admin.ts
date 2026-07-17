import { NotFoundException } from '@nestjs/common'
import type { Queue } from 'bullmq'
import { AuditService } from '../audit/audit.service'
import { maskPhoneFromEnc } from '../common/crypto/phone-identity'
import { PrismaService } from '../prisma/prisma.service'
import {
  MEMBER_EXPORT_JOB,
  type MemberPrivacyJobData,
} from './member-privacy.queue'
import type {
  AdminMemberDataRequestItem,
  AdminMemberDataRequestPage,
  AdminMemberDataRequestQuery,
  MemberDataRequestStatus,
  MemberDataRequestType,
} from './member-privacy.types'
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

const REQUEST_TYPES = new Set<MemberDataRequestType>(['export', 'delete', 'revoke_consent'])
const REQUEST_STATUSES = new Set<MemberDataRequestStatus>([
  'pending', 'handling', 'ready', 'completed', 'expired', 'failed', 'rejected', 'cancelled',
])

export class MemberDataRequestAdminOperations {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue?: Queue<MemberPrivacyJobData>,
  ) {}

  async list(query: AdminMemberDataRequestQuery = {}): Promise<AdminMemberDataRequestPage> {
    const take = pageSize(query.limit ?? 20)
    const cursor = decodeRequestCursor(query.cursor)
    const where = {
      ...(query.status ? { status: this.assertStatus(query.status) } : {}),
      ...(query.requestType ? { requestType: this.assertRequestType(query.requestType) } : {}),
      ...cursorWhere(cursor),
    }
    const rows = await this.prisma.userDataRequest.findMany({
      where,
      select: {
        id: true,
        endUserId: true,
        requestType: true,
        status: true,
        idempotencyKey: true,
        activeKey: true,
        executionVersion: true,
        executionStep: true,
        workerJobId: true,
        exportFileId: true,
        exportExpiresAt: true,
        failureCode: true,
        retryCount: true,
        lastAttemptAt: true,
        requestedAt: true,
        handledAt: true,
        handledBy: true,
        auditRef: true,
        endUser: { select: { phoneEnc: true, nickname: true } },
      },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
    })
    const hasMore = rows.length > take
    const pageRows = rows.slice(0, take)
    return {
      items: pageRows.map((row) => ({
        ...toMemberDataRequestItem(row),
        endUserId: row.endUserId,
        phoneMasked: maskPhoneFromEnc(row.endUser.phoneEnc),
        nickname: row.endUser.nickname,
        retryCount: row.retryCount,
        lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
        handledBy: row.handledBy,
        auditRef: row.auditRef,
      })),
      nextCursor: hasMore && pageRows.length > 0 ? encodeRequestCursor(pageRows[pageRows.length - 1]!) : null,
    }
  }

  async retry(id: string, handledBy: string): Promise<AdminMemberDataRequestItem> {
    this.assertQueueAvailable()
    this.assertIdentifier(id, 'DATA_REQUEST_NOT_FOUND', '数据请求不存在')
    this.assertIdentifier(handledBy, 'INVALID_ADMIN_ACTOR', '管理员身份无效')
    const existing = await this.prisma.userDataRequest.findUnique({ where: { id } })
    if (!existing) this.notFound()
    if (
      existing.requestType !== 'export'
      || !['pending', 'failed'].includes(existing.status)
      || existing.exportFileId !== null
      || existing.failureCode === 'EXPORT_CLEANUP_FAILED'
    ) {
      throw conflict('DATA_REQUEST_INVALID_TRANSITION', '当前数据请求不能重试')
    }
    if (existing.status === 'pending' && existing.workerJobId) {
      throw conflict('DATA_REQUEST_IN_PROGRESS', '数据导出任务已在队列中')
    }

    const executionVersion = existing.executionVersion + 1
    const row = await this.prisma.$transaction(async (tx) => {
      const cas = await tx.userDataRequest.updateMany({
        where: {
          id,
          requestType: 'export',
          executionVersion: existing.executionVersion,
          status: existing.status,
          workerJobId: existing.workerJobId,
          exportFileId: null,
          failureCode: existing.failureCode,
        },
        data: {
          status: 'pending',
          executionVersion,
          executionStep: null,
          workerJobId: null,
          failureCode: null,
          failureMessage: null,
          retryCount: existing.retryCount + 1,
          lastAttemptAt: null,
          handledAt: null,
          handledBy: null,
          auditRef: null,
        },
      })
      if (cas.count !== 1) throw conflict('DATA_REQUEST_INVALID_TRANSITION', '数据请求状态已变化')
      const auditRef = await this.audit.writeRequired(tx, {
        actorId: handledBy,
        actorRole: 'admin',
        action: 'member_data_request.retry',
        targetType: 'user_data_request',
        targetId: id,
        payload: { executionVersion },
      })
      return tx.userDataRequest.update({ where: { id }, data: { auditRef } })
    })
    const jobId = exportJobId(id, executionVersion)
    try {
      await this.queue!.add(MEMBER_EXPORT_JOB, { requestId: id, executionVersion }, exportJobOptions(jobId))
    } catch {
      await this.markQueueFailure(id, executionVersion)
      throw unavailable('QUEUE_ENQUEUE_FAILED', '数据导出任务暂时无法排队，请稍后重试')
    }
    const workerCas = await this.prisma.userDataRequest.updateMany({
      where: { id, executionVersion, workerJobId: null },
      data: { workerJobId: jobId },
    })
    if (workerCas.count !== 1) {
      throw unavailable('DATA_REQUEST_EXECUTION_INCOMPLETE', '数据导出任务状态尚未收敛')
    }
    return this.toAdminItem({ ...row, workerJobId: jobId })
  }

  async reject(id: string, handledBy: string, reason: string): Promise<AdminMemberDataRequestItem> {
    this.assertIdentifier(id, 'DATA_REQUEST_NOT_FOUND', '数据请求不存在')
    this.assertIdentifier(handledBy, 'INVALID_ADMIN_ACTOR', '管理员身份无效')
    this.assertRejectReason(reason)
    const row = await this.prisma.$transaction(async (tx) => {
      const current = await tx.userDataRequest.findUnique({ where: { id } })
      if (!current) this.notFound()
      if (
        current.requestType !== 'export'
        || !['pending', 'failed'].includes(current.status)
        || current.exportFileId !== null
        || current.failureCode === 'EXPORT_CLEANUP_FAILED'
      ) {
        throw conflict('DATA_REQUEST_INVALID_TRANSITION', '当前数据请求不能拒绝')
      }
      const auditRef = await this.audit.writeRequired(tx, {
        actorId: handledBy,
        actorRole: 'admin',
        action: 'member_data_request.reject',
        targetType: 'user_data_request',
        targetId: id,
        payload: { reason },
      })
      const handledAt = new Date()
      const cas = await tx.userDataRequest.updateMany({
        where: {
          id,
          requestType: 'export',
          status: current.status,
          executionVersion: current.executionVersion,
          exportFileId: null,
          failureCode: current.failureCode,
        },
        data: {
          status: 'rejected',
          activeKey: null,
          executionStep: null,
          handledAt,
          handledBy,
          auditRef,
        },
      })
      if (cas.count !== 1) throw conflict('DATA_REQUEST_INVALID_TRANSITION', '数据请求状态已变化')
      return { ...current, status: 'rejected', activeKey: null, executionStep: null, handledAt, handledBy, auditRef }
    })
    return this.toAdminItem(row)
  }

  private async toAdminItem(row: DataRequestRow): Promise<AdminMemberDataRequestItem> {
    const endUser = await this.prisma.endUser.findUnique({
      where: { id: row.endUserId },
      select: { phoneEnc: true, nickname: true },
    })
    if (!endUser) throw new NotFoundException({ error: { code: 'END_USER_NOT_FOUND', message: '会员不存在' } })
    return {
      ...toMemberDataRequestItem(row),
      endUserId: row.endUserId,
      phoneMasked: maskPhoneFromEnc(endUser.phoneEnc),
      nickname: endUser.nickname,
      retryCount: row.retryCount,
      lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
      handledBy: row.handledBy,
      auditRef: row.auditRef,
    }
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

  private assertRequestType(value: string): MemberDataRequestType {
    if (!REQUEST_TYPES.has(value as MemberDataRequestType)) {
      throw badRequest('INVALID_DATA_REQUEST_TYPE', '数据请求类型不支持')
    }
    return value as MemberDataRequestType
  }

  private assertStatus(value: string): MemberDataRequestStatus {
    if (!REQUEST_STATUSES.has(value as MemberDataRequestStatus)) {
      throw badRequest('INVALID_DATA_REQUEST_STATUS', '数据请求状态不支持')
    }
    return value as MemberDataRequestStatus
  }

  private assertIdentifier(value: string, code: string, message: string): void {
    if (typeof value !== 'string' || value.trim().length === 0 || value.length > 128) {
      throw badRequest(code, message)
    }
  }

  private assertRejectReason(reason: string): void {
    const normalized = reason.trim()
    if (normalized.length === 0 || normalized.length > 200 || /1[3-9]\d{9}/.test(normalized)) {
      throw badRequest('INVALID_REJECT_REASON', '拒绝原因格式无效，且不能包含完整手机号')
    }
  }

  private assertQueueAvailable(): void {
    if (!this.queue) throw unavailable('DATA_REQUEST_QUEUE_UNAVAILABLE', '数据导出队列暂不可用')
  }

  private notFound(): never {
    throw new NotFoundException({ error: { code: 'DATA_REQUEST_NOT_FOUND', message: '数据请求不存在' } })
  }
}
