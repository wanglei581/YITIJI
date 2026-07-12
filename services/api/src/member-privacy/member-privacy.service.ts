import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type {
  AdminMemberDataRequestItem,
  MemberAiConsentScope,
  MemberAiConsentStatus,
  MemberDataRequestItem,
  MemberDataRequestStatus,
  MemberDataRequestType,
} from './member-privacy.types'

export const CURRENT_JOB_AI_CONSENT_VERSION = '20260701'

const CONSENT_SCOPES = new Set<MemberAiConsentScope>(['job_ai'])
const REQUEST_TYPES = new Set<MemberDataRequestType>(['export', 'delete', 'revoke_consent'])
const REQUEST_STATUSES = new Set<MemberDataRequestStatus>(['pending', 'handling', 'completed', 'rejected'])

@Injectable()
export class MemberPrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getConsentStatus(endUserId: string): Promise<MemberAiConsentStatus[]> {
    const latest = await this.prisma.userAiConsent.findFirst({
      where: { endUserId, scope: 'job_ai' },
      orderBy: { grantedAt: 'desc' },
    })
    return [this.consentStatus('job_ai', latest ?? null)]
  }

  async grantConsent(
    endUserId: string,
    scope: MemberAiConsentScope,
    terminalId: string | null,
  ): Promise<MemberAiConsentStatus> {
    this.assertScope(scope)
    const row = await this.prisma.userAiConsent.create({
      data: {
        endUserId,
        scope,
        consentVersion: CURRENT_JOB_AI_CONSENT_VERSION,
        terminalId,
      },
    })
    return this.consentStatus(scope, row)
  }

  async revokeConsent(endUserId: string, scope: MemberAiConsentScope): Promise<{ revoked: true; count: number }> {
    this.assertScope(scope)
    const result = await this.prisma.userAiConsent.updateMany({
      where: { endUserId, scope, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    return { revoked: true, count: result.count }
  }

  async requireActiveConsent(endUserId: string | null, scope: MemberAiConsentScope): Promise<void> {
    this.assertScope(scope)
    if (!endUserId) {
      throw new ForbiddenException({
        error: {
          code: 'USER_AI_CONSENT_REQUIRED',
          message: '请登录并确认 AI 简历分析授权后再使用岗位推荐',
        },
      })
    }
    const consent = await this.prisma.userAiConsent.findFirst({
      where: {
        endUserId,
        scope,
        consentVersion: CURRENT_JOB_AI_CONSENT_VERSION,
        revokedAt: null,
      },
      orderBy: { grantedAt: 'desc' },
      select: { id: true },
    })
    if (!consent) {
      throw new ForbiddenException({
        error: {
          code: 'USER_AI_CONSENT_REQUIRED',
          message: '请先确认 AI 简历分析授权',
        },
      })
    }
  }

  async listMyDataRequests(endUserId: string): Promise<MemberDataRequestItem[]> {
    const rows = await this.prisma.userDataRequest.findMany({
      where: { endUserId },
      orderBy: { requestedAt: 'desc' },
      take: 50,
    })
    return rows.map(toMemberDataRequestItem)
  }

  async createDataRequest(endUserId: string, requestType: MemberDataRequestType): Promise<MemberDataRequestItem> {
    this.assertRequestType(requestType)
    if (requestType === 'revoke_consent') {
      await this.revokeConsent(endUserId, 'job_ai')
    }
    const row = await this.prisma.userDataRequest.create({
      data: {
        endUserId,
        requestType,
        status: 'pending',
      },
    })
    return toMemberDataRequestItem(row)
  }

  async listDataRequestsForAdmin(status?: string): Promise<AdminMemberDataRequestItem[]> {
    const where = status && REQUEST_STATUSES.has(status as MemberDataRequestStatus) ? { status } : {}
    const rows = await this.prisma.userDataRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      take: 100,
    })
    return rows.map((row) => ({ ...toMemberDataRequestItem(row), endUserId: row.endUserId }))
  }

  async handleDataRequest(
    id: string,
    input: { status: MemberDataRequestStatus; handledBy: string; auditRef?: string | null },
  ): Promise<AdminMemberDataRequestItem> {
    if (!REQUEST_STATUSES.has(input.status)) {
      throw new BadRequestException({ error: { code: 'INVALID_DATA_REQUEST_STATUS', message: '数据请求状态不支持' } })
    }
    const existing = await this.prisma.userDataRequest.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException({ error: { code: 'DATA_REQUEST_NOT_FOUND', message: '数据请求不存在或已处理' } })
    }
    const terminal = input.status === 'completed' || input.status === 'rejected'
    const deletion = existing.requestType === 'delete' && input.status === 'completed'
      ? await this.deleteJobAiPersonalData(existing.endUserId)
      : null
    // 删除请求的审计凭证必须由本次成功事务后生成；不得接受调用方传入的任意 auditRef。
    const auditRef = deletion || !input.auditRef ? await this.audit.write({
      actorId: input.handledBy,
      actorRole: 'admin',
      action: 'member_data_request.handle',
      targetType: 'user_data_request',
      targetId: id,
      // 删除类审计只留安全计数，绝不写入简历派生 payload 或其它敏感内容。
      payload: deletion
        ? {
            aiResumeResultsDeleted: deletion.aiResumeResultsDeleted,
            jobAiSessionsDeleted: deletion.jobAiSessionsDeleted,
            consentsRevoked: deletion.consentsRevoked,
          }
        : {
            endUserId: existing.endUserId,
            requestType: existing.requestType,
            fromStatus: existing.status,
            toStatus: input.status,
          },
    }) : input.auditRef
    const row = await this.prisma.userDataRequest.update({
      where: { id },
      data: {
        status: input.status,
        handledBy: input.handledBy,
        auditRef,
        handledAt: terminal ? new Date() : null,
      },
    })
    return { ...toMemberDataRequestItem(row), endUserId: row.endUserId }
  }

  private async deleteJobAiPersonalData(endUserId: string): Promise<{
    aiResumeResultsDeleted: number
    jobAiSessionsDeleted: number
    consentsRevoked: number
  }> {
    return this.prisma.$transaction(async (tx) => {
      const [results, sessions, consents] = await Promise.all([
        tx.aiResumeResult.deleteMany({ where: { endUserId } }),
        tx.jobAiSession.deleteMany({ where: { endUserId } }),
        tx.userAiConsent.updateMany({
          where: { endUserId, scope: 'job_ai', revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      ])
      return {
        aiResumeResultsDeleted: results.count,
        jobAiSessionsDeleted: sessions.count,
        consentsRevoked: consents.count,
      }
    })
  }

  private assertScope(scope: string): asserts scope is MemberAiConsentScope {
    if (!CONSENT_SCOPES.has(scope as MemberAiConsentScope)) {
      throw new BadRequestException({ error: { code: 'INVALID_AI_CONSENT_SCOPE', message: 'AI 授权范围不支持' } })
    }
  }

  private assertRequestType(requestType: string): asserts requestType is MemberDataRequestType {
    if (!REQUEST_TYPES.has(requestType as MemberDataRequestType)) {
      throw new BadRequestException({ error: { code: 'INVALID_DATA_REQUEST_TYPE', message: '数据请求类型不支持' } })
    }
  }

  private consentStatus(
    scope: MemberAiConsentScope,
    row: { consentVersion: string; grantedAt: Date; revokedAt: Date | null } | null,
  ): MemberAiConsentStatus {
    const granted = Boolean(row && row.consentVersion === CURRENT_JOB_AI_CONSENT_VERSION && !row.revokedAt)
    return {
      scope,
      consentVersion: CURRENT_JOB_AI_CONSENT_VERSION,
      granted,
      grantedAt: row ? row.grantedAt.toISOString() : null,
      revokedAt: row?.revokedAt ? row.revokedAt.toISOString() : null,
    }
  }
}

function toMemberDataRequestItem(row: {
  id: string
  requestType: string
  status: string
  requestedAt: Date
  handledAt: Date | null
  handledBy: string | null
  auditRef: string | null
}): MemberDataRequestItem {
  return {
    id: row.id,
    requestType: row.requestType as MemberDataRequestType,
    status: row.status as MemberDataRequestStatus,
    requestedAt: row.requestedAt.toISOString(),
    handledAt: row.handledAt ? row.handledAt.toISOString() : null,
    handledBy: row.handledBy,
    auditRef: row.auditRef,
  }
}
