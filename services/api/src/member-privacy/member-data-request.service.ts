import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { MemberStepUpService } from '../member-auth/member-step-up.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  MEMBER_DATA_REQUEST_STATUSES,
  MEMBER_DATA_REQUEST_TYPES,
  type AdminMemberDataRequestItem,
  type MemberDataRequestItem,
  type MemberDataRequestPage,
  type MemberDataRequestStatus,
  type MemberDataRequestType,
} from './member-privacy.types'

const REQUEST_TYPES = new Set<MemberDataRequestType>(MEMBER_DATA_REQUEST_TYPES)
const REQUEST_STATUSES = new Set<MemberDataRequestStatus>(MEMBER_DATA_REQUEST_STATUSES)
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE_SIZE = 50

export interface CreateMemberDataRequestInput {
  requestType: MemberDataRequestType
  idempotencyKey: string | null
  stepUpToken: string | null
  terminalId: string | null
}

type DataRequestRow = {
  id: string
  endUserId: string
  requestType: string
  status: string
  requestedAt: Date
  handledAt: Date | null
  idempotencyKey: string | null
  activeKey: string | null
  executionStep: string | null
  exportFileId: string | null
  exportExpiresAt: Date | null
  downloadConsumedAt: Date | null
  failureCode: string | null
}

@Injectable()
export class MemberDataRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stepUp: MemberStepUpService,
  ) {}

  async listMyDataRequests(endUserId: string, cursor?: string): Promise<MemberDataRequestPage> {
    if (cursor) {
      const cursorRow = await this.prisma.userDataRequest.findFirst({
        where: { id: cursor, endUserId },
        select: { id: true },
      })
      if (!cursorRow) {
        throw new BadRequestException({ error: { code: 'INVALID_DATA_REQUEST_CURSOR', message: '数据请求分页游标无效' } })
      }
    }

    const rows = await this.prisma.userDataRequest.findMany({
      where: { endUserId },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: PAGE_SIZE + 1,
    })
    const items = rows.slice(0, PAGE_SIZE).map(toMemberDataRequestItem)
    return {
      items,
      nextCursor: rows.length > PAGE_SIZE ? items.at(-1)?.id ?? null : null,
    }
  }

  async create(endUserId: string, input: CreateMemberDataRequestInput): Promise<MemberDataRequestItem> {
    this.assertRequestType(input.requestType)

    // 账户注销尚没有获批的分类留存矩阵、冷静期和独立执行开关。这里必须
    // 位于任何依赖访问之前，不能创建账本、消费 grant 或留下待处理错觉。
    if (input.requestType === 'delete') throw this.accountClosureUnavailable()

    const idempotencyKey = this.requireIdempotencyKey(input.idempotencyKey)
    const replay = await this.findIdempotentRequest(endUserId, idempotencyKey)
    if (replay) return this.toIdempotentItem(replay, input.requestType)

    if (input.requestType === 'revoke_consent') {
      return this.createConsentRevocation(endUserId, idempotencyKey)
    }
    return this.createExportRequest(endUserId, idempotencyKey, input.stepUpToken, input.terminalId)
  }

  async listDataRequestsForAdmin(status?: string): Promise<AdminMemberDataRequestItem[]> {
    if (status && !REQUEST_STATUSES.has(status as MemberDataRequestStatus)) {
      throw new BadRequestException({ error: { code: 'INVALID_DATA_REQUEST_STATUS', message: '数据请求状态不支持' } })
    }
    const rows = await this.prisma.userDataRequest.findMany({
      where: status ? { status } : {},
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      take: 100,
    })
    return rows.map((row) => ({ ...toMemberDataRequestItem(row), endUserId: row.endUserId }))
  }

  async rejectExportRequest(id: string, handledBy: string, requestedStatus: 'rejected'): Promise<AdminMemberDataRequestItem> {
    if (requestedStatus !== 'rejected') {
      throw new BadRequestException({ error: { code: 'INVALID_DATA_REQUEST_STATUS', message: '数据请求状态不支持' } })
    }
    const existing = await this.prisma.userDataRequest.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException({ error: { code: 'DATA_REQUEST_NOT_FOUND', message: '数据请求不存在' } })
    }
    if (existing.requestType !== 'export') {
      throw new BadRequestException({ error: { code: 'DATA_REQUEST_ACTION_NOT_ALLOWED', message: '仅可拒绝资料导出请求' } })
    }
    if (existing.status !== 'pending' && existing.status !== 'failed') {
      throw new BadRequestException({ error: { code: 'DATA_REQUEST_STATUS_NOT_REJECTABLE', message: '仅可拒绝待处理或失败的资料导出请求' } })
    }
    const row = await this.prisma.userDataRequest.update({
      where: { id },
      data: {
        status: 'rejected',
        activeKey: null,
        executionStep: 'admin_rejected',
        handledAt: new Date(),
        handledBy,
      },
    })
    return { ...toMemberDataRequestItem(row), endUserId: row.endUserId }
  }

  private async createConsentRevocation(endUserId: string, idempotencyKey: string): Promise<MemberDataRequestItem> {
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const replay = await tx.userDataRequest.findUnique({
          where: { endUserId_idempotencyKey: { endUserId, idempotencyKey } },
        })
        if (replay) return { kind: 'replay' as const, row: replay }

        await tx.userAiConsent.updateMany({
          where: { endUserId, scope: 'job_ai', revokedAt: null },
          data: { revokedAt: new Date() },
        })
        const created = await tx.userDataRequest.create({
          data: {
            endUserId,
            requestType: 'revoke_consent',
            status: 'completed',
            idempotencyKey,
            executionStep: 'consent_revoked',
            handledAt: new Date(),
          },
        })
        return { kind: 'created' as const, row: created }
      })
      return result.kind === 'replay'
        ? this.toIdempotentItem(result.row, 'revoke_consent')
        : toMemberDataRequestItem(result.row)
    } catch (error) {
      const replay = await this.findIdempotentRequest(endUserId, idempotencyKey)
      if (replay) return this.toIdempotentItem(replay, 'revoke_consent')
      throw error
    }
  }

  private async createExportRequest(
    endUserId: string,
    idempotencyKey: string,
    stepUpToken: string | null,
    terminalId: string | null,
  ): Promise<MemberDataRequestItem> {
    if (!stepUpToken) {
      throw new BadRequestException({ error: { code: 'MEMBER_STEP_UP_TOKEN_REQUIRED', message: '资料导出需要二次验证授权' } })
    }

    const row = await this.reserveExportRequest(endUserId, idempotencyKey)
    if ('replay' in row) return this.toIdempotentItem(row.replay, 'export')

    try {
      await this.stepUp.consumeGrant(endUserId, 'export_data_request', stepUpToken, terminalId ?? undefined)
    } catch (error) {
      await this.releaseUnauthorizedReservation(row.created.id)
      throw error
    }
    return toMemberDataRequestItem(row.created)
  }

  private async reserveExportRequest(endUserId: string, idempotencyKey: string): Promise<{ replay: DataRequestRow } | { created: DataRequestRow }> {
    const activeKey = this.activeKeyFor(endUserId)
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.userDataRequest.findUnique({
          where: { endUserId_idempotencyKey: { endUserId, idempotencyKey } },
        })
        if (replay) {
          this.assertReplayType(replay, 'export')
          return { replay }
        }

        const active = await tx.userDataRequest.findUnique({ where: { activeKey } })
        if (active) throw this.activeRequestConflict()

        const user = await tx.endUser.findUnique({
          where: { id: endUserId },
          select: { enabled: true, status: true },
        })
        if (!user || !user.enabled || user.status !== 'active') throw this.accountUnavailable()

        const created = await tx.userDataRequest.create({
          data: {
            endUserId,
            requestType: 'export',
            status: 'pending',
            idempotencyKey,
            activeKey,
            executionVersion: 0,
            executionStep: 'awaiting_export_worker',
          },
        })
        return { created }
      })
    } catch (error) {
      if (!this.isUniqueConstraint(error)) throw error
      const replay = await this.findIdempotentRequest(endUserId, idempotencyKey)
      if (replay) {
        this.assertReplayType(replay, 'export')
        return { replay }
      }
      throw this.activeRequestConflict()
    }
  }

  private async releaseUnauthorizedReservation(id: string): Promise<void> {
    try {
      await this.prisma.userDataRequest.delete({ where: { id } })
    } catch {
      throw new ServiceUnavailableException({
        error: {
          code: 'DATA_REQUEST_RESERVATION_CLEANUP_FAILED',
          message: '资料导出授权校验失败，系统正在保护性处理中，请稍后再试',
        },
      })
    }
  }

  private findIdempotentRequest(endUserId: string, idempotencyKey: string): Promise<DataRequestRow | null> {
    return this.prisma.userDataRequest.findUnique({
      where: { endUserId_idempotencyKey: { endUserId, idempotencyKey } },
    })
  }

  private assertRequestType(requestType: string): asserts requestType is MemberDataRequestType {
    if (!REQUEST_TYPES.has(requestType as MemberDataRequestType)) {
      throw new BadRequestException({ error: { code: 'INVALID_DATA_REQUEST_TYPE', message: '数据请求类型不支持' } })
    }
  }

  private requireIdempotencyKey(idempotencyKey: string | null): string {
    if (!idempotencyKey || !UUID_PATTERN.test(idempotencyKey)) {
      throw new BadRequestException({ error: { code: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key 必须是 UUID' } })
    }
    return idempotencyKey.toLowerCase()
  }

  private activeKeyFor(endUserId: string): string {
    return `member-data-request:${endUserId}`
  }

  private toIdempotentItem(row: DataRequestRow, requestType: MemberDataRequestType): MemberDataRequestItem {
    this.assertReplayType(row, requestType)
    return toMemberDataRequestItem(row)
  }

  private assertReplayType(row: DataRequestRow, requestType: MemberDataRequestType): void {
    if (row.requestType !== requestType) {
      throw new ConflictException({
        error: {
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: '该 Idempotency-Key 已用于另一类数据请求，请生成新的 UUID',
        },
      })
    }
  }

  private accountUnavailable(): ForbiddenException {
    return new ForbiddenException({
      error: {
        code: 'ACCOUNT_UNAVAILABLE',
        message: '当前账号不可用，无法创建数据请求',
      },
    })
  }

  private accountClosureUnavailable(): ConflictException {
    return new ConflictException({
      error: {
        code: 'ACCOUNT_CLOSURE_NOT_AVAILABLE',
        message: '账户注销服务暂未开放，当前无法受理账户注销请求',
      },
    })
  }

  private activeRequestConflict(): ConflictException {
    return new ConflictException({
      error: {
        code: 'DATA_REQUEST_ACTIVE',
        message: '当前已有正在处理的数据请求，请勿重复提交',
      },
    })
  }

  private isUniqueConstraint(error: unknown): boolean {
    return (error as { code?: string } | null)?.code === 'P2002'
  }
}

export function toMemberDataRequestItem(row: DataRequestRow): MemberDataRequestItem {
  const requestType = row.requestType as MemberDataRequestType
  const status = row.status as MemberDataRequestStatus
  return {
    id: row.id,
    requestType,
    status,
    requestedAt: row.requestedAt.toISOString(),
    handledAt: row.handledAt ? row.handledAt.toISOString() : null,
    executionStep: row.executionStep,
    exportExpiresAt: row.exportExpiresAt ? row.exportExpiresAt.toISOString() : null,
    failureCode: row.failureCode,
    canRetry: requestType === 'export' && status === 'failed',
    canDownload: requestType === 'export'
      && status === 'ready'
      && Boolean(row.exportFileId && row.exportExpiresAt && row.exportExpiresAt > new Date() && !row.downloadConsumedAt),
  }
}
