import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ContractReviewOrchestratorService,
  createContractReviewExtractionFingerprint,
} from '../contract-review-orchestrator.service'
import type { ContractReviewExtractionResult } from '../contract-review-extraction.service'
import type { ContractReviewResult } from '../contract-review.types'

const now = new Date('2026-08-01T10:00:00.000Z')

function extraction(overrides: Partial<ContractReviewExtractionResult> = {}): ContractReviewExtractionResult {
  return {
    sourceSha256: 'a'.repeat(64), sourceSizeBytes: 128, ocrProvider: null,
    mode: 'text_layer', totalPages: 1, analyzedPages: 1, truncated: false,
    ocrConfidence: null,
    pages: [{ pageNumber: 1, text: '姓名：张三。试用期为六个月。', source: 'text_layer', ocrConfidence: null }],
    ...overrides,
  }
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1', sourceFileId: 'file-1', endUserId: 'member-1', status: 'uploaded',
    contractType: 'labor_contract', disclaimerVersion: 'disclaimer-v1', schemaVersion: 'contract-review-v1',
    rulePackVersion: 'labor-contract-cn-p0-v1', extractionFingerprint: null, confirmedAt: null,
    expiresAt: new Date('2026-08-01T12:00:00.000Z'), resultJson: null,
    ocrConfidence: null, analyzedPages: 0, errorCode: null,
    ...overrides,
  }
}

class FakePrisma {
  readonly writes: Array<{ inTransaction: boolean; where: Record<string, unknown>; data: Record<string, unknown> }> = []
  transactionCalls = 0
  inTransaction = false
  current: ReturnType<typeof task>

  constructor(initial: ReturnType<typeof task>) { this.current = structuredClone(initial) }

  contractReviewTask!: {
    findUnique(args: { where: { id: string } }): Promise<ReturnType<typeof task> | null>
    updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>
  }

  init(): this {
    const delegate = {
      findUnique: async ({ where }: { where: { id: string } }) => where.id === this.current.id ? structuredClone(this.current) : null,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (!this.matches(where)) return { count: 0 }
        this.writes.push({ inTransaction: this.inTransaction, where: structuredClone(where), data: structuredClone(data) })
        this.current = { ...this.current, ...structuredClone(data) }
        return { count: 1 }
      },
    }
    this.contractReviewTask = delegate
    return this
  }

  async $transaction<T>(work: (tx: { contractReviewTask: FakePrisma['contractReviewTask'] }) => Promise<T>): Promise<T> {
    this.transactionCalls += 1
    this.inTransaction = true
    try { return await work({ contractReviewTask: this.contractReviewTask }) }
    finally { this.inTransaction = false }
  }

  private matches(where: Record<string, unknown>): boolean {
    if (where.id !== undefined && where.id !== this.current.id) return false
    if (typeof where.status === 'string' && where.status !== this.current.status) return false
    if (where.status && typeof where.status === 'object') {
      const values = (where.status as { in?: unknown }).in
      if (Array.isArray(values) && !values.includes(this.current.status)) return false
    }
    if (where.expiresAt && typeof where.expiresAt === 'object') {
      const gt = (where.expiresAt as { gt?: unknown }).gt
      if (gt instanceof Date && !(this.current.expiresAt > gt)) return false
    }
    return true
  }
}

function harness(initial: ReturnType<typeof task>, extracted = extraction()) {
  const prisma = new FakePrisma(initial).init()
  const calls = { provider: 0, extraction: 0, rules: [] as unknown[], gate: [] as unknown[][] }
  const candidate: ContractReviewResult = {
    priorityCheckCount: 0, attentionCount: 0, insufficientInfoCount: 0,
    coverage: 'complete', ocrConfidence: 'high', disclaimerVersion: 'disclaimer-v1',
    rulePackVersion: 'labor-contract-cn-p0-v1', generatedByAi: true, findings: [],
  }
  const service = new ContractReviewOrchestratorService(
    prisma as never,
    { async extract(input: { onPageComplete?: (done: number, total: number) => Promise<void> }) {
      calls.extraction += 1
      await input.onPageComplete?.(1, extracted.totalPages)
      return extracted
    } } as never,
    { merge: () => ({ facts: {}, hasFieldConflict: false }) } as never,
    { evaluate: (input: unknown) => { calls.rules.push(input); return [] } } as never,
    {
      mapRules: () => [], mapAi: () => [],
      composeResult: () => candidate,
    } as never,
    { validate: (...args: unknown[]) => { calls.gate.push(args); return candidate } } as never,
    { async reviewWithIdentity() {
      calls.provider += 1
      return {
        identity: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com/', model: 'deepseek-v4-pro' },
        draft: { findings: [] },
      }
    } } as never,
    { now: () => new Date(now) },
  )
  return { service, prisma, calls, candidate }
}

test('extract stops at awaiting_confirmation and persists only a source fingerprint', async () => {
  const { service, prisma, calls } = harness(task())
  await service.extract('task-1')

  assert.equal(prisma.current.status, 'awaiting_confirmation')
  assert.match(String(prisma.current.extractionFingerprint), /^[a-f0-9]{64}$/u)
  assert.equal(prisma.current.ocrConfidence, 'high')
  assert.equal(prisma.current.analyzedPages, 1)
  assert.equal(calls.provider, 0)
  assert.equal(prisma.writes.some((write) => 'resultJson' in write.data), false)
})

test('analyze cannot bypass the persisted confirmation checkpoint', async () => {
  const { service, calls } = harness(task({
    status: 'awaiting_confirmation',
    extractionFingerprint: createContractReviewExtractionFingerprint('file-1', extraction(), 'contract-review-v1'),
  }))
  await assert.rejects(() => service.analyze('task-1'), /CONTRACT_REVIEW_CONFIRMATION_REQUIRED/)
  assert.equal(calls.extraction, 0)
  assert.equal(calls.provider, 0)
})

test('analyze rejects source drift before rules or provider', async () => {
  const first = extraction()
  const changed = extraction({ sourceSha256: 'b'.repeat(64) })
  const { service, calls } = harness(task({
    status: 'rule_checking', confirmedAt: now,
    extractionFingerprint: createContractReviewExtractionFingerprint('file-1', first, 'contract-review-v1'),
  }), changed)

  await assert.rejects(() => service.analyze('task-1'), /CONTRACT_REVIEW_SOURCE_CHANGED/)
  assert.equal(calls.rules.length, 0)
  assert.equal(calls.provider, 0)
})

test('analyze uses masked canonical pages and commits validated result in one final CAS transaction', async () => {
  const extracted = extraction()
  const { service, prisma, calls, candidate } = harness(task({
    status: 'rule_checking', confirmedAt: now,
    extractionFingerprint: createContractReviewExtractionFingerprint('file-1', extracted, 'contract-review-v1'),
  }), extracted)

  await service.analyze('task-1')

  const ruleInput = calls.rules[0] as { canonicalPages: Array<{ text: string }> }
  assert.doesNotMatch(ruleInput.canonicalPages[0]!.text, /张三/u)
  assert.deepEqual(calls.gate[0]?.[1], ruleInput.canonicalPages)
  assert.deepEqual(calls.gate[0]?.[2], {
    expectedDisclaimerVersion: 'disclaimer-v1', expectedOcrConfidence: 'high',
    expectedCoverage: 'complete', hasFieldConflict: false, authoritativeRuleFindings: [],
  })
  assert.equal(calls.provider, 1)
  assert.equal(prisma.transactionCalls, 1)
  const finalWrite = prisma.writes.find((write) => 'resultJson' in write.data)
  assert.equal(finalWrite?.inTransaction, true)
  assert.equal(finalWrite?.where.status, 'safety_reviewing')
  assert.equal(finalWrite?.data.status, 'completed')
  assert.deepEqual(JSON.parse(String(finalWrite?.data.resultJson)), candidate)
  assert.equal(finalWrite?.data.aiProvider, 'deepseek')
  assert.equal(finalWrite?.data.aiModel, 'deepseek-v4-pro')
})

test('safety rejection never persists candidate or raw model output and fixes the task as failed', async () => {
  const extracted = extraction()
  const { service, prisma } = harness(task({
    status: 'rule_checking', confirmedAt: now,
    extractionFingerprint: createContractReviewExtractionFingerprint('file-1', extracted, 'contract-review-v1'),
  }), extracted)
  ;(service as unknown as { safetyGate: { validate(): never } }).safetyGate = {
    validate() { throw new Error('raw model secret') },
  }

  await assert.rejects(() => service.analyze('task-1'), /CONTRACT_REVIEW_SAFETY_REJECTED/)
  assert.equal(prisma.current.status, 'failed')
  assert.equal(prisma.current.errorCode, 'CONTRACT_REVIEW_SAFETY_REJECTED')
  assert.equal(prisma.writes.some((write) => 'resultJson' in write.data), false)
  assert.doesNotMatch(JSON.stringify(prisma.writes), /raw model secret/u)
})

test('extract is idempotent at the confirmation checkpoint and can retry only extracting', async () => {
  const waiting = harness(task({ status: 'awaiting_confirmation' }))
  await waiting.service.extract('task-1')
  assert.equal(waiting.calls.extraction, 0)

  const retry = harness(task({ status: 'extracting' }))
  await retry.service.extract('task-1')
  assert.equal(retry.calls.extraction, 1)
  assert.equal(retry.prisma.current.status, 'awaiting_confirmation')

  const wrong = harness(task({ status: 'completed' }))
  await assert.rejects(() => wrong.service.extract('task-1'), /CONTRACT_REVIEW_EXTRACT_STATE_INVALID/)
  assert.equal(wrong.calls.extraction, 0)
})

test('stage failures persist only fixed codes while cancellation remains terminal', async () => {
  const extractionFailure = harness(task())
  ;(extractionFailure.service as unknown as { extraction: { extract(): Promise<never> } }).extraction = {
    async extract() { throw new Error('raw parser path and contract text') },
  }
  await assert.rejects(
    () => extractionFailure.service.extract('task-1'),
    /CONTRACT_REVIEW_EXTRACTION_FAILED/,
  )
  assert.equal(extractionFailure.prisma.current.status, 'failed')
  assert.equal(extractionFailure.prisma.current.errorCode, 'CONTRACT_REVIEW_EXTRACTION_FAILED')
  assert.doesNotMatch(JSON.stringify(extractionFailure.prisma.writes), /raw parser path/u)

  const cancelled = harness(task({ status: 'extracting' }))
  ;(cancelled.service as unknown as { extraction: { extract(): Promise<ContractReviewExtractionResult> } }).extraction = {
    async extract() {
      cancelled.prisma.current.status = 'cancelled'
      return extraction()
    },
  }
  await assert.rejects(() => cancelled.service.extract('task-1'), /CONTRACT_REVIEW_CANCELLED/)
  assert.equal(cancelled.prisma.current.status, 'cancelled')
})

test('provider rejection uses the provider safe code and never retries or persists a result', async () => {
  const extracted = extraction()
  const current = harness(task({
    status: 'rule_checking', confirmedAt: now,
    extractionFingerprint: createContractReviewExtractionFingerprint('file-1', extracted, 'contract-review-v1'),
  }), extracted)
  let providerCalls = 0
  ;(current.service as unknown as { provider: { reviewWithIdentity(): Promise<never> } }).provider = {
    async reviewWithIdentity() {
      providerCalls += 1
      throw new Error('CONTRACT_PROVIDER_NOT_APPROVED')
    },
  }

  await assert.rejects(() => current.service.analyze('task-1'), /CONTRACT_PROVIDER_NOT_APPROVED/)
  assert.equal(providerCalls, 1)
  assert.equal(current.prisma.current.status, 'failed')
  assert.equal(current.prisma.current.errorCode, 'CONTRACT_PROVIDER_NOT_APPROVED')
  assert.equal(current.prisma.writes.some((write) => 'resultJson' in write.data), false)
})

test('expired work fails closed and invalid fingerprint inputs are rejected', async () => {
  const expired = harness(task({ expiresAt: now }))
  await assert.rejects(() => expired.service.extract('task-1'), /CONTRACT_REVIEW_EXPIRED/)
  assert.equal(expired.calls.extraction, 0)

  const base = extraction()
  const invalid: Array<[string, Partial<ContractReviewExtractionResult>, string]> = [
    ['', base, 'v1'],
    ['file-1', { ...base, sourceSha256: 'bad' }, 'v1'],
    ['file-1', { ...base, sourceSizeBytes: 0 }, 'v1'],
    ['file-1', { ...base, sourceSizeBytes: 1.5 }, 'v1'],
    ['file-1', { ...base, mode: 'other' as never }, 'v1'],
    ['file-1', { ...base, totalPages: 0 }, 'v1'],
    ['file-1', { ...base, totalPages: 1.5 }, 'v1'],
    ['file-1', base, ''],
  ]
  for (const [sourceFileId, value, schemaVersion] of invalid) {
    assert.throws(
      () => createContractReviewExtractionFingerprint(
        sourceFileId,
        value as ContractReviewExtractionResult,
        schemaVersion,
      ),
      /CONTRACT_REVIEW_EXTRACTION_IDENTITY_INVALID/,
    )
  }
})

test('non-final extract failure remains retryable and the final attempt fixes it as failed', async () => {
  const retryable = harness(task({ status: 'extracting' }))
  ;(retryable.service as unknown as { extraction: { extract(): Promise<never> } }).extraction = {
    async extract() { throw new Error('private parser failure') },
  }
  await assert.rejects(
    () => retryable.service.extract('task-1', { finalAttempt: false }),
    /CONTRACT_REVIEW_EXTRACTION_FAILED/,
  )
  assert.equal(retryable.prisma.current.status, 'extracting')
  assert.equal(retryable.prisma.current.errorCode, null)

  await assert.rejects(
    () => retryable.service.extract('task-1', { finalAttempt: true }),
    /CONTRACT_REVIEW_EXTRACTION_FAILED/,
  )
  assert.equal(retryable.prisma.current.status, 'failed')
  assert.equal(retryable.prisma.current.errorCode, 'CONTRACT_REVIEW_EXTRACTION_FAILED')
})

test('analyze never resumes from model or safety stages and settles stale jobs without another model call', async () => {
  for (const status of ['ai_analyzing', 'safety_reviewing'] as const) {
    const current = harness(task({
      status, confirmedAt: now,
      extractionFingerprint: createContractReviewExtractionFingerprint('file-1', extraction(), 'contract-review-v1'),
    }))
    await assert.rejects(() => current.service.analyze('task-1'), /CONTRACT_REVIEW_ANALYZE_NOT_RESUMABLE/)
    assert.equal(current.calls.extraction, 0)
    assert.equal(current.calls.provider, 0)
    assert.equal(current.prisma.current.status, 'failed')
    assert.equal(current.prisma.current.errorCode, 'CONTRACT_REVIEW_ANALYZE_ATTEMPT_FAILED')
  }
})

test('five-minute budget writes only timeout and a failure-write exception cannot escape', async () => {
  const current = harness(task({ status: 'extracting' }))
  let clockMs = now.getTime()
  ;(current.service as unknown as { clock: { now(): Date } }).clock = { now: () => new Date(clockMs) }
  ;(current.service as unknown as { extraction: { extract(): Promise<ContractReviewExtractionResult> } }).extraction = {
    async extract() {
      clockMs += 5 * 60 * 1_000
      return extraction()
    },
  }
  await assert.rejects(() => current.service.extract('task-1'), /CONTRACT_REVIEW_TIMEOUT/)
  assert.equal(current.prisma.current.status, 'failed')
  assert.equal(current.prisma.current.errorCode, 'CONTRACT_REVIEW_TIMEOUT')

  const writeFailure = harness(task({ status: 'extracting' }))
  ;(writeFailure.service as unknown as { extraction: { extract(): Promise<never> } }).extraction = {
    async extract() { throw new Error('raw parser secret') },
  }
  const findTask = writeFailure.prisma.contractReviewTask.findUnique
  let reads = 0
  writeFailure.prisma.contractReviewTask.findUnique = async (args) => {
    reads += 1
    if (reads > 1) throw new Error('postgres://user:secret@host')
    return findTask(args)
  }
  await assert.rejects(
    () => writeFailure.service.extract('task-1'),
    (error) => error instanceof Error && error.message === 'CONTRACT_REVIEW_EXTRACTION_FAILED',
  )
})

test('final CAS competition rejects the late result and persists no candidate', async () => {
  const extracted = extraction()
  const current = harness(task({
    status: 'rule_checking', confirmedAt: now,
    extractionFingerprint: createContractReviewExtractionFingerprint('file-1', extracted, 'contract-review-v1'),
  }), extracted)
  current.prisma.$transaction = async (work) => {
    current.prisma.transactionCalls += 1
    return work({
      contractReviewTask: {
        findUnique: current.prisma.contractReviewTask.findUnique,
        updateMany: async () => ({ count: 0 }),
      },
    })
  }

  await assert.rejects(() => current.service.analyze('task-1'), /CONTRACT_REVIEW_FINAL_CAS_FAILED/)
  assert.equal(current.prisma.writes.some((write) => 'resultJson' in write.data), false)
  assert.equal(current.prisma.current.status, 'failed')
  assert.equal(current.prisma.current.errorCode, 'CONTRACT_REVIEW_FINAL_CAS_FAILED')
})

test('stage-two fingerprint rejects mode and page-count drift even when bytes match', async () => {
  const first = extraction()
  for (const changed of [
    extraction({ mode: 'mixed', ocrProvider: 'baidu', ocrConfidence: 'high' }),
    extraction({ totalPages: 2, analyzedPages: 2, pages: [
      ...first.pages,
      { pageNumber: 2, text: '第二页', source: 'text_layer', ocrConfidence: null },
    ] }),
  ]) {
    const current = harness(task({
      status: 'rule_checking', confirmedAt: now,
      extractionFingerprint: createContractReviewExtractionFingerprint('file-1', first, 'contract-review-v1'),
    }), changed)
    await assert.rejects(() => current.service.analyze('task-1'), /CONTRACT_REVIEW_SOURCE_CHANGED/)
    assert.equal(current.calls.provider, 0)
  }
})
