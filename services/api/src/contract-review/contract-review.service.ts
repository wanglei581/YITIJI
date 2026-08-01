import { createHash } from 'node:crypto'
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { parseAndVerifySignedContentUrl } from '../files/signing'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import {
  CONSENT_VERSION_BY_SCOPE,
  MemberPrivacyService,
  SerializableTransactionRetryExhaustedError,
  runSerializableTransaction,
  type ConsentTruthEvent,
} from '../member-privacy/member-privacy.service'
import { issueAnonymousAccessToken } from './contract-review-access'
import { assertOwnerShape } from './contract-review-state'
import type {
  ContractReviewCreateInput,
  ContractReviewCreatedTask,
  ContractReviewRequester,
  ContractReviewSourceFile,
  ContractType,
} from './contract-review.types'

const CONTRACT_TYPES: ReadonlySet<string> = new Set<ContractType>([
  'labor_contract',
  'internship_agreement',
  'non_compete',
  'offer',
])

export const CONTRACT_REVIEW_RULE_PACK_VERSION = 'cn-labor-p0-v1'
export const CONTRACT_REVIEW_SCHEMA_VERSION = 'contract-review-result-v1'
const ANONYMOUS_CONSENT_MAX_AGE_MS = 15 * 60 * 1000
const ANONYMOUS_CONSENT_FUTURE_SKEW_MS = 60 * 1000

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
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`
  }
  throw new TypeError('Unsupported canonical JSON value')
}

/** Pure SSOT used by the API snapshot validator and the Task 12 public consent contract. */
export function createContractReviewConsentScopeSnapshot(
  disclaimer: ContractReviewDisclaimerDocument
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

interface ConsentSnapshot {
  consentVersion: string
  consentedAt: Date
  consentScopeHash: string
  disclaimerVersion: string
}

@Injectable()
export class ContractReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberPrivacy: MemberPrivacyService
  ) {}

  async create(
    input: ContractReviewCreateInput,
    requester: ContractReviewRequester
  ): Promise<ContractReviewCreatedTask> {
    this.assertCreateInput(input)
    const memberId = this.memberIdOf(requester, input.sourceFileId)
    const issuedToken = memberId ? null : issueAnonymousAccessToken()

    try {
      const task = await runSerializableTransaction(this.prisma, async (tx) => {
        const sourceFile = await this.loadSourceFile(tx, input.sourceFileId)
        this.assertUsableSourceFile(sourceFile, requester)
        const disclaimer = await this.loadActiveDisclaimer(tx)
        const scopeSnapshot = createContractReviewConsentScopeSnapshot(disclaimer)
        this.assertRequestedConsentBinding(input, scopeSnapshot)

        if (memberId) {
          const consent = await this.memberPrivacy.requireActiveConsentInTransaction(
            tx,
            memberId,
            'contract_review'
          )
          return this.createTask(tx, input, sourceFile, {
            endUserId: memberId,
            accessTokenHash: null,
            consent: this.memberConsentSnapshot(consent, disclaimer, scopeSnapshot),
          })
        }

        return this.createTask(tx, input, sourceFile, {
          endUserId: null,
          accessTokenHash: issuedToken!.accessTokenHash,
          consent: this.requireAnonymousConsentSnapshot(input, disclaimer, scopeSnapshot),
        })
      })

      return {
        id: task.id,
        status: 'uploaded',
        expiresAt: task.expiresAt.toISOString(),
        ...(issuedToken ? { accessToken: issuedToken.accessToken } : {}),
      }
    } catch (error) {
      if (error instanceof HttpException) throw error
      if (error instanceof SerializableTransactionRetryExhaustedError) {
        throw new ServiceUnavailableException({
          error: {
            code: 'CONTRACT_REVIEW_TRANSACTION_RETRY',
            message: '请求冲突，请稍后重试',
            retryable: true,
          },
        })
      }
      throw new InternalServerErrorException({
        error: {
          code: 'CONTRACT_REVIEW_CREATE_FAILED',
          message: '合同审查任务创建失败，请稍后重试',
        },
      })
    }
  }

  private async loadSourceFile(
    tx: PrismaTransactionClient,
    sourceFileId: string
  ): Promise<ContractReviewSourceFile | null> {
    return tx.fileObject.findUnique({
      where: { id: sourceFileId },
      select: {
        id: true,
        purpose: true,
        status: true,
        expiresAt: true,
        deletedAt: true,
        endUserId: true,
        ownerType: true,
        ownerId: true,
      },
    })
  }

  private async loadActiveDisclaimer(
    tx: PrismaTransactionClient
  ): Promise<ContractReviewDisclaimerDocument> {
    const active = await tx.legalDocVersion.findMany({
      where: { docType: 'contract_review_disclaimer', isActive: true },
      orderBy: { id: 'asc' },
      take: 2,
      select: {
        id: true,
        version: true,
        content: true,
        publishedAt: true,
      },
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
      disclaimer.publishedAt.getTime() > Date.now()
    ) {
      throw new ServiceUnavailableException({
        error: {
          code: 'CONTRACT_REVIEW_LEGAL_CONFIGURATION_INVALID',
          message: '合同审查服务暂不可用，请稍后再试',
        },
      })
    }
    return {
      id: disclaimer.id,
      version: disclaimer.version,
      content: disclaimer.content,
      publishedAt: disclaimer.publishedAt,
    }
  }

  private assertUsableSourceFile(
    sourceFile: ContractReviewSourceFile | null,
    requester: ContractReviewRequester
  ): asserts sourceFile is ContractReviewSourceFile & { expiresAt: Date } {
    const expiresAt = sourceFile?.expiresAt
    const isAlive =
      expiresAt instanceof Date &&
      Number.isFinite(expiresAt.getTime()) &&
      expiresAt.getTime() > Date.now()
    const validPolicy =
      sourceFile?.purpose === 'contract_upload' &&
      sourceFile.status === 'active' &&
      sourceFile.deletedAt === null &&
      isAlive
    const memberOwned =
      Boolean(requester.endUserId) &&
      sourceFile?.endUserId === requester.endUserId &&
      sourceFile.ownerType === 'user' &&
      sourceFile.ownerId === requester.endUserId
    const anonymousOwned =
      requester.endUserId === null &&
      sourceFile?.endUserId === null &&
      sourceFile.ownerType === 'system' &&
      sourceFile.ownerId === null

    if (!validPolicy || (!memberOwned && !anonymousOwned)) throw this.sourceNotFound()
  }

  private async createTask(
    tx: PrismaTransactionClient,
    input: ContractReviewCreateInput,
    sourceFile: ContractReviewSourceFile & { expiresAt: Date },
    owner: {
      endUserId: string | null
      accessTokenHash: string | null
      consent: ConsentSnapshot
    }
  ): Promise<{ id: string; expiresAt: Date }> {
    assertOwnerShape(owner)
    return tx.contractReviewTask.create({
      data: {
        endUserId: owner.endUserId,
        accessTokenHash: owner.accessTokenHash,
        sourceFileId: sourceFile.id,
        resultFileId: null,
        contractType: input.contractType,
        status: 'uploaded',
        consentVersion: owner.consent.consentVersion,
        consentedAt: owner.consent.consentedAt,
        consentScopeHash: owner.consent.consentScopeHash,
        disclaimerVersion: owner.consent.disclaimerVersion,
        rulePackVersion: CONTRACT_REVIEW_RULE_PACK_VERSION,
        schemaVersion: CONTRACT_REVIEW_SCHEMA_VERSION,
        expiresAt: sourceFile.expiresAt,
      },
      select: { id: true, expiresAt: true },
    })
  }

  private memberConsentSnapshot(
    consent: ConsentTruthEvent,
    disclaimer: ContractReviewDisclaimerDocument,
    scopeSnapshot: ContractReviewConsentScopeSnapshot
  ): ConsentSnapshot {
    if (
      consent.consentVersion !== CONSENT_VERSION_BY_SCOPE.contract_review ||
      !(consent.grantedAt instanceof Date) ||
      !Number.isFinite(consent.grantedAt.getTime()) ||
      consent.grantedAt.getTime() < disclaimer.publishedAt.getTime()
    ) {
      throw this.consentRequired()
    }
    return {
      consentVersion: consent.consentVersion,
      consentedAt: consent.grantedAt,
      consentScopeHash: scopeSnapshot.consentScopeHash,
      disclaimerVersion: disclaimer.version,
    }
  }

  private requireAnonymousConsentSnapshot(
    input: ContractReviewCreateInput,
    disclaimer: ContractReviewDisclaimerDocument,
    scopeSnapshot: ContractReviewConsentScopeSnapshot
  ): ConsentSnapshot {
    const consentedAt = new Date(input.consentedAt)
    const now = Date.now()
    if (
      input.consentVersion !== CONSENT_VERSION_BY_SCOPE.contract_review ||
      typeof input.consentedAt !== 'string' ||
      !input.consentedAt ||
      !Number.isFinite(consentedAt.getTime()) ||
      consentedAt.getTime() > now + ANONYMOUS_CONSENT_FUTURE_SKEW_MS ||
      consentedAt.getTime() < now - ANONYMOUS_CONSENT_MAX_AGE_MS ||
      consentedAt.getTime() < disclaimer.publishedAt.getTime()
    ) {
      throw this.invalidConsentSnapshot()
    }
    return {
      consentVersion: input.consentVersion,
      consentedAt,
      consentScopeHash: scopeSnapshot.consentScopeHash,
      disclaimerVersion: disclaimer.version,
    }
  }

  private assertRequestedConsentBinding(
    input: ContractReviewCreateInput,
    scopeSnapshot: ContractReviewConsentScopeSnapshot
  ): void {
    if (
      input.disclaimerVersion !== scopeSnapshot.scope.disclaimer.version ||
      input.consentScopeHash !== scopeSnapshot.consentScopeHash
    ) {
      throw this.invalidConsentSnapshot()
    }
  }

  private assertCreateInput(input: ContractReviewCreateInput): void {
    if (
      typeof input.sourceFileId !== 'string' ||
      !input.sourceFileId.trim() ||
      !CONTRACT_TYPES.has(input.contractType) ||
      typeof input.disclaimerVersion !== 'string' ||
      !input.disclaimerVersion.trim()
    ) {
      throw new BadRequestException({
        error: { code: 'CONTRACT_REVIEW_CREATE_INVALID', message: '合同审查请求无效' },
      })
    }
  }

  private memberIdOf(
    requester: ContractReviewRequester,
    sourceFileId: string
  ): string | null {
    const memberId =
      typeof requester.endUserId === 'string' && requester.endUserId.trim()
        ? requester.endUserId.trim()
        : null
    if (memberId) {
      if (requester.accessToken !== null || requester.sourceFileProof != null) {
        throw this.invalidRequester()
      }
      return memberId
    }
    if (requester.endUserId !== null) throw this.invalidRequester()
    if (
      requester.accessToken !== null ||
      typeof requester.sourceFileProof !== 'string' ||
      !requester.sourceFileProof
    ) {
      throw this.sourceNotFound()
    }
    let proof: { fileId: string } | null = null
    try {
      proof = parseAndVerifySignedContentUrl(requester.sourceFileProof)
    } catch {
      proof = null
    }
    if (proof?.fileId !== sourceFileId) throw this.sourceNotFound()
    return null
  }

  private invalidRequester(): BadRequestException {
    return new BadRequestException({
      error: { code: 'CONTRACT_REVIEW_REQUESTER_INVALID', message: '请求身份无效' },
    })
  }

  private invalidConsentSnapshot(): BadRequestException {
    return new BadRequestException({
      error: {
        code: 'CONTRACT_REVIEW_CONSENT_SNAPSHOT_INVALID',
        message: '请重新确认合同审查授权与免责声明',
      },
    })
  }

  private consentRequired(): ForbiddenException {
    return new ForbiddenException({
      error: {
        code: 'USER_AI_CONSENT_REQUIRED',
        message: '请重新确认合同审查 AI 授权',
      },
    })
  }

  private sourceNotFound(): NotFoundException {
    return new NotFoundException({
      error: {
        code: 'CONTRACT_REVIEW_SOURCE_NOT_FOUND',
        message: '合同文件不存在或已过期，请重新上传',
      },
    })
  }
}
