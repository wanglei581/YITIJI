import 'reflect-metadata'

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'
import {
  hashAnonymousAccessToken,
  issueAnonymousAccessToken,
  verifyAnonymousAccessToken,
} from '../contract-review-access'
import { ContractReviewService } from '../contract-review.service'
import {
  ALLOWED_TRANSITIONS,
  assertOwnerShape,
  assertTransition,
} from '../contract-review-state'
import type {
  ContractReviewCreateInput,
  ContractReviewRequester,
  ContractReviewStatus,
} from '../contract-review.types'
import {
  CONSENT_VERSION_BY_SCOPE,
  MemberPrivacyService,
} from '../../member-privacy/member-privacy.service'

const FUTURE = new Date('2099-08-01T02:00:00.000Z')
const CURRENT_CONSENT_VERSION = CONSENT_VERSION_BY_SCOPE.contract_review
const VALID_SCOPE_HASH = 'b'.repeat(64)

interface FileRow {
  id: string
  purpose: string
  status: string
  expiresAt: Date | null
  deletedAt: Date | null
  endUserId: string | null
  ownerType: string | null
  ownerId: string | null
}

interface ConsentRow {
  id: string
  endUserId: string
  scope: string
  consentVersion: string
  grantedAt: Date
  revokedAt: Date | null
}

interface TaskRow extends Record<string, unknown> {
  id: string
  endUserId: string | null
  accessTokenHash: string | null
  status: string
  expiresAt: Date
}

interface HarnessOptions {
  file?: FileRow | null
  consents?: ConsentRow[]
  dbKind?: 'sqlite' | 'postgres'
  transactionFailures?: unknown[]
  taskCreateError?: unknown
}

function cloneConsent(row: ConsentRow): ConsentRow {
  return {
    ...row,
    grantedAt: new Date(row.grantedAt),
    revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
  }
}

function cloneTask(row: TaskRow): TaskRow {
  return { ...row, expiresAt: new Date(row.expiresAt) }
}

function makeHarness(options: HarnessOptions = {}) {
  const file = options.file === undefined ? memberFile() : options.file
  const consents = (options.consents ?? [activeConsent()]).map(cloneConsent)
  const tasks: TaskRow[] = []
  const failures = [...(options.transactionFailures ?? [])]
  const transactionOptions: unknown[] = []
  const operations: string[][] = []
  let transactionCalls = 0
  let createCalls = 0

  const prisma = {
    dbKind: options.dbKind ?? 'sqlite',
    $transaction: async (
      operation: (tx: Record<string, unknown>) => Promise<unknown>,
      txOptions?: unknown
    ) => {
      transactionCalls += 1
      transactionOptions.push(txOptions)
      const injectedFailure = failures.shift()
      if (injectedFailure) throw injectedFailure

      const txConsents = consents.map(cloneConsent)
      const txTasks = tasks.map(cloneTask)
      const txOperations: string[] = []
      operations.push(txOperations)
      const tx = {
        fileObject: {
          findUnique: async ({ where }: { where: { id: string } }) => {
            txOperations.push('file.find')
            return file?.id === where.id ? { ...file } : null
          },
        },
        userAiConsent: {
          findFirst: async ({
            where,
          }: {
            where: { endUserId: string; scope: string }
          }) => {
            txOperations.push('consent.find')
            return (
              txConsents
                .filter(
                  (row) => row.endUserId === where.endUserId && row.scope === where.scope
                )
                .sort(
                  (left, right) =>
                    right.grantedAt.getTime() - left.grantedAt.getTime() ||
                    right.id.localeCompare(left.id)
                )[0] ?? null
            )
          },
          updateMany: async ({
            where,
            data,
          }: {
            where: { endUserId: string; scope: string; revokedAt: null }
            data: { revokedAt: Date }
          }) => {
            txOperations.push('consent.revoke')
            let count = 0
            for (const row of txConsents) {
              if (
                row.endUserId === where.endUserId &&
                row.scope === where.scope &&
                row.revokedAt === null
              ) {
                row.revokedAt = data.revokedAt
                count += 1
              }
            }
            return { count }
          },
        },
        contractReviewTask: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            txOperations.push('task.create')
            createCalls += 1
            if (options.taskCreateError) throw options.taskCreateError
            const row: TaskRow = {
              ...data,
              id: `task-${createCalls}`,
              endUserId: (data.endUserId as string | null) ?? null,
              accessTokenHash: (data.accessTokenHash as string | null) ?? null,
              status: (data.status as string) ?? 'uploaded',
              expiresAt: data.expiresAt as Date,
            }
            txTasks.push(row)
            return cloneTask(row)
          },
          updateMany: async ({
            where,
            data,
          }: {
            where: { endUserId: string; status: { in: string[] } }
            data: { status: string }
          }) => {
            txOperations.push('task.cancel')
            let count = 0
            for (const task of txTasks) {
              if (
                task.endUserId === where.endUserId &&
                where.status.in.includes(task.status)
              ) {
                task.status = data.status
                count += 1
              }
            }
            return { count }
          },
        },
      }
      const result = await operation(tx)
      consents.splice(0, consents.length, ...txConsents)
      tasks.splice(0, tasks.length, ...txTasks)
      return result
    },
  }
  const privacy = new MemberPrivacyService(prisma as never)
  const service = new ContractReviewService(prisma as never, privacy)
  return {
    service,
    privacy,
    state: () => ({
      transactionCalls,
      transactionOptions: [...transactionOptions],
      operations: operations.map((items) => [...items]),
      tasks: tasks.map(cloneTask),
      consents: consents.map(cloneConsent),
      createCalls,
    }),
  }
}

function memberFile(overrides: Partial<FileRow> = {}): FileRow {
  return {
    id: 'contract-file-1',
    purpose: 'contract_upload',
    status: 'active',
    expiresAt: FUTURE,
    deletedAt: null,
    endUserId: 'member-1',
    ownerType: 'user',
    ownerId: 'member-1',
    ...overrides,
  }
}

function anonymousFile(overrides: Partial<FileRow> = {}): FileRow {
  return memberFile({
    endUserId: null,
    ownerType: 'system',
    ownerId: null,
    ...overrides,
  })
}

function activeConsent(overrides: Partial<ConsentRow> = {}): ConsentRow {
  return {
    id: 'consent-1',
    endUserId: 'member-1',
    scope: 'contract_review',
    consentVersion: CURRENT_CONSENT_VERSION,
    grantedAt: new Date('2026-08-01T00:00:00.000Z'),
    revokedAt: null,
    ...overrides,
  }
}

function input(overrides: Partial<ContractReviewCreateInput> = {}): ContractReviewCreateInput {
  return {
    sourceFileId: 'contract-file-1',
    contractType: 'labor_contract',
    consentVersion: CURRENT_CONSENT_VERSION,
    consentedAt: '2026-08-01T00:00:00.000Z',
    consentScopeHash: VALID_SCOPE_HASH,
    disclaimerVersion: 'contract-review-disclaimer-v1',
    ...overrides,
  }
}

const MEMBER: ContractReviewRequester = { endUserId: 'member-1', accessToken: null }
const ANONYMOUS: ContractReviewRequester = { endUserId: null, accessToken: null }

function p2034(message = 'serialization conflict contains private database details'): Error {
  return Object.assign(new Error(message), { code: 'P2034' })
}

async function expectHiddenSource(action: () => Promise<unknown>): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof NotFoundException)
    assert.equal(
      (error.getResponse() as { error?: { code?: string } }).error?.code,
      'CONTRACT_REVIEW_SOURCE_NOT_FOUND'
    )
    return true
  })
}

async function expectConsentRequired(action: () => Promise<unknown>): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof ForbiddenException)
    assert.equal(
      (error.getResponse() as { error?: { code?: string } }).error?.code,
      'USER_AI_CONSENT_REQUIRED'
    )
    return true
  })
}

test('task owner is exactly one of member or anonymous token', () => {
  assert.doesNotThrow(() => assertOwnerShape({ endUserId: 'member-1', accessTokenHash: null }))
  assert.doesNotThrow(() =>
    assertOwnerShape({ endUserId: null, accessTokenHash: 'a'.repeat(64) })
  )
  for (const owner of [
    { endUserId: 'member-1', accessTokenHash: 'a'.repeat(64) },
    { endUserId: null, accessTokenHash: null },
    { endUserId: '', accessTokenHash: null },
    { endUserId: null, accessTokenHash: 'not-a-sha256' },
  ]) {
    assert.throws(() => assertOwnerShape(owner), /CONTRACT_REVIEW_OWNER_INVALID/)
  }
})

test('state machine permits exactly the planned transition table and fails closed for unknowns', () => {
  const statuses = Object.keys(ALLOWED_TRANSITIONS) as ContractReviewStatus[]
  for (const from of statuses) {
    for (const to of statuses) {
      if (ALLOWED_TRANSITIONS[from].includes(to)) {
        assert.doesNotThrow(() => assertTransition(from, to))
      } else {
        assert.throws(() => assertTransition(from, to), /CONTRACT_REVIEW_INVALID_TRANSITION/)
      }
    }
  }
  assert.deepEqual(ALLOWED_TRANSITIONS.expired, [])
  assert.throws(
    () => assertTransition('unknown' as ContractReviewStatus, 'queued'),
    /CONTRACT_REVIEW_INVALID_TRANSITION/
  )
})

test('anonymous token is 32-byte base64url, hashed at rest, and verifiable', () => {
  const first = issueAnonymousAccessToken()
  const second = issueAnonymousAccessToken()

  assert.notEqual(first.accessToken, second.accessToken)
  assert.match(first.accessToken, /^[A-Za-z0-9_-]{43}$/)
  assert.match(first.accessTokenHash, /^[a-f0-9]{64}$/)
  assert.equal(hashAnonymousAccessToken(first.accessToken), first.accessTokenHash)
  assert.notEqual(first.accessTokenHash, first.accessToken)
  assert.equal(verifyAnonymousAccessToken(first.accessToken, first.accessTokenHash), true)
  assert.equal(verifyAnonymousAccessToken(second.accessToken, first.accessTokenHash), false)
})

test('anonymous token verification safely rejects malformed token and stored hash lengths', () => {
  const issued = issueAnonymousAccessToken()
  const malformed: Array<[unknown, unknown]> = [
    [null, issued.accessTokenHash],
    ['', issued.accessTokenHash],
    ['abc', issued.accessTokenHash],
    ['+'.repeat(43), issued.accessTokenHash],
    [issued.accessToken, null],
    [issued.accessToken, 'a'.repeat(63)],
    [issued.accessToken, 'z'.repeat(64)],
    [issued.accessToken, Buffer.alloc(31)],
  ]
  for (const [token, stored] of malformed) {
    assert.equal(verifyAnonymousAccessToken(token, stored), false)
  }
  assert.equal(
    verifyAnonymousAccessToken(issued.accessToken, Buffer.from(issued.accessTokenHash, 'hex')),
    true
  )
})

test('member create reads consent then inserts in one PostgreSQL Serializable transaction', async () => {
  const harness = makeHarness({ dbKind: 'postgres' })

  const created = await harness.service.create(
    input({
      consentVersion: 'client-lie',
      consentedAt: '2099-01-01T00:00:00.000Z',
      consentScopeHash: 'f'.repeat(64),
    }),
    MEMBER
  )
  const state = harness.state()

  assert.equal(created.accessToken, undefined)
  assert.deepEqual(state.operations, [['file.find', 'consent.find', 'task.create']])
  assert.deepEqual(state.transactionOptions, [{ isolationLevel: 'Serializable' }])
  assert.equal(state.tasks[0]?.consentVersion, CURRENT_CONSENT_VERSION)
  assert.equal(
    (state.tasks[0]?.consentedAt as Date).toISOString(),
    '2026-08-01T00:00:00.000Z'
  )
  assert.notEqual(state.tasks[0]?.consentScopeHash, 'f'.repeat(64))
  assert.equal(state.tasks[0]?.endUserId, 'member-1')
  assert.equal(state.tasks[0]?.accessTokenHash, null)
})

test('SQLite strategy omits unsupported isolation options without pretending to test concurrency', async () => {
  const harness = makeHarness({ dbKind: 'sqlite' })

  await harness.service.create(input(), MEMBER)

  assert.deepEqual(harness.state().transactionOptions, [undefined])
})

test('source must exist, be active contract_upload, unexpired, and owned by requester', async () => {
  const invalidFiles: Array<FileRow | null> = [
    null,
    memberFile({ purpose: 'resume_upload' }),
    memberFile({ status: 'uploading' }),
    memberFile({ expiresAt: null }),
    memberFile({ expiresAt: new Date('2000-01-01T00:00:00.000Z') }),
    memberFile({ deletedAt: new Date('2026-08-01T00:00:00.000Z') }),
    memberFile({ endUserId: 'member-2', ownerId: 'member-2' }),
    memberFile({ ownerType: 'system', ownerId: null }),
  ]
  for (const file of invalidFiles) {
    await expectHiddenSource(() => makeHarness({ file }).service.create(input(), MEMBER))
  }

  await expectHiddenSource(() =>
    makeHarness({ file: memberFile() }).service.create(input(), ANONYMOUS)
  )
  await expectHiddenSource(() =>
    makeHarness({ file: anonymousFile({ ownerId: 'unexpected' }) }).service.create(
      input(),
      ANONYMOUS
    )
  )
})

test('task expiry exactly inherits source expiry and is never recalculated', async () => {
  const exactExpiry = new Date('2099-08-01T02:00:00.123Z')
  const harness = makeHarness({ file: memberFile({ expiresAt: exactExpiry }) })

  const created = await harness.service.create(input(), MEMBER)

  assert.equal(created.expiresAt, exactExpiry.toISOString())
  assert.equal(harness.state().tasks[0]?.expiresAt.getTime(), exactExpiry.getTime())
})

test('member create denies missing, old-version, and revoked latest consent', async () => {
  const cases: ConsentRow[][] = [
    [],
    [activeConsent({ consentVersion: 'contract-review-consent-v0' })],
    [activeConsent({ revokedAt: new Date('2026-08-01T00:01:00.000Z') })],
    [
      activeConsent({ id: 'older-active' }),
      activeConsent({
        id: 'newer-revoked',
        grantedAt: new Date('2026-08-01T00:01:00.000Z'),
        revokedAt: new Date('2026-08-01T00:02:00.000Z'),
      }),
    ],
  ]
  for (const consents of cases) {
    const harness = makeHarness({ consents })
    await expectConsentRequired(() => harness.service.create(input(), MEMBER))
    assert.equal(harness.state().tasks.length, 0)
  }
})

test('anonymous create requires a complete current consent snapshot and stores only token hash', async () => {
  const missingSnapshots: Partial<ContractReviewCreateInput>[] = [
    { consentVersion: '' },
    { consentVersion: 'contract-review-consent-v0' },
    { consentedAt: '' },
    { consentedAt: 'not-a-date' },
    { consentScopeHash: '' },
    { consentScopeHash: 'short' },
    { disclaimerVersion: '' },
  ]
  for (const invalid of missingSnapshots) {
    const harness = makeHarness({ file: anonymousFile(), consents: [] })
    await assert.rejects(
      harness.service.create(input(invalid), ANONYMOUS),
      BadRequestException
    )
    assert.equal(harness.state().tasks.length, 0)
  }

  const harness = makeHarness({ file: anonymousFile(), consents: [] })
  const created = await harness.service.create(input(), ANONYMOUS)
  const task = harness.state().tasks[0]
  assert.ok(created.accessToken)
  assert.equal(task?.endUserId, null)
  assert.match(task?.accessTokenHash ?? '', /^[a-f0-9]{64}$/)
  assert.notEqual(task?.accessTokenHash, created.accessToken)
  assert.equal(verifyAnonymousAccessToken(created.accessToken, task?.accessTokenHash), true)
})

test('P2034 conflicts retry once or twice and then commit a single task', async () => {
  for (const conflictCount of [1, 2]) {
    const harness = makeHarness({
      dbKind: 'postgres',
      transactionFailures: Array.from({ length: conflictCount }, () => p2034()),
    })
    await harness.service.create(input(), MEMBER)
    assert.equal(harness.state().transactionCalls, conflictCount + 1)
    assert.equal(harness.state().tasks.length, 1)
    assert.equal(harness.state().createCalls, 1)
  }
})

test('P2034 retry exhaustion returns a redacted retryable error', async () => {
  const harness = makeHarness({
    dbKind: 'postgres',
    transactionFailures: [p2034(), p2034(), p2034('secret row and SQL text')],
  })

  await assert.rejects(harness.service.create(input(), MEMBER), (error: unknown) => {
    assert.ok(error instanceof ServiceUnavailableException)
    const response = JSON.stringify(error.getResponse())
    assert.match(response, /CONTRACT_REVIEW_TRANSACTION_RETRY/)
    assert.doesNotMatch(response, /secret row|SQL text|P2034/i)
    return true
  })
  assert.equal(harness.state().transactionCalls, 3)
  assert.equal(harness.state().tasks.length, 0)
})

test('non-P2034 failures are not retried and are redacted', async () => {
  const failure = Object.assign(new Error('secret database payload'), { code: 'P2028' })
  const harness = makeHarness({ dbKind: 'postgres', transactionFailures: [failure] })

  await assert.rejects(harness.service.create(input(), MEMBER), (error: unknown) => {
    assert.ok(error instanceof InternalServerErrorException)
    assert.doesNotMatch(JSON.stringify(error.getResponse()), /secret database payload|P2028/)
    return true
  })
  assert.equal(harness.state().transactionCalls, 1)
})

test('create then revoke cancels the processing task under the shared transaction protocol', async () => {
  const harness = makeHarness({ dbKind: 'postgres' })
  await harness.service.create(input(), MEMBER)

  await harness.privacy.revokeConsent('member-1', 'contract_review')

  assert.equal(harness.state().tasks[0]?.status, 'cancelled')
  assert.ok(harness.state().consents[0]?.revokedAt)
  assert.deepEqual(harness.state().transactionOptions, [
    { isolationLevel: 'Serializable' },
    { isolationLevel: 'Serializable' },
  ])
})

test('revoke then create observes latest revoked truth and leaves no processing task', async () => {
  const harness = makeHarness({ dbKind: 'postgres' })
  await harness.privacy.revokeConsent('member-1', 'contract_review')

  await expectConsentRequired(() => harness.service.create(input(), MEMBER))

  assert.equal(harness.state().tasks.length, 0)
  assert.ok(harness.state().consents[0]?.revokedAt)
})

test('contract revoke retries only P2034 and reports exhaustion without leaking details', async () => {
  const retrying = makeHarness({
    dbKind: 'postgres',
    transactionFailures: [p2034(), p2034()],
  })
  assert.deepEqual(await retrying.privacy.revokeConsent('member-1', 'contract_review'), {
    revoked: true,
    count: 1,
  })
  assert.equal(retrying.state().transactionCalls, 3)

  const exhausted = makeHarness({
    dbKind: 'postgres',
    transactionFailures: [p2034(), p2034(), p2034('private SQL')],
  })
  await assert.rejects(exhausted.privacy.revokeConsent('member-1', 'contract_review'), (error) => {
    assert.ok(error instanceof ServiceUnavailableException)
    assert.doesNotMatch(JSON.stringify(error.getResponse()), /private SQL|P2034/i)
    return true
  })
  assert.equal(exhausted.state().transactionCalls, 3)
})
