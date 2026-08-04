import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
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
import {
  createContractReviewConsentScopeSnapshot,
  loadActiveContractReviewDisclaimer,
  type ContractReviewConsentScopeSnapshot,
  type ContractReviewDisclaimerDocument,
} from './contract-review-consent.service'
import { CONTRACT_RULE_PACK_VERSION } from './contract-review.rules'
import { assertOwnerShape } from './contract-review-state'
import type {
  ContractReviewCreateInput,
  ContractReviewClock,
  ContractReviewCreatedTask,
  ContractReviewRequester,
  ContractReviewSourceFile,
  ContractType,
} from './contract-review.types'
import { CONTRACT_REVIEW_CLOCK } from './contract-review.types'

const CONTRACT_TYPES: ReadonlySet<string> = new Set<ContractType>([
  'labor_contract',
  'internship_agreement',
  'non_compete',
  'offer',
])

export {
  CONTRACT_RULE_PACK_VERSION,
  CONTRACT_RULE_PACK_VERSION as CONTRACT_REVIEW_RULE_PACK_VERSION,
} from './contract-review.rules'
export const CONTRACT_REVIEW_SCHEMA_VERSION = 'contract-review-result-v1'
const ANONYMOUS_CONSENT_MAX_AGE_MS = 15 * 60 * 1000
const ANONYMOUS_CONSENT_FUTURE_SKEW_MS = 60 * 1000

export {
  CONTRACT_REVIEW_CONSENT_DISCLOSURES,
  createContractReviewConsentScopeSnapshot,
} from './contract-review-consent.service'
export { CONTRACT_REVIEW_CLOCK } from './contract-review.types'
export type { ContractReviewClock } from './contract-review.types'

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
    private readonly memberPrivacy: MemberPrivacyService,
    @Optional()
    @Inject(CONTRACT_REVIEW_CLOCK)
    private readonly clock?: ContractReviewClock
  ) {}

  async create(
    input: ContractReviewCreateInput,
    requester: ContractReviewRequester
  ): Promise<ContractReviewCreatedTask> {
    this.assertCreateInput(input)
    const memberId = this.memberIdOf(requester, input.sourceFileId)
    const issuedToken = memberId ? null : issueAnonymousAccessToken()

    try {
      const nowMs = this.clock?.now() ?? Date.now()
      if (!Number.isFinite(nowMs)) throw new TypeError('Invalid contract review clock')
      const task = await runSerializableTransaction(this.prisma, async (tx) => {
        const sourceFile = await this.loadSourceFile(tx, input.sourceFileId)
        this.assertUsableSourceFile(sourceFile, requester, nowMs)
        const disclaimer = await loadActiveContractReviewDisclaimer(tx, nowMs)
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
          consent: this.requireAnonymousConsentSnapshot(
            input,
            disclaimer,
            scopeSnapshot,
            nowMs
          ),
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

  private assertUsableSourceFile(
    sourceFile: ContractReviewSourceFile | null,
    requester: ContractReviewRequester,
    nowMs: number
  ): asserts sourceFile is ContractReviewSourceFile & { expiresAt: Date } {
    const expiresAt = sourceFile?.expiresAt
    const isAlive =
      expiresAt instanceof Date &&
      Number.isFinite(expiresAt.getTime()) &&
      expiresAt.getTime() > nowMs
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
        rulePackVersion: CONTRACT_RULE_PACK_VERSION,
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
    scopeSnapshot: ContractReviewConsentScopeSnapshot,
    nowMs: number
  ): ConsentSnapshot {
    const consentedAt = new Date(input.consentedAt)
    if (
      input.consentVersion !== CONSENT_VERSION_BY_SCOPE.contract_review ||
      typeof input.consentedAt !== 'string' ||
      !input.consentedAt ||
      !Number.isFinite(consentedAt.getTime()) ||
      consentedAt.getTime() > nowMs + ANONYMOUS_CONSENT_FUTURE_SKEW_MS ||
      consentedAt.getTime() < nowMs - ANONYMOUS_CONSENT_MAX_AGE_MS ||
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
