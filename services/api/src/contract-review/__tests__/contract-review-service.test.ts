import 'reflect-metadata'

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
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
import {
  ContractReviewService,
  createContractReviewConsentScopeSnapshot,
} from '../contract-review.service'
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

const TEST_NOW = Date.now()
const FUTURE = new Date('2099-08-01T02:00:00.000Z')
const DISCLAIMER_PUBLISHED_AT = new Date(TEST_NOW - 5 * 60 * 1000)
const CURRENT_CONSENT_VERSION = CONSENT_VERSION_BY_SCOPE.contract_review
const FILE_SIGNING_SECRET = 'contract-review-test-signing-secret-at-least-32-bytes'
process.env['FILE_SIGNING_SECRET'] = FILE_SIGNING_SECRET

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

interface LegalDocRow {
  id: string
  version: string
  content: string
  publishedAt: Date | null
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
  legalDocs?: LegalDocRow[]
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

function cloneLegalDoc(row: LegalDocRow): LegalDocRow {
  return {
    ...row,
    publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
  }
}

function makeHarness(options: HarnessOptions = {}) {
  const file = options.file === undefined ? memberFile() : options.file
  const consents = (options.consents ?? [activeConsent()]).map(cloneConsent)
  const legalDocs = (options.legalDocs ?? [activeDisclaimer()]).map(cloneLegalDoc)
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
        legalDocVersion: {
          findMany: async () => {
            txOperations.push('legal.findMany')
            return legalDocs.slice(0, 2).map(cloneLegalDoc)
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
      const commitFailure = failures.shift()
      if (commitFailure) throw commitFailure
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
    grantedAt: new Date(TEST_NOW - 2 * 60 * 1000),
    revokedAt: null,
    ...overrides,
  }
}

function activeDisclaimer(overrides: Partial<LegalDocRow> = {}): LegalDocRow {
  return {
    id: 'contract-review-disclaimer-doc-1',
    version: 'contract-review-disclaimer-v1',
    content: '合同审查告知与免责声明',
    publishedAt: DISCLAIMER_PUBLISHED_AT,
    ...overrides,
  }
}

function scopeHash(doc: LegalDocRow = activeDisclaimer()): string {
  assert.ok(doc.publishedAt)
  return createContractReviewConsentScopeSnapshot({ ...doc, publishedAt: doc.publishedAt })
    .consentScopeHash
}

function input(
  overrides: Partial<ContractReviewCreateInput> = {},
  doc: LegalDocRow = activeDisclaimer()
): ContractReviewCreateInput {
  return {
    sourceFileId: 'contract-file-1',
    contractType: 'labor_contract',
    consentVersion: CURRENT_CONSENT_VERSION,
    consentedAt: new Date(TEST_NOW - 60 * 1000).toISOString(),
    consentScopeHash: scopeHash(doc),
    disclaimerVersion: doc.version,
    ...overrides,
  }
}

function signedSourceProof(
  fileId = 'contract-file-1',
  expiresAt = TEST_NOW + 5 * 60 * 1000
): string {
  const signature = createHmac('sha256', FILE_SIGNING_SECRET)
    .update(`${fileId}.${expiresAt}`)
    .digest('hex')
  return `/api/v1/files/${fileId}/content?expires=${expiresAt}&sig=${signature}`
}

const MEMBER: ContractReviewRequester = {
  endUserId: 'member-1',
  accessToken: null,
  sourceFileProof: null,
}
const ANONYMOUS: ContractReviewRequester = {
  endUserId: null,
  accessToken: null,
  sourceFileProof: signedSourceProof(),
}

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

test('state machine matches an independently hard-coded transition matrix', () => {
  const expected: Readonly<Record<ContractReviewStatus, readonly ContractReviewStatus[]>> = {
    uploaded: ['queued', 'cancelled', 'expired'],
    queued: ['extracting', 'cancelled', 'failed', 'expired'],
    extracting: ['awaiting_confirmation', 'failed', 'cancelled', 'expired'],
    awaiting_confirmation: ['rule_checking', 'cancelled', 'expired'],
    rule_checking: ['ai_analyzing', 'failed', 'cancelled', 'expired'],
    ai_analyzing: ['safety_reviewing', 'failed', 'cancelled', 'expired'],
    safety_reviewing: ['completed', 'failed', 'cancelled', 'expired'],
    completed: ['expired'],
    failed: ['expired'],
    cancelled: ['expired'],
    expired: [],
  }
  const statuses = Object.keys(expected) as ContractReviewStatus[]
  assert.deepEqual(ALLOWED_TRANSITIONS, expected)
  for (const from of statuses) {
    for (const to of statuses) {
      if (expected[from].includes(to)) {
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

test('state transition matrix is recursively frozen at runtime', () => {
  const originalUploaded = [...ALLOWED_TRANSITIONS.uploaded]

  assert.equal(Object.isFrozen(ALLOWED_TRANSITIONS), true)
  for (const transitions of Object.values(ALLOWED_TRANSITIONS)) {
    assert.equal(Object.isFrozen(transitions), true)
  }
  assert.equal(Reflect.set(ALLOWED_TRANSITIONS.uploaded, 0, 'completed'), false)
  assert.equal(Reflect.set(ALLOWED_TRANSITIONS, 'uploaded', ['completed']), false)
  assert.deepEqual(ALLOWED_TRANSITIONS.uploaded, originalUploaded)
  assert.doesNotThrow(() => assertTransition('uploaded', 'queued'))
  assert.throws(
    () => assertTransition('uploaded', 'completed'),
    /CONTRACT_REVIEW_INVALID_TRANSITION/
  )
})

test('consent scope snapshot is deterministic and binds all disclaimer fields and disclosures', () => {
  const doc = activeDisclaimer()
  assert.ok(doc.publishedAt)
  const first = createContractReviewConsentScopeSnapshot({
    ...doc,
    publishedAt: doc.publishedAt,
  })
  const second = createContractReviewConsentScopeSnapshot({
    content: doc.content,
    publishedAt: new Date(doc.publishedAt),
    version: doc.version,
    id: doc.id,
  })

  assert.deepEqual(first, second)
  assert.match(first.consentScopeHash, /^[a-f0-9]{64}$/)
  assert.equal(first.scope.scope, 'contract_review')
  assert.equal(first.scope.consentVersion, CURRENT_CONSENT_VERSION)
  assert.equal(Object.keys(first.scope.disclosures).length, 7)
  assert.equal(first.scope.disclaimer.id, doc.id)
  assert.equal(first.scope.disclaimer.version, doc.version)
  assert.equal(first.scope.disclaimer.publishedAt, doc.publishedAt.toISOString())
  for (const changed of [
    { ...doc, id: `${doc.id}-changed`, publishedAt: doc.publishedAt },
    { ...doc, version: `${doc.version}-changed`, publishedAt: doc.publishedAt },
    { ...doc, content: `${doc.content}更新`, publishedAt: doc.publishedAt },
    {
      ...doc,
      publishedAt: new Date(doc.publishedAt.getTime() + 1),
    },
  ]) {
    assert.notEqual(
      createContractReviewConsentScopeSnapshot(changed).consentScopeHash,
      first.consentScopeHash
    )
  }
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
    }),
    MEMBER
  )
  const state = harness.state()

  assert.equal(created.accessToken, undefined)
  assert.deepEqual(state.operations, [
    ['file.find', 'legal.findMany', 'consent.find', 'task.create'],
  ])
  assert.deepEqual(state.transactionOptions, [{ isolationLevel: 'Serializable' }])
  assert.equal(state.tasks[0]?.consentVersion, CURRENT_CONSENT_VERSION)
  assert.equal(
    (state.tasks[0]?.consentedAt as Date).toISOString(),
    activeConsent().grantedAt.toISOString()
  )
  assert.equal(state.tasks[0]?.consentScopeHash, scopeHash())
  assert.equal(state.tasks[0]?.disclaimerVersion, activeDisclaimer().version)
  assert.equal(state.tasks[0]?.endUserId, 'member-1')
  assert.equal(state.tasks[0]?.accessTokenHash, null)
})

test('a valid short-lived source proof is bearer proof, not an unintended one-time token', async () => {
  const harness = makeHarness({ file: anonymousFile(), consents: [] })

  const first = await harness.service.create(input(), ANONYMOUS)
  const second = await harness.service.create(input(), ANONYMOUS)

  assert.notEqual(first.id, second.id)
  assert.notEqual(first.accessToken, second.accessToken)
  assert.equal(harness.state().tasks.length, 2)
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

test('anonymous create requires a valid signed source proof for the exact source file', async () => {
  const requesters: ContractReviewRequester[] = [
    { endUserId: null, accessToken: null, sourceFileProof: null },
    { endUserId: null, accessToken: 'task-token-is-not-source-proof', sourceFileProof: null },
    { endUserId: null, accessToken: null, sourceFileProof: '' },
    { endUserId: null, accessToken: null, sourceFileProof: 'not-a-url' },
    {
      endUserId: null,
      accessToken: null,
      sourceFileProof: signedSourceProof('different-file'),
    },
    {
      endUserId: null,
      accessToken: null,
      sourceFileProof: signedSourceProof('contract-file-1', TEST_NOW - 1),
    },
    {
      endUserId: null,
      accessToken: null,
      sourceFileProof: `${signedSourceProof()}tampered`,
    },
  ]

  for (const requester of requesters) {
    const harness = makeHarness({ file: anonymousFile(), consents: [] })
    await expectHiddenSource(() => harness.service.create(input(), requester))
    assert.equal(harness.state().transactionCalls, 0)
    assert.equal(harness.state().tasks.length, 0)
  }
})

test('member create rejects task tokens and source proofs instead of mixing requester modes', async () => {
  for (const requester of [
    { ...MEMBER, accessToken: 'unexpected-task-token' },
    { ...MEMBER, sourceFileProof: signedSourceProof() },
  ]) {
    const harness = makeHarness()
    await assert.rejects(harness.service.create(input(), requester), BadRequestException)
    assert.equal(harness.state().transactionCalls, 0)
  }
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
        grantedAt: new Date(TEST_NOW - 60 * 1000),
        revokedAt: new Date(TEST_NOW - 30 * 1000),
      }),
    ],
  ]
  for (const consents of cases) {
    const harness = makeHarness({ consents })
    await expectConsentRequired(() => harness.service.create(input(), MEMBER))
    assert.equal(harness.state().tasks.length, 0)
  }
})

test('create fails closed unless exactly one fully published disclaimer is active', async () => {
  const invalidLegalDocs: LegalDocRow[][] = [
    [],
    [activeDisclaimer(), activeDisclaimer({ id: 'duplicate-active-doc' })],
    [activeDisclaimer({ publishedAt: null })],
    [activeDisclaimer({ id: '' })],
    [activeDisclaimer({ version: '' })],
    [activeDisclaimer({ content: '' })],
  ]

  for (const legalDocs of invalidLegalDocs) {
    const harness = makeHarness({ legalDocs })
    await assert.rejects(harness.service.create(input(), MEMBER), (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException)
      assert.equal(
        (error.getResponse() as { error?: { code?: string } }).error?.code,
        'CONTRACT_REVIEW_LEGAL_CONFIGURATION_INVALID'
      )
      return true
    })
    assert.equal(harness.state().tasks.length, 0)
  }
})

test('member and anonymous create require the exact active disclaimer version and scope hash', async () => {
  for (const requester of [MEMBER, ANONYMOUS]) {
    const file = requester.endUserId ? memberFile() : anonymousFile()
    const consents = requester.endUserId ? undefined : []
    for (const invalid of [
      { disclaimerVersion: 'stale-disclaimer-version' },
      { disclaimerVersion: ` ${activeDisclaimer().version}` },
      { consentScopeHash: 'f'.repeat(64) },
      { consentScopeHash: scopeHash(activeDisclaimer({ content: 'stale content' })) },
    ]) {
      const harness = makeHarness({ file, consents })
      await assert.rejects(harness.service.create(input(invalid), requester), (error: unknown) => {
        assert.ok(error instanceof BadRequestException)
        assert.equal(
          (error.getResponse() as { error?: { code?: string } }).error?.code,
          'CONTRACT_REVIEW_CONSENT_SNAPSHOT_INVALID'
        )
        return true
      })
      assert.equal(harness.state().tasks.length, 0)
    }
  }
})

test('member grant must be current and no earlier than active disclaimer publication', async () => {
  const harness = makeHarness({
    consents: [activeConsent({ grantedAt: new Date(DISCLAIMER_PUBLISHED_AT.getTime() - 1) })],
  })

  await expectConsentRequired(() => harness.service.create(input(), MEMBER))
  assert.equal(harness.state().tasks.length, 0)
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
  assert.equal(task?.consentScopeHash, scopeHash())
  assert.equal(task?.disclaimerVersion, activeDisclaimer().version)
})

test('anonymous consent timestamp rejects future, stale, and pre-publication snapshots', async () => {
  const invalidTimes = [
    new Date(Date.now() + 60_001).toISOString(),
    new Date(Date.now() - 15 * 60 * 1000 - 1_000).toISOString(),
    new Date(DISCLAIMER_PUBLISHED_AT.getTime() - 1).toISOString(),
  ]

  for (const consentedAt of invalidTimes) {
    const harness = makeHarness({ file: anonymousFile(), consents: [] })
    await assert.rejects(
      harness.service.create(input({ consentedAt }), ANONYMOUS),
      BadRequestException
    )
    assert.equal(harness.state().tasks.length, 0)
  }

  const withinFutureSkew = makeHarness({ file: anonymousFile(), consents: [] })
  await withinFutureSkew.service.create(
    input({ consentedAt: new Date(Date.now() + 59_000).toISOString() }),
    ANONYMOUS
  )
  assert.equal(withinFutureSkew.state().tasks.length, 1)
})

test('commit-time P2034 rolls back and reexecutes the callback without duplicate business state', async () => {
  for (const conflictCount of [1, 2]) {
    const harness = makeHarness({
      dbKind: 'postgres',
      transactionFailures: Array.from({ length: conflictCount }, () => p2034()),
    })
    await harness.service.create(input(), MEMBER)
    assert.equal(harness.state().transactionCalls, conflictCount + 1)
    assert.equal(harness.state().operations.length, conflictCount + 1)
    for (const attempt of harness.state().operations) {
      assert.deepEqual(attempt, [
        'file.find',
        'legal.findMany',
        'consent.find',
        'task.create',
      ])
    }
    assert.equal(harness.state().tasks.length, 1)
    assert.equal(harness.state().createCalls, conflictCount + 1)
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
  assert.equal(harness.state().operations.length, 3)
  assert.equal(harness.state().createCalls, 3)
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
  assert.equal(harness.state().createCalls, 1)
  assert.equal(harness.state().tasks.length, 0)
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
