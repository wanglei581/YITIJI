import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type {
  MemberAiConsentScope,
  MemberAiConsentStatus,
} from './member-privacy.types'

export const CURRENT_JOB_AI_CONSENT_VERSION = '20260701'

const CONSENT_SCOPES = new Set<MemberAiConsentScope>(['job_ai'])

@Injectable()
export class MemberPrivacyService {
  constructor(private readonly prisma: PrismaService) {}

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

  private assertScope(scope: string): asserts scope is MemberAiConsentScope {
    if (!CONSENT_SCOPES.has(scope as MemberAiConsentScope)) {
      throw new BadRequestException({ error: { code: 'INVALID_AI_CONSENT_SCOPE', message: 'AI 授权范围不支持' } })
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
