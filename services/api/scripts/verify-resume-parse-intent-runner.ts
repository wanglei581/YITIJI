/**
 * ResumeParseIntentRunner with fake submission, quota, and AI services.
 * No production Redis, database, or provider.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ConflictException, HttpException, NotFoundException } from '@nestjs/common'
import { ResumeParseIntentRunner } from '../src/ai/resume-parse-intent-runner.service'
import { resumeParseAnonymousAccessToken, resumeParseIntentId } from '../src/ai/resume-parse-intent'
import type { ParseResumeInput, ParseResumeOutput } from '../src/ai/interfaces/ai-provider.interface'
import type { AiPublicQuotaContext } from '../src/ai/ai-public-quota.service'
import type { ResumeParseSubmissionService } from '../src/ai/resume-parse-submission.service'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function token(): string {
  return randomBytes(32).toString('base64url')
}

function dto(fileId = 'file-a'): ParseResumeInput {
  return { fileId, fileName: 'a.pdf', fileFormat: 'pdf', source: 'upload' }
}

function codeOf(error: unknown): { status: number; code: string } {
  if (!(error instanceof HttpException)) throw error
  const body = error.getResponse() as { error?: { code?: string } }
  return { status: error.getStatus(), code: body.error?.code ?? '' }
}

async function expectHttp(run: () => Promise<unknown>, status: number, code: string): Promise<void> {
  try {
    await run()
    throw new Error(`expected ${status} ${code}`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('expected ')) throw error
    const seen = codeOf(error)
    assert.equal(seen.status, status)
    assert.equal(seen.code, code)
  }
}

interface Row {
  intentId: string
  phase: 'quota_pending' | 'admitted' | 'provider_started' | 'completed' | 'unknown' | 'revoked'
  endUserId: string | null
  proof: string
  fingerprint: string
  expiresAt: Date
}

function harness() {
  const rows = new Map<string, Row>()
  const results = new Map<string, ParseResumeOutput>()
  const quotaCalls: Array<{ intentId: string; markerTtlSeconds: number; outcome: 'charged' | 'replay' }> = []
  const charged = new Set<string>()
  let providerCalls = 0
  let providerWins = 0
  let rejectQuota = false
  let providerError: Error | null = null
  let rollbacks = 0
  let fileProbes = 0
  let fileError: Error | null = null
  let releaseProvider: (() => void) | null = null
  let markProviderEntered: (() => void) | null = null
  const providerEntered = new Promise<void>((resolve) => { markProviderEntered = resolve })
  const issuedTokens = new Map<string, string>()
  let lastRequester: { endUserId: string | null; accessToken: string | null } | null = null

  const submission = {
    async create(input: { intentKey: string; proof: string; endUserId: string | null; fingerprint: ParseResumeInput }) {
      const intentId = resumeParseIntentId(input.intentKey)
      const fingerprint = JSON.stringify(input.fingerprint)
      const existing = rows.get(intentId)
      if (!existing) {
        const row: Row = {
          intentId,
          phase: 'quota_pending',
          endUserId: input.endUserId,
          proof: input.proof,
          fingerprint,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
        }
        rows.set(intentId, row)
        return snapshot(row)
      }
      if (existing.endUserId !== input.endUserId || existing.proof !== input.proof) {
        throw new NotFoundException({ error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在' } })
      }
      if (existing.fingerprint !== fingerprint) {
        throw new ConflictException({ error: { code: 'RESUME_PARSE_INTENT_PAYLOAD_MISMATCH', message: '同一解析标识不能改用另一份材料' } })
      }
      return snapshot(existing)
    },
    async observe(input: { intentKey: string; proof: string; endUserId: string | null; fingerprint: ParseResumeInput }) {
      const row = await this.create(input)
      const stored = rows.get(row.intentId)
      if (!stored) throw new NotFoundException({ error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在' } })
      if (stored.phase === 'revoked') return { outcome: 'revoked' as const, submission: snapshot(stored) }
      const result = results.get(stored.intentId)
      if (result) return { outcome: 'replay' as const, submission: snapshot(stored), result }
      if (stored.phase === 'unknown') return { outcome: 'unknown' as const, submission: snapshot(stored) }
      if (stored.phase === 'provider_started') return { outcome: 'processing' as const, submission: snapshot(stored) }
      if (stored.phase === 'completed') return { outcome: 'unavailable' as const, reason: 'missing' as const, submission: snapshot(stored) }
      return { outcome: 'not_ready' as const, submission: snapshot(stored) }
    },
    async admit(input: { intentKey: string }) {
      const row = rows.get(resumeParseIntentId(input.intentKey))
      if (!row || row.phase !== 'quota_pending') return { advanced: false, submission: snapshot(row!) }
      row.phase = 'admitted'
      return { advanced: true, submission: snapshot(row) }
    },
    async startProvider(input: { intentKey: string }) {
      const row = rows.get(resumeParseIntentId(input.intentKey))
      if (!row || row.phase !== 'admitted') return { advanced: false, submission: snapshot(row!) }
      row.phase = 'provider_started'
      providerWins += 1
      return { advanced: true, submission: snapshot(row) }
    },
    async complete(input: { intentKey: string }) {
      const row = rows.get(resumeParseIntentId(input.intentKey))
      if (!row || row.phase !== 'provider_started') return { advanced: false, submission: snapshot(row!) }
      row.phase = 'completed'
      return { advanced: true, submission: snapshot(row) }
    },
  }

  const quota = {
    async consumeOnce(input: { intentId: string; markerTtlSeconds: number }) {
      if (rejectQuota) {
        throw new HttpException({ error: { code: 'AI_PUBLIC_QUOTA_EXCEEDED', message: '今日 AI 使用次数已达上限' } }, 429)
      }
      const outcome = charged.has(input.intentId) ? 'replay' as const : 'charged' as const
      charged.add(input.intentId)
      quotaCalls.push({ intentId: input.intentId, markerTtlSeconds: input.markerTtlSeconds, outcome })
      return { outcome, day: '2026-09-24' }
    },
    async rollback() {
      rollbacks += 1
    },
  }

  const ai = {
    async submitResumeParse(
      _dto: ParseResumeInput,
      endUserId: string | null,
      intent: { intentId: string; accessToken: string | null },
    ) {
      providerCalls += 1
      if (endUserId) assert.equal(intent.accessToken, null)
      else {
        assert.equal(typeof intent.accessToken, 'string')
        issuedTokens.set(intent.intentId, intent.accessToken!)
      }
      if (providerError) throw providerError
      markProviderEntered?.()
      if (releaseProvider) await new Promise<void>((resolve) => { releaseProvider = resolve })
      const output: ParseResumeOutput = { taskId: intent.intentId, status: 'completed', report: { marker: 'kept' } as never }
      results.set(intent.intentId, output)
      return output
    },
    async getResumeRecord(taskId: string, requester?: { endUserId: string | null; accessToken: string | null }) {
      const output = results.get(taskId)
      const expected = issuedTokens.get(taskId)
      if (!output || (expected && requester?.accessToken !== expected)) {
        throw new NotFoundException({ error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在' } })
      }
      lastRequester = requester ?? null
      return output
    },
  }

  const files = {
    async assertContentAccessibleForEndUser() {
      fileProbes += 1
      if (fileError) throw fileError
    },
  }
  const runner = new ResumeParseIntentRunner(
    submission as unknown as ResumeParseSubmissionService,
    quota as never,
    ai as never,
    files as never,
  )
  return {
    runner,
    quotaCalls,
    fileProbes: () => fileProbes,
    rollbacks: () => rollbacks,
    providerCalls: () => providerCalls,
    providerWins: () => providerWins,
    phase: (intentKey: string) => rows.get(resumeParseIntentId(intentKey))?.phase,
    rejectQuota: () => { rejectQuota = true },
    rejectFile: () => {
      fileError = new NotFoundException({ error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' } })
    },
    failProvider: () => { providerError = new Error('provider down') },
    hangProvider: () => {
      releaseProvider = () => undefined
    },
    providerEntered: () => providerEntered,
    releaseProvider: () => {
      const release = releaseProvider
      releaseProvider = null
      release?.()
    },
    read: (taskId: string, requester: { endUserId: string | null; accessToken: string | null }) =>
      ai.getResumeRecord(taskId, requester),
    lastRequester: () => lastRequester,
  }
}

function snapshot(row: Row) {
  return {
    intentId: row.intentId,
    phase: row.phase,
    endUserId: row.endUserId,
    payloadFingerprint: 'fingerprint',
    expiresAt: row.expiresAt,
    updatedAt: row.expiresAt,
  }
}

async function main(): Promise<void> {
  console.log('=== resume parse intent runner ===')
  const source = readFileSync(join(dirname(__filename), '../src/ai/resume-parse-intent-runner.service.ts'), 'utf8')
  assert.equal(source.includes('runWithPublicQuota'), false)
  assert.equal(source.includes('rollback'), false)
  const submitSource = source.slice(source.indexOf('async submit'))
  const observeAt = submitSource.indexOf('this.submission.observe')
  const fileAt = submitSource.indexOf('assertContentAccessibleForEndUser')
  const quotaAt = submitSource.indexOf('this.quota.consumeOnce')
  const startAt = submitSource.indexOf('this.submission.startProvider')
  assert.ok(observeAt >= 0 && fileAt > observeAt && quotaAt > fileAt && startAt > quotaAt)

  const context: AiPublicQuotaContext = { member: 'member-a', terminal: null, ip: '203.0.113.10' }
  const key = token()
  const proof = token()
  const shared = harness()
  const raced = await Promise.all([
    shared.runner.submit(dto(), 'member-a', context, key, proof),
    shared.runner.submit(dto(), 'member-a', context, key, proof),
  ])
  assert.equal(shared.providerCalls(), 1)
  assert.equal(shared.providerWins(), 1)
  assert.equal(shared.quotaCalls.filter((call) => call.outcome === 'charged').length, 1)
  assert.ok(raced.some((item) => item.status === 'completed' && item.taskId === resumeParseIntentId(key)))
  assert.ok(raced.every((item) => item.status === 'completed' || item.status === 'processing'))
  assert.ok(raced.every((item) => item.accessToken === undefined))
  pass('concurrent same intent calls the provider once and charges once')

  const replay = harness()
  const anonKey = token()
  const anonProof = token()
  const first = await replay.runner.submit(dto(), null, context, anonKey, anonProof)
  const second = await replay.runner.submit(dto(), null, context, anonKey, anonProof)
  const expectedToken = resumeParseAnonymousAccessToken(anonKey, anonProof)
  assert.equal(first.taskId, second.taskId)
  assert.equal(first.accessToken, expectedToken)
  assert.equal(second.accessToken, expectedToken)
  assert.equal(replay.providerCalls(), 1)
  assert.equal(replay.quotaCalls.filter((call) => call.outcome === 'charged').length, 1)
  assert.equal(replay.rollbacks(), 0)
  assert.ok(replay.quotaCalls[0]!.markerTtlSeconds >= 48 * 60 * 60 - 2)
  pass('a lost first response replays the same result without another charge or provider call')

  const limited = harness()
  const limitedKey = token()
  limited.rejectQuota()
  await expectHttp(
    () => limited.runner.submit(dto(), 'member-a', context, limitedKey, token()),
    429,
    'AI_PUBLIC_QUOTA_EXCEEDED',
  )
  assert.equal(limited.providerCalls(), 0)
  assert.equal(limited.providerWins(), 0)
  assert.equal(limited.phase(limitedKey), 'quota_pending')
  pass('quota 429 does not start the provider')

  const missingFile = harness()
  const missingKey = token()
  const missingProof = token()
  missingFile.rejectFile()
  await expectHttp(
    () => missingFile.runner.submit(dto(), null, context, missingKey, missingProof),
    404,
    'FILE_NOT_FOUND',
  )
  await expectHttp(
    () => missingFile.runner.submit(dto(), null, context, missingKey, missingProof),
    404,
    'FILE_NOT_FOUND',
  )
  assert.equal(missingFile.quotaCalls.length, 0)
  assert.equal(missingFile.providerCalls(), 0)
  assert.equal(missingFile.providerWins(), 0)
  assert.equal(missingFile.phase(missingKey), 'quota_pending')
  assert.ok(missingFile.fileProbes() >= 2)
  pass('an unreadable file is rejected before quota and does not complete the intent')

  const owned = harness()
  const ownedKey = token()
  const ownedProof = token()
  await owned.runner.submit(dto(), 'member-a', context, ownedKey, ownedProof)
  const before = owned.quotaCalls.length
  const probesBeforeRejection = owned.fileProbes()
  await expectHttp(
    () => owned.runner.submit(dto(), 'member-a', context, ownedKey, token()),
    404,
    'AI_TASK_NOT_FOUND',
  )
  await expectHttp(
    () => owned.runner.submit(dto(), 'member-b', context, ownedKey, ownedProof),
    404,
    'AI_TASK_NOT_FOUND',
  )
  await expectHttp(
    () => owned.runner.submit(dto('file-b'), 'member-a', context, ownedKey, ownedProof),
    409,
    'RESUME_PARSE_INTENT_PAYLOAD_MISMATCH',
  )
  assert.equal(owned.quotaCalls.length, before)
  assert.equal(owned.providerCalls(), 1)
  assert.equal(owned.fileProbes(), probesBeforeRejection)
  pass('wrong proof, owner, and fingerprint are rejected before another charge or file probe')

  const replayWithoutFile = harness()
  const replayKey = token()
  const replayProof = token()
  await replayWithoutFile.runner.submit(dto(), null, context, replayKey, replayProof)
  const probesAfterSuccess = replayWithoutFile.fileProbes()
  replayWithoutFile.rejectFile()
  const replayedAnyway = await replayWithoutFile.runner.submit(dto(), null, context, replayKey, replayProof)
  assert.equal(replayedAnyway.status, 'completed')
  assert.equal(replayedAnyway.taskId, resumeParseIntentId(replayKey))
  assert.equal(replayWithoutFile.fileProbes(), probesAfterSuccess)
  assert.equal(replayWithoutFile.providerCalls(), 1)
  assert.equal(replayWithoutFile.quotaCalls.filter((call) => call.outcome === 'charged').length, 1)
  pass('a stored result replays after the file is no longer readable')

  const crashed = harness()
  const crashKey = token()
  const crashProof = token()
  crashed.failProvider()
  await assert.rejects(() => crashed.runner.submit(dto(), 'member-a', context, crashKey, crashProof))
  assert.equal(crashed.phase(crashKey), 'provider_started')
  const afterCrash = await crashed.runner.submit(dto(), 'member-a', context, crashKey, crashProof)
  assert.equal(afterCrash.status, 'processing')
  assert.equal(afterCrash.taskId, resumeParseIntentId(crashKey))
  assert.equal(afterCrash.accessToken, undefined)
  assert.equal(crashed.providerCalls(), 1)
  assert.equal(crashed.providerWins(), 1)
  assert.equal(crashed.rollbacks(), 0)
  pass('a provider exception stays provider_started and is not restarted or refunded')

  const hung = harness()
  const hangKey = token()
  const hangProof = token()
  const hangToken = resumeParseAnonymousAccessToken(hangKey, hangProof)
  hung.hangProvider()
  const pending = hung.runner.submit(dto(), null, context, hangKey, hangProof)
  await hung.providerEntered()
  const polling = await hung.runner.submit(dto(), null, context, hangKey, hangProof)
  assert.equal(polling.status, 'processing')
  assert.equal(polling.taskId, resumeParseIntentId(hangKey))
  assert.equal(polling.accessToken, hangToken)
  assert.equal(hung.providerCalls(), 1)
  assert.equal(hung.providerWins(), 1)
  assert.equal(hung.quotaCalls.filter((call) => call.outcome === 'charged').length, 1)
  hung.releaseProvider()
  const finished = await pending
  assert.equal(finished.status, 'completed')
  assert.equal(finished.accessToken, polling.accessToken)
  const readable = await hung.read(finished.taskId!, { endUserId: null, accessToken: polling.accessToken! })
  assert.equal(readable.taskId, finished.taskId)
  assert.equal(readable.accessToken, undefined)
  assert.deepEqual(hung.lastRequester(), { endUserId: null, accessToken: hangToken })
  await expectHttp(
    () => hung.read(finished.taskId!, { endUserId: null, accessToken: null }),
    404,
    'AI_TASK_NOT_FOUND',
  )
  assert.equal(hung.providerCalls(), 1)
  assert.equal(hung.rollbacks(), 0)
  pass('anonymous processing carries the same token that later reads the stored result')

  console.log('PASS resume parse intent runner')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
