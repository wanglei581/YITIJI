/**
 * DB-only resume parse intent phases. In-memory Prisma mock, no provider, no Redis.
 * Quota is not integrated: quota_pending / admitted are phase names only.
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import {
  resumeParseAccessTokenHash,
  resumeParseAnonymousAccessToken,
} from '../src/ai/resume-parse-intent'
import {
  RESUME_PARSE_INTENT_KIND,
  RESUME_PARSE_INTENT_TTL_MS,
  RESUME_PARSE_PROVIDER_LEASE_MS,
  ResumeParseSubmissionService,
  type ResumeParseSubmissionInput,
} from '../src/ai/resume-parse-submission.service'
import type { PrismaService } from '../src/prisma/prisma.service'

const DAY = 24 * 60 * 60 * 1000

interface Row {
  id: string
  taskId: string
  kind: string
  status: string
  payloadJson: string
  provider: string
  endUserId: string | null
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
  accessTokenHash: string | null
}

function token(): string {
  return randomBytes(32).toString('base64url')
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function codeOf(error: unknown): { status: number; code: string; body: string } {
  if (!(error instanceof HttpException)) throw error
  const body = error.getResponse()
  const code = (body as { error?: { code?: string } }).error?.code ?? ''
  return { status: error.getStatus(), code, body: JSON.stringify(body) }
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

function createMock(): {
  prisma: PrismaService
  rows: () => Row[]
  transitions: string[]
  mutate: (taskId: string, kind: string, patch: (row: Row) => void) => void
} {
  const rows = new Map<string, Row>()
  const transitions: string[] = []
  let seq = 0
  let tail = Promise.resolve()
  const atomic = <T>(fn: () => T): Promise<T> => {
    const run = tail.then(fn)
    tail = run.then(() => undefined, () => undefined)
    return run
  }
  const keyOf = (taskId: string, kind: string) => `${kind}:${taskId}`
  const copy = (row: Row): Row => ({
    ...row,
    expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  })
  const matches = (row: Row, where: Record<string, unknown>): boolean => {
    if (where.taskId !== undefined && row.taskId !== where.taskId) return false
    if (where.kind !== undefined && row.kind !== where.kind) return false
    if (where.status !== undefined && row.status !== where.status) return false
    const updatedAt = where.updatedAt as { lt?: Date; lte?: Date } | undefined
    if (updatedAt?.lt && !(row.updatedAt.getTime() < updatedAt.lt.getTime())) return false
    if (updatedAt?.lte && !(row.updatedAt.getTime() <= updatedAt.lte.getTime())) return false
    return true
  }

  const prisma = {
    aiResumeResult: {
      create: ({ data }: { data: Omit<Row, 'id' | 'createdAt' | 'updatedAt' | 'accessTokenHash'> & { accessTokenHash?: string | null } }) => atomic(() => {
        const key = keyOf(data.taskId, data.kind)
        if (rows.has(key)) {
          const error = new Error('unique') as Error & { code: string }
          error.code = 'P2002'
          throw error
        }
        const now = new Date()
        const row: Row = {
          ...data,
          id: `row-${seq += 1}`,
          accessTokenHash: data.accessTokenHash ?? null,
          createdAt: now,
          updatedAt: now,
        }
        rows.set(key, row)
        return copy(row)
      }),
      findUnique: ({ where }: { where: { taskId_kind: { taskId: string; kind: string } } }) => atomic(() => {
        const row = rows.get(keyOf(where.taskId_kind.taskId, where.taskId_kind.kind))
        return row ? copy(row) : null
      }),
      updateMany: ({ where, data }: { where: Record<string, unknown>; data: { status?: string; payloadJson?: string; expiresAt?: Date } }) => atomic(() => {
        const hits = [...rows.values()].filter((row) => matches(row, where))
        for (const row of hits) {
          transitions.push(`${row.status}->${data.status ?? row.status}`)
          if (data.status) row.status = data.status
          if (data.payloadJson) row.payloadJson = data.payloadJson
          if (data.expiresAt) row.expiresAt = new Date(data.expiresAt)
          row.updatedAt = new Date()
        }
        return { count: hits.length }
      }),
    },
  }

  return {
    prisma: prisma as unknown as PrismaService,
    rows: () => [...rows.values()].map(copy),
    transitions,
    mutate: (taskId, kind, patch) => {
      const row = rows.get(keyOf(taskId, kind))
      if (!row) throw new Error('missing row')
      patch(row)
    },
  }
}

function input(partial: Partial<ResumeParseSubmissionInput> & Pick<ResumeParseSubmissionInput, 'intentKey' | 'proof'>): ResumeParseSubmissionInput {
  return {
    endUserId: 'member-a',
    fingerprint: { fileId: 'file-a', fileName: 'a.pdf', fileFormat: 'pdf', source: 'upload' },
    ...partial,
  }
}

function assertHashesOnly(payloadJson: string, secrets: string[]): void {
  const meta = JSON.parse(payloadJson) as Record<string, unknown>
  assert.deepEqual(Object.keys(meta).sort(), ['payloadFingerprint', 'proofHash'])
  for (const secret of secrets) assert.equal(payloadJson.includes(secret), false)
}

async function main(): Promise<void> {
  console.log('=== resume parse submission (db phase only, quota not integrated) ===')
  const previousTtl = process.env['AI_RESUME_RESULT_TTL_HOURS']
  process.env['AI_RESUME_RESULT_TTL_HOURS'] = '24'
  const mock = createMock()
  const service = new ResumeParseSubmissionService(mock.prisma)
  const intentKey = token()
  const proof = token()
  const req = input({ intentKey, proof })

  const [first, second] = await Promise.all([
    service.create(req).then(async (created) => {
      await service.admit(req)
      return service.startProvider(req).then((started) => ({ created, started }))
    }),
    service.create(req).then(async () => {
      await service.admit(req)
      return service.startProvider(req)
    }),
  ])
  const intents = mock.rows().filter((row) => row.kind === RESUME_PARSE_INTENT_KIND)
  assert.equal(intents.length, 1)
  assert.equal(first.created.intentId, intents[0].taskId)
  assert.equal(Number(first.started.advanced) + Number(second.advanced), 1)
  assert.equal(mock.transitions.filter((item) => item === 'quota_pending->admitted').length, 1)
  assert.equal(mock.transitions.filter((item) => item === 'admitted->provider_started').length, 1)
  assertHashesOnly(intents[0].payloadJson, [intentKey, proof, 'file-a', 'a.pdf'])
  pass('concurrent create/start has one winner and stores only hashes')

  const crashKey = token()
  const crashProof = token()
  const t0 = new Date('2026-09-24T00:00:00.000Z')
  const crashReq = input({ intentKey: crashKey, proof: crashProof, endUserId: null, now: t0 })
  const crash = await service.create(crashReq)
  await service.admit(crashReq)
  await service.startProvider(crashReq)
  const stored = { taskId: crash.intentId, status: 'completed', report: { marker: 'kept' } }
  const rightHash = resumeParseAccessTokenHash(resumeParseAnonymousAccessToken(crashKey, crashProof))
  await mock.prisma.aiResumeResult.create({
    data: {
      taskId: crash.intentId,
      kind: 'parse',
      status: 'completed',
      payloadJson: JSON.stringify(stored),
      provider: 'mock',
      endUserId: null,
      accessTokenHash: 'ab'.repeat(32),
      expiresAt: new Date(t0.getTime() + DAY),
    },
  })
  assert.equal((await service.observe(crashReq)).outcome, 'processing')
  mock.mutate(crash.intentId, 'parse', (row) => { row.accessTokenHash = rightHash })
  const seen = await service.observe(crashReq)
  const again = await service.observe(crashReq)
  assert.equal(seen.outcome, 'replay')
  assert.equal(again.outcome, 'replay')
  if (seen.outcome === 'replay' && again.outcome === 'replay') {
    assert.deepEqual(seen.result, stored)
    assert.deepEqual(again.result, stored)
    assert.equal(seen.submission.phase, 'completed')
  }
  assert.equal((await service.startProvider(crashReq)).advanced, false)
  pass('parse committed before complete() replays for the anonymous proof and does not call the provider')

  const otherFile = input({
    intentKey: crashKey,
    proof: crashProof,
    endUserId: null,
    now: t0,
    fingerprint: { fileId: 'file-b', fileName: 'b.pdf', fileFormat: 'pdf', source: 'upload' },
  })
  await expectHttp(() => service.create(otherFile), 409, 'RESUME_PARSE_INTENT_PAYLOAD_MISMATCH')
  const wrongProof = token()
  await expectHttp(() => service.find(input({ intentKey: crashKey, proof: wrongProof, endUserId: null, now: t0 })), 404, 'AI_TASK_NOT_FOUND')
  await expectHttp(() => service.find(input({ intentKey: crashKey, proof: crashProof, endUserId: 'member-b', now: t0 })), 404, 'AI_TASK_NOT_FOUND')
  await expectHttp(
    () => service.find(input({ intentKey: crashKey, proof: wrongProof, endUserId: 'member-b', now: t0, fingerprint: otherFile.fingerprint })),
    404,
    'AI_TASK_NOT_FOUND',
  )
  pass('payload mismatch is 409; wrong proof or owner is masked 404')

  const startedAt = (await service.find(req)).updatedAt
  const withinLease = new Date(startedAt.getTime() + RESUME_PARSE_PROVIDER_LEASE_MS - 1)
  const leaseOver = new Date(startedAt.getTime() + RESUME_PARSE_PROVIDER_LEASE_MS)
  const fresh = await service.observe(input({ intentKey, proof, now: withinLease }))
  assert.equal(fresh.outcome, 'processing')
  const stale = await service.observe(input({ intentKey, proof, now: leaseOver }))
  assert.equal(stale.outcome, 'unknown')
  const restarted = await service.startProvider(input({ intentKey, proof, now: leaseOver }))
  assert.equal(restarted.advanced, false)
  assert.equal(restarted.submission.phase, 'unknown')
  assert.equal(mock.transitions.filter((item) => item === 'admitted->provider_started').length, 2)
  assert.equal(mock.transitions.includes('unknown->provider_started'), false)
  assert.equal(mock.transitions.includes('provider_started->quota_pending'), false)
  pass('stale provider_started becomes unknown and does not start the provider again')

  const lateStored = { taskId: intents[0].taskId, status: 'completed', report: { marker: 'late' } }
  const startsBeforeLate = mock.transitions.filter((item) => item === 'admitted->provider_started').length
  await mock.prisma.aiResumeResult.create({
    data: {
      taskId: intents[0].taskId,
      kind: 'parse',
      status: 'completed',
      payloadJson: JSON.stringify(lateStored),
      provider: 'mock',
      endUserId: 'member-a',
      expiresAt: new Date(leaseOver.getTime() + DAY),
    },
  })
  const late = await service.observe(input({ intentKey, proof, now: leaseOver }))
  assert.equal(late.outcome, 'replay')
  if (late.outcome === 'replay') {
    assert.deepEqual(late.result, lateStored)
    assert.equal(late.submission.phase, 'completed')
  }
  assert.equal((await service.startProvider(input({ intentKey, proof, now: leaseOver }))).advanced, false)
  assert.equal(mock.transitions.filter((item) => item === 'admitted->provider_started').length, startsBeforeLate)
  assert.equal(mock.transitions.includes('unknown->provider_started'), false)
  pass('a result that lands after unknown is replayed and the provider is not called again')

  mock.mutate(intents[0].taskId, RESUME_PARSE_INTENT_KIND, (row) => {
    row.status = 'revoked'
  })
  const revoked = await service.startProvider(req)
  assert.equal(revoked.advanced, false)
  assert.equal(revoked.submission.phase, 'revoked')
  pass('revoked never starts the provider')

  const revokedKey = token()
  const revokedProof = token()
  const revokedReq = input({ intentKey: revokedKey, proof: revokedProof, endUserId: null, now: t0 })
  const revokedCreated = await service.create(revokedReq)
  await service.admit(revokedReq)
  await service.startProvider(revokedReq)
  const expiryBefore = revokedCreated.expiresAt.getTime()
  mock.mutate(revokedCreated.intentId, RESUME_PARSE_INTENT_KIND, (row) => {
    row.status = 'revoked'
  })
  const revokedHash = resumeParseAccessTokenHash(resumeParseAnonymousAccessToken(revokedKey, revokedProof))
  await mock.prisma.aiResumeResult.create({
    data: {
      taskId: revokedCreated.intentId,
      kind: 'parse',
      status: 'completed',
      payloadJson: JSON.stringify({ taskId: revokedCreated.intentId, status: 'completed', report: { marker: 'after-revoke' } }),
      provider: 'mock',
      endUserId: null,
      accessTokenHash: revokedHash,
      expiresAt: new Date(expiryBefore + DAY),
    },
  })
  const writesBefore = mock.transitions.length
  const closed = await service.observe(revokedReq)
  assert.equal(closed.outcome, 'revoked')
  if (closed.outcome === 'revoked') {
    assert.equal(closed.submission.phase, 'revoked')
    assert.equal(closed.submission.expiresAt.getTime(), expiryBefore)
  }
  assert.equal((await service.startProvider(revokedReq)).advanced, false)
  const storedIntent = mock.rows().find((row) => row.taskId === revokedCreated.intentId && row.kind === RESUME_PARSE_INTENT_KIND)
  assert.equal(storedIntent?.status, 'revoked')
  assert.equal(storedIntent?.expiresAt?.getTime(), expiryBefore)
  assert.equal(mock.transitions.length, writesBefore)
  assert.equal(mock.transitions.includes('revoked->completed'), false)
  pass('a valid late parse does not revive or extend a revoked intent')

  const keptKey = token()
  const keptProof = token()
  const kept = input({ intentKey: keptKey, proof: keptProof, now: t0 })
  const created = await service.create(kept)
  assert.equal(created.expiresAt.getTime() - t0.getTime(), RESUME_PARSE_INTENT_TTL_MS)
  assert.ok(RESUME_PARSE_INTENT_TTL_MS >= 48 * 60 * 60 * 1000)
  await service.admit(kept)
  await service.startProvider(kept)
  await service.complete(kept)
  await mock.prisma.aiResumeResult.create({
    data: {
      taskId: created.intentId,
      kind: 'parse',
      status: 'completed',
      payloadJson: JSON.stringify({ taskId: created.intentId, status: 'completed' }),
      provider: 'mock',
      endUserId: 'member-a',
      expiresAt: new Date(t0.getTime() + DAY),
    },
  })
  const afterResultTtl = input({ intentKey: keptKey, proof: keptProof, now: new Date(t0.getTime() + DAY + 1000) })
  const expired = await service.observe(afterResultTtl)
  assert.equal(expired.outcome, 'unavailable')
  if (expired.outcome === 'unavailable') {
    assert.equal(expired.reason, 'expired')
    assert.equal(expired.submission.phase, 'completed')
    assert.ok(expired.submission.expiresAt.getTime() > afterResultTtl.now!.getTime())
  }
  assert.equal((await service.startProvider(afterResultTtl)).advanced, false)

  const missingKey = token()
  const missingProof = token()
  const missingReq = input({ intentKey: missingKey, proof: missingProof, now: t0 })
  await service.create(missingReq)
  await service.admit(missingReq)
  await service.startProvider(missingReq)
  await service.complete(missingReq)
  const missing = await service.observe(missingReq)
  assert.equal(missing.outcome, 'unavailable')
  if (missing.outcome === 'unavailable') assert.equal(missing.reason, 'missing')
  assert.equal((await service.startProvider(missingReq)).advanced, false)
  assert.equal(mock.transitions.includes('completed->provider_started'), false)
  pass('48h intent outlives the 24h parse row; expiry or disappearance does not start another run')

  process.env['AI_RESUME_RESULT_TTL_HOURS'] = '72'
  const longKey = token()
  const longProof = token()
  const longReq = input({ intentKey: longKey, proof: longProof, now: t0 })
  const longCreated = await service.create(longReq)
  const seventyTwoHours = 72 * 60 * 60 * 1000
  assert.equal(longCreated.expiresAt.getTime() - t0.getTime(), seventyTwoHours)
  await service.admit(longReq)
  await service.startProvider(longReq)
  const parseUntil = new Date(longCreated.expiresAt.getTime() + 2 * 60 * 60 * 1000)
  await mock.prisma.aiResumeResult.create({
    data: {
      taskId: longCreated.intentId,
      kind: 'parse',
      status: 'completed',
      payloadJson: JSON.stringify({ taskId: longCreated.intentId, status: 'completed' }),
      provider: 'mock',
      endUserId: 'member-a',
      expiresAt: parseUntil,
    },
  })
  const afterIntent = input({ intentKey: longKey, proof: longProof, now: new Date(longCreated.expiresAt.getTime() + 60 * 60 * 1000) })
  const stillLive = await service.observe(afterIntent)
  assert.equal(stillLive.outcome, 'replay')
  if (stillLive.outcome === 'replay') assert.ok(stillLive.submission.expiresAt.getTime() >= parseUntil.getTime())
  assert.equal((await service.startProvider(afterIntent)).advanced, false)
  assert.equal(mock.transitions.includes('unknown->provider_started'), false)
  pass('intent TTL follows a 72h result TTL and does not hide a still-live parse')

  if (previousTtl === undefined) delete process.env['AI_RESUME_RESULT_TTL_HOURS']
  else process.env['AI_RESUME_RESULT_TTL_HOURS'] = previousTtl
  console.log('PASS resume parse submission')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
