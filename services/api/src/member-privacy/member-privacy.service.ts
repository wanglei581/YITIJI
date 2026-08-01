import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { MemberAiConsentScope, MemberAiConsentStatus } from './member-privacy.types'

export const CURRENT_JOB_AI_CONSENT_VERSION = '20260701'
export const CONSENT_VERSION_BY_SCOPE: Readonly<Record<MemberAiConsentScope, string>> = {
  job_ai: CURRENT_JOB_AI_CONSENT_VERSION,
  contract_review: 'contract-review-consent-v1',
}

const CONSENT_SCOPES = [
  'job_ai',
  'contract_review',
] as const satisfies readonly MemberAiConsentScope[]
const CONSENT_SCOPE_SET: ReadonlySet<string> = new Set(CONSENT_SCOPES)
const CONTRACT_REVIEW_PROCESSING_STATUSES = [
  'uploaded',
  'queued',
  'extracting',
  'awaiting_confirmation',
  'rule_checking',
  'ai_analyzing',
  'safety_reviewing',
] as const

interface ConsentTruthEvent {
  id: string
  consentVersion: string
  grantedAt: Date
  revokedAt: Date | null
}

export function consentVersionForScope(scope: MemberAiConsentScope): string {
  if (!CONSENT_SCOPE_SET.has(scope)) {
    throw new BadRequestException({
      error: { code: 'INVALID_AI_CONSENT_SCOPE', message: 'AI 授权范围不支持' },
    })
  }
  return CONSENT_VERSION_BY_SCOPE[scope]
}

@Injectable()
export class MemberPrivacyService {
  constructor(private readonly prisma: PrismaService) {}

  async getConsentStatus(endUserId: string): Promise<MemberAiConsentStatus[]> {
    return Promise.all(
      CONSENT_SCOPES.map(async (scope) => {
        const latest = await this.latestConsentEvent(endUserId, scope)
        return this.consentStatus(scope, latest)
      })
    )
  }

  async grantConsent(
    endUserId: string,
    scope: MemberAiConsentScope,
    terminalId: string | null
  ): Promise<MemberAiConsentStatus> {
    this.assertScope(scope)
    const consentVersion = consentVersionForScope(scope)
    // Grant is an append-only authorization event; previous grant rows remain as history.
    const row = await this.prisma.userAiConsent.create({
      data: {
        endUserId,
        scope,
        consentVersion,
        terminalId,
      },
    })
    return this.consentStatus(scope, row)
  }

  async revokeConsent(
    endUserId: string,
    scope: MemberAiConsentScope
  ): Promise<{ revoked: true; count: number }> {
    this.assertScope(scope)
    if (scope === 'contract_review') {
      try {
        const count = await this.prisma.$transaction(async (tx) => {
          const consentResult = await tx.userAiConsent.updateMany({
            where: { endUserId, scope, revokedAt: null },
            data: { revokedAt: new Date() },
          })
          await tx.contractReviewTask.updateMany({
            where: {
              endUserId,
              status: { in: [...CONTRACT_REVIEW_PROCESSING_STATUSES] },
            },
            data: { status: 'cancelled' },
          })
          return consentResult.count
        })
        return { revoked: true, count }
      } catch {
        throw new InternalServerErrorException({
          error: {
            code: 'CONTRACT_REVIEW_CONSENT_REVOKE_FAILED',
            message: '撤回合同审查授权失败，请稍后重试',
          },
        })
      }
    }
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
          message:
            scope === 'job_ai'
              ? '请登录并确认 AI 简历分析授权后再使用岗位推荐'
              : '请登录并确认合同审查 AI 授权后再使用合同审查',
        },
      })
    }
    const latest = await this.latestConsentEvent(endUserId, scope)
    if (!this.consentStatus(scope, latest).granted) {
      throw new ForbiddenException({
        error: {
          code: 'USER_AI_CONSENT_REQUIRED',
          message: scope === 'job_ai' ? '请先确认 AI 简历分析授权' : '请先确认合同审查 AI 授权',
        },
      })
    }
  }

  private assertScope(scope: string): asserts scope is MemberAiConsentScope {
    consentVersionForScope(scope as MemberAiConsentScope)
  }

  private latestConsentEvent(
    endUserId: string,
    scope: MemberAiConsentScope
  ): Promise<ConsentTruthEvent | null> {
    return this.prisma.userAiConsent.findFirst({
      where: { endUserId, scope },
      orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        consentVersion: true,
        grantedAt: true,
        revokedAt: true,
      },
    })
  }

  private consentStatus(
    scope: MemberAiConsentScope,
    row: ConsentTruthEvent | null
  ): MemberAiConsentStatus {
    const consentVersion = consentVersionForScope(scope)
    const granted = Boolean(row && row.consentVersion === consentVersion && !row.revokedAt)
    return {
      scope,
      consentVersion,
      granted,
      grantedAt: row ? row.grantedAt.toISOString() : null,
      revokedAt: row?.revokedAt ? row.revokedAt.toISOString() : null,
    }
  }
}
