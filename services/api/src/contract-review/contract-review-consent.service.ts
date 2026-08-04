import { createHash } from 'node:crypto'
import { Inject, Injectable, Optional, ServiceUnavailableException } from '@nestjs/common'
import { CONSENT_VERSION_BY_SCOPE } from '../member-privacy/member-privacy.service'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import { CONTRACT_REVIEW_CLOCK, type ContractReviewClock } from './contract-review.types'

export const CONTRACT_REVIEW_CONSENT_DISCLOSURES = Object.freeze({
  processorIdentityAndContact: 'provided_by_active_disclaimer',
  processingPurposeAndMethod: Object.freeze([
    'contract_risk_notice',
    'ocr_extraction',
    'deterministic_rules',
    'domestic_llm_analysis',
  ]),
  dataCategories: Object.freeze(['source_file', 'ocr_text', 'ai_review_result']),
  entrustedProcessingRoles: Object.freeze([
    'baidu_ocr_as_ocr_processor',
    'domestic_llm_as_ai_inference_processor',
  ]),
  retention: Object.freeze({ maximumHours: 2, sessionDeletionFirst: true }),
  dataSubjectRights: Object.freeze(['access', 'delete', 'withdraw_consent']),
  sensitivePersonalInformation: Object.freeze({
    separateConsentRequired: true,
    necessityAndImpactNoticeRequired: true,
  }),
})

export interface ContractReviewDisclaimerDocument {
  id: string
  version: string
  content: string
  publishedAt: Date
}

export interface ContractReviewConsentScopeSnapshot {
  scope: {
    scope: 'contract_review'
    consentVersion: string
    disclaimer: {
      id: string
      version: string
      contentSha256: string
      publishedAt: string
    }
    disclosures: typeof CONTRACT_REVIEW_CONSENT_DISCLOSURES
  }
  canonicalJson: string
  consentScopeHash: string
}

export interface ContractReviewPublicConsentScope {
  consentVersion: string
  consentScopeHash: string
  disclaimer: {
    id: string
    version: string
    content: string
    publishedAt: string
  }
  disclosures: typeof CONTRACT_REVIEW_CONSENT_DISCLOSURES
}

type LegalDocReader = Pick<PrismaService | PrismaTransactionClient, 'legalDocVersion'>

@Injectable()
export class ContractReviewConsentService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(CONTRACT_REVIEW_CLOCK)
    private readonly clock?: ContractReviewClock,
  ) {}

  async getConsentScope(): Promise<ContractReviewPublicConsentScope> {
    const nowMs = this.clock?.now() ?? Date.now()
    if (!Number.isFinite(nowMs)) throw legalConfigurationInvalid()
    const disclaimer = await loadActiveContractReviewDisclaimer(this.prisma, nowMs)
    const snapshot = createContractReviewConsentScopeSnapshot(disclaimer)
    return {
      consentVersion: snapshot.scope.consentVersion,
      consentScopeHash: snapshot.consentScopeHash,
      disclaimer: {
        id: disclaimer.id,
        version: disclaimer.version,
        content: disclaimer.content,
        publishedAt: disclaimer.publishedAt.toISOString(),
      },
      disclosures: snapshot.scope.disclosures,
    }
  }
}

export async function loadActiveContractReviewDisclaimer(
  reader: LegalDocReader,
  nowMs: number,
): Promise<ContractReviewDisclaimerDocument> {
  const active = await reader.legalDocVersion.findMany({
    where: { docType: 'contract_review_disclaimer', isActive: true },
    orderBy: { id: 'asc' },
    take: 2,
    select: { id: true, version: true, content: true, publishedAt: true },
  })
  const disclaimer = active[0]
  if (
    active.length !== 1 ||
    !disclaimer ||
    disclaimer.id.trim().length === 0 ||
    disclaimer.version.trim().length === 0 ||
    disclaimer.content.trim().length === 0 ||
    !(disclaimer.publishedAt instanceof Date) ||
    !Number.isFinite(disclaimer.publishedAt.getTime()) ||
    disclaimer.publishedAt.getTime() > nowMs
  ) {
    throw legalConfigurationInvalid()
  }
  return {
    id: disclaimer.id,
    version: disclaimer.version,
    content: disclaimer.content,
    publishedAt: disclaimer.publishedAt as Date,
  }
}

export function createContractReviewConsentScopeSnapshot(
  disclaimer: ContractReviewDisclaimerDocument,
): ContractReviewConsentScopeSnapshot {
  const scope = {
    scope: 'contract_review' as const,
    consentVersion: CONSENT_VERSION_BY_SCOPE.contract_review,
    disclaimer: {
      id: disclaimer.id,
      version: disclaimer.version,
      contentSha256: createHash('sha256').update(disclaimer.content, 'utf8').digest('hex'),
      publishedAt: disclaimer.publishedAt.toISOString(),
    },
    disclosures: CONTRACT_REVIEW_CONSENT_DISCLOSURES,
  }
  const canonical = canonicalJson(scope)
  return {
    scope,
    canonicalJson: canonical,
    consentScopeHash: createHash('sha256').update(canonical, 'utf8').digest('hex'),
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Non-finite canonical JSON number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`
  }
  throw new TypeError('Unsupported canonical JSON value')
}

function legalConfigurationInvalid(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    error: {
      code: 'CONTRACT_REVIEW_LEGAL_CONFIGURATION_INVALID',
      message: '合同审查服务暂不可用，请稍后再试',
    },
  })
}
