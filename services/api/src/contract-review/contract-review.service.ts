import { createHash } from 'node:crypto'
import {
  BadRequestException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
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

interface ConsentSnapshot {
  consentVersion: string
  consentedAt: Date
  consentScopeHash: string
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
    const memberId = this.memberIdOf(requester)
    const issuedToken = memberId ? null : issueAnonymousAccessToken()
    const anonymousSnapshot = memberId ? null : this.requireAnonymousConsentSnapshot(input)

    try {
      const task = memberId
        ? await runSerializableTransaction(this.prisma, async (tx) => {
            const sourceFile = await this.loadSourceFile(tx, input.sourceFileId)
            this.assertUsableSourceFile(sourceFile, requester)
            const consent = await this.memberPrivacy.requireActiveConsentInTransaction(
              tx,
              memberId,
              'contract_review'
            )
            return this.createTask(tx, input, sourceFile, {
              endUserId: memberId,
              accessTokenHash: null,
              consent: this.memberConsentSnapshot(consent),
            })
          })
        : await this.prisma.$transaction(async (tx) => {
            const sourceFile = await this.loadSourceFile(tx, input.sourceFileId)
            this.assertUsableSourceFile(sourceFile, requester)
            return this.createTask(tx, input, sourceFile, {
              endUserId: null,
              accessTokenHash: issuedToken!.accessTokenHash,
              consent: anonymousSnapshot!,
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
        disclaimerVersion: input.disclaimerVersion.trim(),
        rulePackVersion: CONTRACT_REVIEW_RULE_PACK_VERSION,
        schemaVersion: CONTRACT_REVIEW_SCHEMA_VERSION,
        expiresAt: sourceFile.expiresAt,
      },
      select: { id: true, expiresAt: true },
    })
  }

  private memberConsentSnapshot(consent: ConsentTruthEvent): ConsentSnapshot {
    const consentScopeHash = createHash('sha256')
      .update(
        JSON.stringify({
          scope: 'contract_review',
          eventId: consent.id,
          consentVersion: consent.consentVersion,
          consentedAt: consent.grantedAt.toISOString(),
        })
      )
      .digest('hex')
    return {
      consentVersion: consent.consentVersion,
      consentedAt: consent.grantedAt,
      consentScopeHash,
    }
  }

  private requireAnonymousConsentSnapshot(input: ContractReviewCreateInput): ConsentSnapshot {
    const consentedAt = new Date(input.consentedAt)
    if (
      input.consentVersion !== CONSENT_VERSION_BY_SCOPE.contract_review ||
      !input.consentedAt ||
      !Number.isFinite(consentedAt.getTime()) ||
      !/^[a-f0-9]{64}$/.test(input.consentScopeHash) ||
      !input.disclaimerVersion.trim()
    ) {
      throw new BadRequestException({
        error: {
          code: 'CONTRACT_REVIEW_CONSENT_SNAPSHOT_INVALID',
          message: '请重新确认合同审查授权与免责声明',
        },
      })
    }
    return {
      consentVersion: input.consentVersion,
      consentedAt,
      consentScopeHash: input.consentScopeHash,
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

  private memberIdOf(requester: ContractReviewRequester): string | null {
    if (requester.endUserId && requester.accessToken) {
      throw new BadRequestException({
        error: { code: 'CONTRACT_REVIEW_REQUESTER_INVALID', message: '请求身份无效' },
      })
    }
    return requester.endUserId?.trim() || null
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
