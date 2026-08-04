import { createHash } from 'node:crypto'
import { Inject, Injectable, Optional } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import {
  ContractReviewExtractionService,
  type ContractReviewExtractionResult,
  type ContractReviewOcrConfidence,
} from './contract-review-extraction.service'
import { ContractReviewFactMerger } from './contract-review-fact-merger'
import { ContractReviewFindingMapper } from './contract-review-finding-mapper'
import { maskContractPages } from './contract-review-pii-masker'
import {
  type ContractProviderIdentity,
  type ContractProviderReviewInput,
  type ContractProviderReviewOutput,
} from './contract-review-provider.service'
import { ContractReviewRuleEngine } from './contract-review-rule-engine'
import { ContractReviewSafetyGate } from './contract-review-safety-gate.service'
import type { ContractReviewStatus } from './contract-review.types'
import { assertContractReviewTaskId } from './contract-review.queue'

export const CONTRACT_REVIEW_PROVIDER_RUNTIME = Symbol('CONTRACT_REVIEW_PROVIDER_RUNTIME')
export const CONTRACT_REVIEW_ORCHESTRATOR_CLOCK = Symbol('CONTRACT_REVIEW_ORCHESTRATOR_CLOCK')

const EXECUTION_BUDGET_MS = 5 * 60 * 1_000
const FINGERPRINT_VERSION = 'contract-review-extraction-fingerprint-v1'
const PROCESSING_STATUSES = Object.freeze([
  'queued', 'extracting', 'rule_checking', 'ai_analyzing', 'safety_reviewing',
] satisfies ContractReviewStatus[])

export interface ContractReviewProviderRuntime {
  reviewWithIdentity(input: ContractProviderReviewInput): Promise<ContractProviderReviewOutput>
}

export interface ContractReviewOrchestratorClock {
  now(): Date
}

interface ContractReviewTaskSnapshot {
  readonly id: string
  readonly sourceFileId: string
  readonly endUserId: string | null
  readonly status: string
  readonly contractType: string
  readonly disclaimerVersion: string
  readonly schemaVersion: string
  readonly extractionFingerprint: string | null
  readonly confirmedAt: Date | null
  readonly expiresAt: Date
}

const SYSTEM_CLOCK: ContractReviewOrchestratorClock = Object.freeze({ now: () => new Date() })

@Injectable()
export class ContractReviewOrchestratorService {
  private readonly clock: ContractReviewOrchestratorClock

  constructor(
    private readonly prisma: PrismaService,
    private readonly extraction: ContractReviewExtractionService,
    private readonly factMerger: ContractReviewFactMerger,
    private readonly ruleEngine: ContractReviewRuleEngine,
    private readonly findingMapper: ContractReviewFindingMapper,
    private readonly safetyGate: ContractReviewSafetyGate,
    @Inject(CONTRACT_REVIEW_PROVIDER_RUNTIME)
    private readonly provider: ContractReviewProviderRuntime,
    @Optional() @Inject(CONTRACT_REVIEW_ORCHESTRATOR_CLOCK)
    clock?: ContractReviewOrchestratorClock,
  ) {
    this.clock = clock ?? SYSTEM_CLOCK
  }

  async extract(
    taskId: string,
    execution: { readonly finalAttempt: boolean } = Object.freeze({ finalAttempt: true }),
  ): Promise<void> {
    assertContractReviewTaskId(taskId)
    if (!execution || typeof execution.finalAttempt !== 'boolean') {
      throw safeError('CONTRACT_REVIEW_JOB_INVALID')
    }
    const deadline = this.deadline()
    let processingStarted = false
    try {
      let task = await this.requireTask(taskId)
      this.assertWithinTaskLifetime(task, deadline)
      if (task.status === 'awaiting_confirmation') return
      if (task.status === 'uploaded') {
        await this.cas(taskId, 'uploaded', { status: 'queued', errorCode: null, errorMessage: null })
        task = await this.requireTask(taskId)
      }
      if (task.status === 'queued') {
        await this.cas(taskId, 'queued', { status: 'extracting', analyzedPages: 0 })
        task = await this.requireTask(taskId)
      }
      if (task.status !== 'extracting') throw safeError('CONTRACT_REVIEW_EXTRACT_STATE_INVALID')
      processingStarted = true

      const extracted = await this.extraction.extract({
        fileId: task.sourceFileId,
        endUserId: task.endUserId,
        onPageComplete: async (completedPages, totalPages) => {
          await this.assertActive(taskId, 'extracting', deadline)
          await this.cas(taskId, 'extracting', {
            analyzedPages: completedPages,
            totalPages,
          })
        },
      })
      await this.assertActive(taskId, 'extracting', deadline)
      const fingerprint = createContractReviewExtractionFingerprint(
        task.sourceFileId,
        extracted,
        task.schemaVersion,
      )
      await this.cas(taskId, 'extracting', {
        status: 'awaiting_confirmation',
        extractionFingerprint: fingerprint,
        confirmedAt: null,
        ocrProvider: extracted.ocrProvider,
        ocrConfidence: normalizedOcrConfidence(extracted.ocrConfidence),
        analyzedPages: extracted.analyzedPages,
        totalPages: extracted.totalPages,
        truncated: extracted.truncated,
        errorCode: null,
        errorMessage: null,
      })
    } catch (error) {
      const safe = this.safeStageError(error, deadline, 'CONTRACT_REVIEW_EXTRACTION_FAILED')
      if (processingStarted && execution.finalAttempt) await this.bestEffortFail(taskId, safe.code)
      throw safe
    }
  }

  async analyze(taskId: string): Promise<void> {
    assertContractReviewTaskId(taskId)
    const deadline = this.deadline()
    let processingStarted = false
    try {
      const task = await this.requireTask(taskId)
      this.assertWithinTaskLifetime(task, deadline)
      if (task.status === 'ai_analyzing' || task.status === 'safety_reviewing') {
        await this.bestEffortSettleFailedJob(taskId, 'analyze')
        throw safeError('CONTRACT_REVIEW_ANALYZE_NOT_RESUMABLE')
      }
      if (
        task.status !== 'rule_checking' ||
        !(task.confirmedAt instanceof Date) ||
        Number.isNaN(task.confirmedAt.getTime()) ||
        !isSha256(task.extractionFingerprint)
      ) {
        throw safeError('CONTRACT_REVIEW_CONFIRMATION_REQUIRED')
      }
      processingStarted = true

      const extracted = await this.extraction.extract({
        fileId: task.sourceFileId,
        endUserId: task.endUserId,
        onPageComplete: async () => this.assertActive(taskId, 'rule_checking', deadline),
      })
      await this.assertActive(taskId, 'rule_checking', deadline)
      const currentFingerprint = createContractReviewExtractionFingerprint(
        task.sourceFileId,
        extracted,
        task.schemaVersion,
      )
      if (currentFingerprint !== task.extractionFingerprint) {
        throw safeError('CONTRACT_REVIEW_SOURCE_CHANGED')
      }

      const masked = maskContractPages(extracted.pages.map((page) => ({
        pageNumber: page.pageNumber,
        text: page.text,
      })))
      const merged = this.factMerger.merge(masked.pages)
      const ruleDrafts = this.ruleEngine.evaluate({
        contractType: task.contractType as 'labor_contract' | 'internship_agreement' | 'non_compete' | 'offer',
        ...merged.facts,
        canonicalPages: masked.pages,
      })
      const authoritativeRuleFindings = this.findingMapper.mapRules(ruleDrafts)

      await this.assertActive(taskId, 'rule_checking', deadline)
      await this.cas(taskId, 'rule_checking', { status: 'ai_analyzing' })
      const reviewed = await this.provider.reviewWithIdentity({
        pages: masked.pages,
        partyFacts: masked.partyFacts,
      })
      await this.assertActive(taskId, 'ai_analyzing', deadline)
      const aiFindings = this.findingMapper.mapAi(
        reviewed.draft,
        masked.pages,
        authoritativeRuleFindings.map((finding) => finding.id),
      )
      const ocrConfidence = normalizedOcrConfidence(extracted.ocrConfidence)
      const coverage = extracted.truncated ? 'truncated' : 'complete'
      const candidate = this.findingMapper.composeResult({
        ruleFindings: authoritativeRuleFindings,
        aiFindings,
        coverage,
        ocrConfidence,
        disclaimerVersion: task.disclaimerVersion,
      })

      await this.cas(taskId, 'ai_analyzing', { status: 'safety_reviewing' })
      const validated = this.validateSafety(candidate, masked.pages, {
        task,
        extracted,
        merged,
        authoritativeRuleFindings,
      })
      await this.assertActive(taskId, 'safety_reviewing', deadline)
      await this.commitResult(taskId, validated, reviewed.identity, extracted)
    } catch (error) {
      const safe = this.safeStageError(error, deadline, 'CONTRACT_REVIEW_ANALYSIS_FAILED')
      if (processingStarted) await this.bestEffortFail(taskId, safe.code)
      throw safe
    }
  }

  async settleFailedJob(taskId: string, stage: 'extract' | 'analyze'): Promise<void> {
    assertContractReviewTaskId(taskId)
    if (stage !== 'extract' && stage !== 'analyze') throw safeError('CONTRACT_REVIEW_JOB_INVALID')
    const statuses: readonly ContractReviewStatus[] = stage === 'extract'
      ? Object.freeze(['queued', 'extracting'] as ContractReviewStatus[])
      : Object.freeze(['rule_checking', 'ai_analyzing', 'safety_reviewing'] as ContractReviewStatus[])
    const code = stage === 'extract'
      ? 'CONTRACT_REVIEW_EXTRACT_ATTEMPTS_EXHAUSTED'
      : 'CONTRACT_REVIEW_ANALYZE_ATTEMPT_FAILED'
    await this.failStatuses(taskId, statuses, code)
  }

  private validateSafety(
    candidate: unknown,
    pages: readonly { readonly pageNumber: number; readonly text: string }[],
    context: {
      task: ContractReviewTaskSnapshot
      extracted: ContractReviewExtractionResult
      merged: ReturnType<ContractReviewFactMerger['merge']>
      authoritativeRuleFindings: ReturnType<ContractReviewFindingMapper['mapRules']>
    },
  ) {
    try {
      return this.safetyGate.validate(candidate, pages, {
        expectedDisclaimerVersion: context.task.disclaimerVersion,
        expectedOcrConfidence: normalizedOcrConfidence(context.extracted.ocrConfidence),
        expectedCoverage: context.extracted.truncated ? 'truncated' : 'complete',
        hasFieldConflict: context.merged.hasFieldConflict,
        authoritativeRuleFindings: context.authoritativeRuleFindings,
      })
    } catch {
      throw safeError('CONTRACT_REVIEW_SAFETY_REJECTED')
    }
  }

  private async commitResult(
    taskId: string,
    result: ReturnType<ContractReviewSafetyGate['validate']>,
    identity: ContractProviderIdentity,
    extracted: ContractReviewExtractionResult,
  ): Promise<void> {
    const now = this.now()
    await this.prisma.$transaction(async (transaction) => {
      const write = await transaction.contractReviewTask.updateMany({
        where: { id: taskId, status: 'safety_reviewing', expiresAt: { gt: now } },
        data: {
          status: 'completed',
          resultJson: JSON.stringify(result),
          aiProvider: identity.provider,
          aiModel: identity.model,
          ocrProvider: extracted.ocrProvider,
          ocrConfidence: normalizedOcrConfidence(extracted.ocrConfidence),
          professionalConsultationRecommended: result.priorityCheckCount > 0,
          errorCode: null,
          errorMessage: null,
        },
      })
      if (write.count !== 1) throw safeError('CONTRACT_REVIEW_FINAL_CAS_FAILED')
    })
  }

  private async assertActive(
    taskId: string,
    expectedStatus: ContractReviewStatus,
    deadline: Date,
  ): Promise<void> {
    const task = await this.requireTask(taskId)
    this.assertWithinTaskLifetime(task, deadline)
    if (task.status !== expectedStatus) {
      if (task.status === 'cancelled') throw safeError('CONTRACT_REVIEW_CANCELLED')
      if (task.status === 'expired') throw safeError('CONTRACT_REVIEW_EXPIRED')
      throw safeError('CONTRACT_REVIEW_STAGE_CHANGED')
    }
  }

  private assertWithinTaskLifetime(task: ContractReviewTaskSnapshot, deadline: Date): void {
    const current = this.now()
    if (!(task.expiresAt instanceof Date) || task.expiresAt.getTime() <= current.getTime()) {
      throw safeError('CONTRACT_REVIEW_EXPIRED')
    }
    if (current.getTime() >= deadline.getTime()) throw safeError('CONTRACT_REVIEW_TIMEOUT')
    if (task.status === 'cancelled') throw safeError('CONTRACT_REVIEW_CANCELLED')
    if (task.status === 'expired') throw safeError('CONTRACT_REVIEW_EXPIRED')
  }

  private async requireTask(taskId: string): Promise<ContractReviewTaskSnapshot> {
    const task = await this.prisma.contractReviewTask.findUnique({ where: { id: taskId } })
    if (!task) throw safeError('CONTRACT_REVIEW_TASK_NOT_FOUND')
    return task as ContractReviewTaskSnapshot
  }

  private async cas(
    taskId: string,
    status: ContractReviewStatus,
    data: Record<string, unknown>,
    requireSingle = true,
  ): Promise<void> {
    const write = await this.prisma.contractReviewTask.updateMany({
      where: { id: taskId, status, expiresAt: { gt: this.now() } },
      data,
    })
    if (requireSingle && write.count !== 1) throw safeError('CONTRACT_REVIEW_STAGE_CHANGED')
  }

  private async failActive(taskId: string, code: string): Promise<void> {
    await this.failStatuses(taskId, PROCESSING_STATUSES, code)
  }

  private async failStatuses(
    taskId: string,
    statuses: readonly ContractReviewStatus[],
    code: string,
  ): Promise<void> {
    const task = await this.prisma.contractReviewTask.findUnique({ where: { id: taskId } })
    if (!task || task.status === 'cancelled' || task.status === 'expired') return
    if (task.expiresAt.getTime() <= this.now().getTime()) {
      await this.prisma.contractReviewTask.updateMany({
        where: { id: taskId, status: { in: [...statuses] } },
        data: { status: 'expired', errorCode: null, errorMessage: null },
      })
      return
    }
    await this.prisma.contractReviewTask.updateMany({
      where: { id: taskId, status: { in: [...statuses] }, expiresAt: { gt: this.now() } },
      data: { status: 'failed', errorCode: code, errorMessage: null },
    })
  }

  private async bestEffortFail(taskId: string, code: string): Promise<void> {
    try { await this.failActive(taskId, code) } catch { /* fixed error below remains authoritative */ }
  }

  private async bestEffortSettleFailedJob(
    taskId: string,
    stage: 'extract' | 'analyze',
  ): Promise<void> {
    try { await this.settleFailedJob(taskId, stage) } catch { /* never expose persistence details */ }
  }

  private safeStageError(error: unknown, deadline: Date, fallback: string): ContractReviewSafeError {
    if (this.now().getTime() >= deadline.getTime()) return safeError('CONTRACT_REVIEW_TIMEOUT')
    if (error instanceof ContractReviewSafeError) return error
    if (error instanceof Error && /^CONTRACT_PROVIDER_(?:NOT_APPROVED|CONFIG_INVALID|API_KEY_INVALID|NOT_ALLOWED|INPUT_INVALID|INPUT_LIMIT|TRANSPORT_FAILED|RESPONSE_INVALID|RESPONSE_TOO_LARGE)$/u.test(error.message)) {
      return safeError(error.message)
    }
    return safeError(fallback)
  }

  private deadline(): Date { return new Date(this.now().getTime() + EXECUTION_BUDGET_MS) }
  private now(): Date {
    const value = this.clock.now()
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw safeError('CONTRACT_REVIEW_CLOCK_INVALID')
    return new Date(value)
  }
}

class ContractReviewSafeError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'ContractReviewSafeError' }
}

function safeError(code: string): ContractReviewSafeError { return new ContractReviewSafeError(code) }

function normalizedOcrConfidence(
  confidence: ContractReviewOcrConfidence | null,
): ContractReviewOcrConfidence {
  return confidence ?? 'high'
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

export function createContractReviewExtractionFingerprint(
  sourceFileId: string,
  extracted: Pick<ContractReviewExtractionResult, 'sourceSha256' | 'sourceSizeBytes' | 'mode' | 'totalPages'>,
  schemaVersion: string,
): string {
  if (
    typeof sourceFileId !== 'string' || !sourceFileId ||
    !isSha256(extracted?.sourceSha256) ||
    !Number.isSafeInteger(extracted?.sourceSizeBytes) || extracted.sourceSizeBytes <= 0 ||
    !['text_layer', 'ocr', 'mixed'].includes(extracted?.mode) ||
    !Number.isSafeInteger(extracted?.totalPages) || extracted.totalPages <= 0 ||
    typeof schemaVersion !== 'string' || !schemaVersion
  ) {
    throw safeError('CONTRACT_REVIEW_EXTRACTION_IDENTITY_INVALID')
  }
  return createHash('sha256').update(JSON.stringify([
    FINGERPRINT_VERSION,
    sourceFileId,
    extracted.sourceSha256,
    extracted.sourceSizeBytes,
    extracted.mode,
    extracted.totalPages,
    schemaVersion,
  ])).digest('hex')
}
