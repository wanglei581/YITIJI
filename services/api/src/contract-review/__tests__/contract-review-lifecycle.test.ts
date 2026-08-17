import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HttpException } from '@nestjs/common'
import { issueAnonymousAccessToken } from '../contract-review-access'
import { ContractReviewConsentService } from '../contract-review-consent.service'
import { ContractReviewLifecycleService } from '../contract-review-lifecycle.service'
import { ContractReviewQueueService, type ContractReviewQueueAdapter } from '../contract-review.queue'
import { ContractReviewTaskAccess } from '../contract-review-task-access'
import { mapContractReviewTaskView } from '../contract-review-task-view.mapper'
import type {
  ContractReviewConfirmInput,
  ContractReviewCreatedTask,
  ContractReviewTaskRow,
} from '../contract-review.types'

const NOW = new Date('2026-08-01T12:00:00.000Z')
const RESULT = {
  priorityCheckCount: 0,
  attentionCount: 0,
  insufficientInfoCount: 0,
  coverage: 'complete',
  ocrConfidence: 'high',
  disclaimerVersion: 'disclaimer-v1',
  rulePackVersion: 'cn-labor-p0-v1',
  generatedByAi: true,
  findings: [],
} as const

test('anonymous create exposes its token only after extract enqueue succeeds', async () => {
  const created = anonymousCreated()
  let release!: () => void
  const queueReady = new Promise<void>((resolve) => { release = resolve })
  const harness = lifecycleHarness({
    created,
    queueAdapter: {
      async add() {
        await queueReady
        return {}
      },
    },
  })
  let settled = false
  const pending = harness.lifecycle.createAndEnqueue(createInput(), anonymousRequester())
    .finally(() => { settled = true })

  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(settled, false)
  release()
  assert.deepEqual(await pending, created)
})

test('member create never exposes a token even if the persistence primitive returns one', async () => {
  const harness = lifecycleHarness({ created: anonymousCreated() })
  const created = await harness.lifecycle.createAndEnqueue(createInput(), memberRequester())
  assert.deepEqual(created, {
    id: 'created-task', status: 'uploaded', expiresAt: '2026-08-01T14:00:00.000Z',
  })
})

test('create enqueue failure performs one multi-state expiry CAS and never exposes token', async () => {
  const created = anonymousCreated()
  const harness = lifecycleHarness({
    created,
    queueAdapter: { async add() { throw new Error(`accepted then disconnected ${created.accessToken}`) } },
  })

  await assert.rejects(
    harness.lifecycle.createAndEnqueue(createInput(), anonymousRequester()),
    fixedHttpError(503, 'CONTRACT_REVIEW_QUEUE_UNAVAILABLE'),
  )
  assert.equal(harness.updateCalls.length, 1)
  assert.deepEqual(harness.updateCalls[0]?.where.status, {
    in: ['uploaded', 'queued', 'extracting', 'awaiting_confirmation'],
  })
  assert.equal(harness.rows.get(created.id)?.status, 'expired')
  assert.equal(harness.rows.get(created.id)?.expiresAt.toISOString(), NOW.toISOString())
})

test('ambiguous create enqueue failure does not overwrite a worker terminal state after CAS zero', async () => {
  const created = anonymousCreated()
  const harness = lifecycleHarness({
    created,
    queueAdapter: {
      async add() {
        harness.rows.get(created.id)!.status = 'completed'
        throw new Error('accepted then disconnected')
      },
    },
  })

  await assert.rejects(
    harness.lifecycle.createAndEnqueue(createInput(), anonymousRequester()),
    fixedHttpError(503, 'CONTRACT_REVIEW_QUEUE_UNAVAILABLE'),
  )
  assert.equal(harness.updateCalls.length, 1)
  assert.equal(harness.rows.get(created.id)?.status, 'completed')
  assert.equal(harness.rows.get(created.id)?.expiresAt.toISOString(), created.expiresAt)
})

test('create returns the same fixed 503 when its single expiry CAS cannot reach the database', async () => {
  const harness = lifecycleHarness({
    failExpiryWrite: true,
    queueAdapter: { async add() { throw new Error('queue transport details') } },
  })
  await assert.rejects(
    harness.lifecycle.createAndEnqueue(createInput(), anonymousRequester()),
    fixedHttpError(503, 'CONTRACT_REVIEW_QUEUE_UNAVAILABLE'),
  )
  assert.equal(harness.updateCalls.length, 1)
})

test('task access makes missing and every ownership mismatch the same 404', () => {
  const access = new ContractReviewTaskAccess()
  const issued = issueAnonymousAccessToken()
  const anonymous = taskRow({ endUserId: null, accessTokenHash: issued.accessTokenHash })
  const member = taskRow({ id: 'member-task', endUserId: 'member-a', accessTokenHash: null })
  assert.equal(access.requireOwnedTask(anonymous, {
    endUserId: null, accessToken: issued.accessToken, sourceFileProof: null,
  }), anonymous)
  assert.equal(access.requireOwnedTask(member, {
    endUserId: 'member-a', accessToken: null, sourceFileProof: null,
  }), member)

  const failures = [
    () => access.requireOwnedTask(null, { endUserId: 'member-a', accessToken: null, sourceFileProof: null }),
    () => access.requireOwnedTask(member, { endUserId: 'member-b', accessToken: null, sourceFileProof: null }),
    () => access.requireOwnedTask(anonymous, { endUserId: 'member-a', accessToken: null, sourceFileProof: null }),
    () => access.requireOwnedTask(anonymous, { endUserId: null, accessToken: null, sourceFileProof: null }),
    () => access.requireOwnedTask(anonymous, { endUserId: null, accessToken: 'x'.repeat(10_000), sourceFileProof: null }),
    () => access.requireOwnedTask(anonymous, { endUserId: null, accessToken: issued.accessToken, sourceFileProof: '/signed/proof' }),
  ]
  for (const fail of failures) assert.throws(fail, fixedHttpError(404, 'CONTRACT_REVIEW_TASK_NOT_FOUND'))
  assert.throws(
    () => access.requireOwnedTask({ ...anonymous, accessTokenHash: 'z'.repeat(64) }, {
      endUserId: null, accessToken: issued.accessToken, sourceFileProof: null,
    }),
    fixedHttpError(404, 'CONTRACT_REVIEW_TASK_NOT_FOUND'),
  )
})

test('view mapper hides result before completion and strictly parses completed JSON', () => {
  const processing = taskRow({ status: 'ai_analyzing', resultJson: '{"private":"model output"}' })
  assert.equal(mapContractReviewTaskView(processing).result, null)
  assert.equal(mapContractReviewTaskView(taskRow({
    status: 'completed', resultJson: JSON.stringify(RESULT),
  })).result?.generatedByAi, true)
  for (const resultJson of ['not-json:{secret}', JSON.stringify({ ...RESULT, secret: 'raw model output' })]) {
    assert.throws(
      () => mapContractReviewTaskView(taskRow({ status: 'completed', resultJson })),
      /CONTRACT_REVIEW_RESULT_INVALID/u,
    )
  }
  for (const invalid of [
    taskRow({ status: 'unknown' }),
    taskRow({ contractType: 'unknown' }),
    taskRow({ analyzedPages: -1 }),
    taskRow({ analyzedPages: 2, totalPages: 1 }),
    taskRow({ totalPages: 0 }),
    taskRow({ totalPages: 51 }),
    taskRow({ totalPages: -1 }),
    taskRow({ truncated: 'false' as unknown as boolean }),
    taskRow({ ocrConfidence: 'unexpected' }),
    taskRow({ expiresAt: new Date(Number.NaN) }),
  ]) assert.throws(() => mapContractReviewTaskView(invalid), /CONTRACT_REVIEW_RESULT_INVALID/u)
})

test('get returns real progress, hides noncompleted result, and maps invalid persisted result to fixed 500', async () => {
  const harness = lifecycleHarness()
  harness.rows.set('processing', taskRow({
    id: 'processing', status: 'extracting', analyzedPages: 2, totalPages: 5,
    resultJson: '{"secret":"must stay hidden"}',
  }))
  assert.deepEqual((await harness.lifecycle.get('processing', memberRequester())).progress, {
    stage: 'extracting', completedPages: 2, totalPages: 5,
  })
  assert.equal((await harness.lifecycle.get('processing', memberRequester())).result, null)

  harness.rows.set('invalid', taskRow({ id: 'invalid', status: 'completed', resultJson: '{raw-secret' }))
  await assert.rejects(
    harness.lifecycle.get('invalid', memberRequester()),
    fixedHttpError(500, 'CONTRACT_REVIEW_RESULT_INVALID'),
  )
})

test('two concurrent confirms write confirmedAt once and enqueue the same deterministic job id', async () => {
  const harness = lifecycleHarness()
  harness.rows.set('confirm-task', taskRow({
    id: 'confirm-task', status: 'awaiting_confirmation', totalPages: 3, analyzedPages: 3,
    extractionFingerprint: 'a'.repeat(64), confirmedAt: null,
  }))
  const input = confirmInput({ totalPages: 3, analyzedPages: 3 })

  const [left, right] = await Promise.all([
    harness.lifecycle.confirmAndEnqueue('confirm-task', input, memberRequester()),
    harness.lifecycle.confirmAndEnqueue('confirm-task', input, memberRequester()),
  ])

  assert.equal(left.status, 'rule_checking')
  assert.equal(right.status, 'rule_checking')
  assert.equal(harness.confirmWrites, 1)
  assert.equal(harness.rows.get('confirm-task')?.confirmedAt?.toISOString(), NOW.toISOString())
  assert.deepEqual(harness.queueJobIds, [
    'contract-review.analyze.confirm-task',
    'contract-review.analyze.confirm-task',
  ])
})

test('confirm enqueue failure preserves first confirmation and retry only re-enqueues', async () => {
  let fail = true
  const harness = lifecycleHarness({
    queueAdapter: {
      async add(_name, _data, options) {
        harness.queueJobIds.push(options.jobId)
        if (fail) throw new Error('redis unavailable')
        return { id: options.jobId }
      },
    },
  })
  harness.rows.set('confirm-retry', taskRow({
    id: 'confirm-retry', status: 'awaiting_confirmation', extractionFingerprint: 'b'.repeat(64),
  }))
  const input = confirmInput()

  await assert.rejects(
    harness.lifecycle.confirmAndEnqueue('confirm-retry', input, memberRequester()),
    fixedHttpError(503, 'CONTRACT_REVIEW_QUEUE_UNAVAILABLE'),
  )
  const confirmedAt = harness.rows.get('confirm-retry')?.confirmedAt
  assert.equal(harness.rows.get('confirm-retry')?.status, 'rule_checking')
  fail = false
  await harness.lifecycle.confirmAndEnqueue('confirm-retry', input, memberRequester())
  assert.equal(harness.confirmWrites, 1)
  assert.equal(harness.rows.get('confirm-retry')?.confirmedAt, confirmedAt)
  assert.deepEqual(harness.queueJobIds, [
    'contract-review.analyze.confirm-retry',
    'contract-review.analyze.confirm-retry',
  ])
})

test('confirm rejects mismatched persisted coverage without writing confirmation', async () => {
  const harness = lifecycleHarness()
  harness.rows.set('mismatch', taskRow({
    id: 'mismatch', status: 'awaiting_confirmation', totalPages: 3, analyzedPages: 2,
    extractionFingerprint: 'c'.repeat(64),
  }))
  for (const input of [
    confirmInput({ totalPages: 2, analyzedPages: 2 }),
    confirmInput({ totalPages: 3, analyzedPages: 3 }),
    confirmInput({ ocrCoverageConfirmed: false as true }),
    confirmInput({ personalUseConfirmed: false as true }),
  ]) {
    await assert.rejects(
      harness.lifecycle.confirmAndEnqueue('mismatch', input, memberRequester()),
      fixedHttpError(400, 'CONTRACT_REVIEW_CONFIRMATION_INVALID'),
    )
  }
  assert.equal(harness.confirmWrites, 0)
})

test('confirm rejects terminal state and missing extraction fingerprint', async () => {
  const harness = lifecycleHarness()
  for (const row of [
    taskRow({ id: 'terminal', status: 'completed', extractionFingerprint: 'a'.repeat(64) }),
    taskRow({ id: 'no-fingerprint', status: 'awaiting_confirmation' }),
  ]) harness.rows.set(row.id, row)
  await assert.rejects(
    harness.lifecycle.confirmAndEnqueue('terminal', confirmInput(), memberRequester()),
    fixedHttpError(409, 'CONTRACT_REVIEW_CONFIRM_STATE_INVALID'),
  )
  await assert.rejects(
    harness.lifecycle.confirmAndEnqueue('no-fingerprint', confirmInput(), memberRequester()),
    fixedHttpError(400, 'CONTRACT_REVIEW_CONFIRMATION_INVALID'),
  )
})

test('report verifies ownership before its fixed 503 response', async () => {
  const harness = lifecycleHarness()
  harness.rows.set('report-task', taskRow({ id: 'report-task', status: 'completed' }))
  await assert.rejects(
    harness.lifecycle.createReport('report-task', { ...memberRequester(), endUserId: 'member-b' }),
    fixedHttpError(404, 'CONTRACT_REVIEW_TASK_NOT_FOUND'),
  )
  await assert.rejects(
    harness.lifecycle.createReport('report-task', memberRequester()),
    fixedHttpError(503, 'REPORT_NOT_AVAILABLE'),
  )
})

test('delete expires immediately and returns success only after cleanup removed the row', async () => {
  const harness = lifecycleHarness()
  harness.rows.set('delete-task', taskRow({ id: 'delete-task', status: 'completed' }))
  harness.purge = async (id) => {
    harness.rows.delete(id)
    return { deleted: true, retryable: false, deletedFiles: 1, sharedFiles: 0 }
  }

  assert.deepEqual(await harness.lifecycle.remove('delete-task', memberRequester()), {
    id: 'delete-task', deleted: true,
  })
  assert.equal(harness.updateCalls.at(-1)?.data.status, 'expired')
  const expiresAt = harness.updateCalls.at(-1)?.data.expiresAt
  assert.ok(expiresAt instanceof Date)
  assert.equal(expiresAt.toISOString(), NOW.toISOString())
})

test('delete failure preserves expired-now row for cron retry', async () => {
  const harness = lifecycleHarness()
  harness.rows.set('delete-retry', taskRow({ id: 'delete-retry', status: 'completed' }))
  harness.purge = async () => ({
    deleted: false, retryable: true, deletedFiles: 0, sharedFiles: 0,
  })

  await assert.rejects(
    harness.lifecycle.remove('delete-retry', memberRequester()),
    fixedHttpError(503, 'CONTRACT_REVIEW_DELETE_RETRY'),
  )
  assert.equal(harness.rows.get('delete-retry')?.status, 'expired')
  assert.equal(harness.rows.get('delete-retry')?.expiresAt.toISOString(), NOW.toISOString())
})

test('delete maps an unexpected cleanup failure to the fixed retryable 503', async () => {
  const harness = lifecycleHarness()
  harness.rows.set('delete-throw', taskRow({ id: 'delete-throw', status: 'completed' }))
  harness.purge = async () => { throw new Error('private storage details') }
  await assert.rejects(
    harness.lifecycle.remove('delete-throw', memberRequester()),
    fixedHttpError(503, 'CONTRACT_REVIEW_DELETE_RETRY'),
  )
  assert.equal(harness.rows.get('delete-throw')?.status, 'expired')
})

test('consent service returns the sole active disclaimer content and server snapshot', async () => {
  const disclaimer = {
    id: 'legal-1', version: 'disclaimer-v1', content: '独立同意与风险提示',
    publishedAt: new Date('2026-08-01T10:00:00.000Z'),
  }
  const service = new ContractReviewConsentService({
    legalDocVersion: { async findMany() { return [disclaimer] } },
  } as never, { now: () => NOW.getTime() })

  const scope = await service.getConsentScope()
  assert.deepEqual(scope.disclaimer, {
    ...disclaimer, publishedAt: disclaimer.publishedAt.toISOString(),
  })
  assert.equal(scope.consentVersion, 'contract-review-consent-v1')
  assert.match(scope.consentScopeHash, /^[a-f0-9]{64}$/u)
  assert.equal(scope.disclosures.retention.maximumHours, 2)
})

test('consent service fails closed for missing, ambiguous, malformed, future, and invalid-clock state', async () => {
  const valid = {
    id: 'legal-1', version: 'disclaimer-v1', content: '独立同意与风险提示',
    publishedAt: new Date('2026-08-01T10:00:00.000Z'),
  }
  const candidates = [
    [],
    [valid, { ...valid, id: 'legal-2' }],
    [{ ...valid, id: '' }],
    [{ ...valid, version: '' }],
    [{ ...valid, content: '' }],
    [{ ...valid, publishedAt: null }],
    [{ ...valid, publishedAt: new Date(Number.NaN) }],
    [{ ...valid, publishedAt: new Date('2026-08-01T13:00:00.000Z') }],
  ]
  for (const documents of candidates) {
    const service = new ContractReviewConsentService({
      legalDocVersion: { async findMany() { return documents } },
    } as never, { now: () => NOW.getTime() })
    await assert.rejects(
      service.getConsentScope(),
      fixedHttpError(503, 'CONTRACT_REVIEW_LEGAL_CONFIGURATION_INVALID'),
    )
  }
  const invalidClock = new ContractReviewConsentService({} as never, { now: () => Number.NaN })
  await assert.rejects(
    invalidClock.getConsentScope(),
    fixedHttpError(503, 'CONTRACT_REVIEW_LEGAL_CONFIGURATION_INVALID'),
  )
})

function lifecycleHarness(options: {
  created?: ContractReviewCreatedTask
  queueAdapter?: ContractReviewQueueAdapter
  failExpiryWrite?: boolean
} = {}) {
  const rows = new Map<string, ContractReviewTaskRow>()
  const created = options.created ?? anonymousCreated()
  rows.set(created.id, taskRow({
    id: created.id,
    endUserId: created.accessToken ? null : 'member-a',
    accessTokenHash: created.accessToken
      ? issueAnonymousAccessToken().accessTokenHash
      : null,
    expiresAt: new Date(created.expiresAt),
  }))
  const updateCalls: Array<{
    where: Record<string, unknown>
    data: Partial<ContractReviewTaskRow>
  }> = []
  let confirmWrites = 0
  const queueJobIds: string[] = []
  const prisma = {
    contractReviewTask: {
      async findUnique(args: { where: { id: string } }) {
        const row = rows.get(args.where.id)
        return row ? { ...row } : null
      },
      async updateMany(args: {
        where: Record<string, unknown>
        data: Partial<ContractReviewTaskRow>
      }) {
        updateCalls.push(args)
        if (options.failExpiryWrite && args.data.status === 'expired') {
          throw new Error('database endpoint details')
        }
        const row = rows.get(String(args.where.id))
        if (!row || !matchesWhere(row, args.where)) return { count: 0 }
        if (args.data.confirmedAt) confirmWrites += 1
        rows.set(row.id, { ...row, ...args.data })
        return { count: 1 }
      },
    },
  }
  const service = {
    async create() { return created },
  }
  const defaultAdapter: ContractReviewQueueAdapter = {
    async add(_name, _data, queueOptions) {
      queueJobIds.push(queueOptions.jobId)
      return { id: queueOptions.jobId }
    },
  }
  const queue = new ContractReviewQueueService(options.queueAdapter ?? defaultAdapter)
  const access = new ContractReviewTaskAccess()
  const cleanup = {
    async purgeExpiredTaskById(id: string) { return harness.purge(id) },
  }
  const lifecycle = new ContractReviewLifecycleService(
    prisma as never,
    service as never,
    queue,
    access,
    cleanup as never,
    { now: () => NOW.getTime() },
  )
  const harness = {
    lifecycle, rows, updateCalls, queueJobIds,
    get confirmWrites() { return confirmWrites },
    purge: async (_id: string) => ({
      deleted: false, retryable: true, deletedFiles: 0, sharedFiles: 0,
    }),
  }
  return harness
}

function matchesWhere(row: ContractReviewTaskRow, where: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'id') {
      if (row.id !== expected) return false
      continue
    }
    const actual = row[key as keyof ContractReviewTaskRow]
    if (expected && typeof expected === 'object' && 'in' in expected) {
      if (!(expected as { in: unknown[] }).in.includes(actual)) return false
    } else if (actual !== expected) return false
  }
  return true
}

function taskRow(overrides: Partial<ContractReviewTaskRow> = {}): ContractReviewTaskRow {
  return {
    id: 'task-1',
    sourceFileId: 'source-1',
    resultFileId: null,
    endUserId: 'member-a',
    accessTokenHash: null,
    contractType: 'labor_contract',
    status: 'uploaded',
    analyzedPages: 0,
    totalPages: 1,
    truncated: false,
    ocrConfidence: null,
    expiresAt: new Date('2026-08-01T14:00:00.000Z'),
    resultJson: null,
    extractionFingerprint: null,
    confirmedAt: null,
    errorCode: null,
    ...overrides,
  }
}

function anonymousCreated(): ContractReviewCreatedTask {
  return {
    id: 'created-task', status: 'uploaded', expiresAt: '2026-08-01T14:00:00.000Z',
    accessToken: 'anonymous-token-visible-only-after-queue',
  }
}

function createInput() {
  return {
    sourceFileId: 'source-1', contractType: 'labor_contract' as const,
    consentVersion: 'contract-review-consent-v1', consentedAt: NOW.toISOString(),
    consentScopeHash: 'a'.repeat(64), disclaimerVersion: 'disclaimer-v1',
  }
}

function confirmInput(overrides: Partial<ContractReviewConfirmInput> = {}): ContractReviewConfirmInput {
  return {
    contractType: 'labor_contract', totalPages: 1, analyzedPages: 0, truncated: false,
    ocrCoverageConfirmed: true, personalUseConfirmed: true, ...overrides,
  }
}

function memberRequester() {
  return { endUserId: 'member-a', accessToken: null, sourceFileProof: null }
}

function anonymousRequester() {
  return { endUserId: null, accessToken: null, sourceFileProof: '/signed/source-proof' }
}

function fixedHttpError(status: number, code: string) {
  return (error: unknown) => {
    if (!(error instanceof HttpException) || error.getStatus() !== status) return false
    const response = error.getResponse() as { error?: { code?: string } }
    return response.error?.code === code
  }
}
