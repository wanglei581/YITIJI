import 'reflect-metadata'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { LegalService, LEGAL_DOC_TYPES } from '../../legal/legal.service'
import { MemberPrivacyController } from '../../member-privacy/member-privacy.controller'
import {
  CONSENT_VERSION_BY_SCOPE,
  CURRENT_JOB_AI_CONSENT_VERSION,
  MemberPrivacyService,
  consentVersionForScope,
} from '../../member-privacy/member-privacy.service'
import type { MemberAiConsentScope } from '../../member-privacy/member-privacy.types'

const CONTRACT_VERSION = 'contract-review-consent-v1'
const repoRoot = resolve(__dirname, '../../../../..')
const PROCESSING_STATUSES = [
  'uploaded',
  'queued',
  'extracting',
  'awaiting_confirmation',
  'rule_checking',
  'ai_analyzing',
  'safety_reviewing',
] as const
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'expired'] as const

interface ConsentRecord {
  id: string
  endUserId: string
  scope: string
  consentVersion: string
  terminalId: string | null
  grantedAt: Date
  revokedAt: Date | null
}

interface ContractTaskRecord {
  id: string
  endUserId: string | null
  status: string
}

interface PrivacyHarnessOptions {
  failContractTaskUpdate?: boolean
  beforeContractTaskUpdate?: (tasks: ContractTaskRecord[]) => void
}

interface ConsentFindFirstArgs {
  where: Record<string, unknown>
  orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>
  select?: Record<string, boolean>
}

function cloneConsent(record: ConsentRecord): ConsentRecord {
  return {
    ...record,
    grantedAt: new Date(record.grantedAt),
    revokedAt: record.revokedAt ? new Date(record.revokedAt) : null,
  }
}

function cloneTask(record: ContractTaskRecord): ContractTaskRecord {
  return { ...record }
}

function compareConsentValues(left: unknown, right: unknown): number {
  const normalizedLeft = left instanceof Date ? left.getTime() : left
  const normalizedRight = right instanceof Date ? right.getTime() : right
  if (normalizedLeft === normalizedRight) return 0
  if (typeof normalizedLeft === 'number' && typeof normalizedRight === 'number') {
    return normalizedLeft < normalizedRight ? -1 : 1
  }
  return String(normalizedLeft).localeCompare(String(normalizedRight))
}

function compareConsents(
  left: ConsentRecord,
  right: ConsentRecord,
  orderBy: ConsentFindFirstArgs['orderBy']
): number {
  const clauses = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []
  for (const clause of clauses) {
    for (const [field, direction] of Object.entries(clause)) {
      const comparison = compareConsentValues(
        left[field as keyof ConsentRecord],
        right[field as keyof ConsentRecord]
      )
      if (comparison !== 0) return direction === 'desc' ? -comparison : comparison
    }
  }
  return 0
}

function selectConsent(record: ConsentRecord, select?: Record<string, boolean>): unknown {
  const cloned = cloneConsent(record)
  if (!select) return cloned
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, included]) => included)
      .map(([field]) => [field, cloned[field as keyof ConsentRecord]])
  )
}

function makePrivacyHarness(
  initialConsents: ConsentRecord[] = [],
  initialTasks: ContractTaskRecord[] = [],
  options: PrivacyHarnessOptions = {}
) {
  const consents = initialConsents.map(cloneConsent)
  const tasks = initialTasks.map(cloneTask)
  let sequence = 0
  let transactionCalls = 0
  const createData: Array<Record<string, unknown>> = []
  const consentUpdateWhere: Array<Record<string, unknown>> = []
  const contractTaskUpdateWhere: Array<Record<string, unknown>> = []
  const transactionOperations: string[] = []
  const findFirstCalls: ConsentFindFirstArgs[] = []

  function consentDelegate(target: ConsentRecord[], inTransaction: boolean) {
    return {
      findFirst: async (args: ConsentFindFirstArgs) => {
        const { where, orderBy, select } = args
        findFirstCalls.push(args)
        const matches = target
          .filter((record) =>
            Object.entries(where).every(([key, value]) => {
              if (key === 'revokedAt') return record.revokedAt === value
              return record[key as keyof ConsentRecord] === value
            })
          )
          .sort((left, right) => compareConsents(left, right, orderBy))
        const row = matches[0]
        return row ? selectConsent(row, select) : null
      },
      create: async ({ data }: { data: Omit<ConsentRecord, 'id' | 'grantedAt' | 'revokedAt'> }) => {
        createData.push(data)
        const row: ConsentRecord = {
          ...data,
          id: `consent-${++sequence}`,
          grantedAt: new Date(`2026-08-01T00:00:0${sequence}.000Z`),
          revokedAt: null,
        }
        target.push(row)
        return cloneConsent(row)
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>
        data: { revokedAt: Date }
      }) => {
        consentUpdateWhere.push(where)
        if (inTransaction) transactionOperations.push('consent')
        let count = 0
        for (const record of target) {
          if (
            record.endUserId === where.endUserId &&
            record.scope === where.scope &&
            record.revokedAt === where.revokedAt
          ) {
            record.revokedAt = data.revokedAt
            count += 1
          }
        }
        return { count }
      },
    }
  }

  function contractTaskDelegate(target: ContractTaskRecord[]) {
    return {
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>
        data: { status: string }
      }) => {
        contractTaskUpdateWhere.push(where)
        transactionOperations.push('tasks')
        options.beforeContractTaskUpdate?.(target)
        if (options.failContractTaskUpdate) {
          throw new Error(
            'database failed while handling secret contract clause and internal row 42'
          )
        }
        const statusFilter = where.status as { in: string[] }
        let count = 0
        for (const task of target) {
          if (task.endUserId === where.endUserId && statusFilter.in.includes(task.status)) {
            task.status = data.status
            count += 1
          }
        }
        return { count }
      },
    }
  }

  const prisma = {
    userAiConsent: consentDelegate(consents, false),
    contractReviewTask: contractTaskDelegate(tasks),
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      transactionCalls += 1
      const transactionConsents = consents.map(cloneConsent)
      const transactionTasks = tasks.map(cloneTask)
      const result = await operation({
        userAiConsent: consentDelegate(transactionConsents, true),
        contractReviewTask: contractTaskDelegate(transactionTasks),
      })
      consents.splice(0, consents.length, ...transactionConsents)
      tasks.splice(0, tasks.length, ...transactionTasks)
      return result
    },
  }

  return {
    service: new MemberPrivacyService(prisma as never),
    state: () => ({
      consents: consents.map(cloneConsent),
      tasks: tasks.map(cloneTask),
      transactionCalls,
      createData: [...createData],
      findFirstCalls: [...findFirstCalls],
      consentUpdateWhere: [...consentUpdateWhere],
      contractTaskUpdateWhere: [...contractTaskUpdateWhere],
      transactionOperations: [...transactionOperations],
    }),
  }
}

function consent(
  id: string,
  scope: MemberAiConsentScope,
  consentVersion: string,
  revokedAt: Date | null = null,
  grantedAt = new Date('2026-08-01T00:00:00.000Z')
): ConsentRecord {
  return {
    id,
    endUserId: 'member-1',
    scope,
    consentVersion,
    terminalId: null,
    grantedAt,
    revokedAt,
  }
}

function contractStatus(statuses: Awaited<ReturnType<MemberPrivacyService['getConsentStatus']>>) {
  const status = statuses.find((item) => item.scope === 'contract_review')
  assert.ok(status)
  return status
}

function isInvalidScopeError(error: unknown): boolean {
  assert.ok(error instanceof BadRequestException)
  assert.deepEqual(error.getResponse(), {
    error: { code: 'INVALID_AI_CONSENT_SCOPE', message: 'AI 授权范围不支持' },
  })
  return true
}

async function expectConsentRequired(operation: () => Promise<unknown>): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof ForbiddenException)
    assert.match(JSON.stringify(error.getResponse()), /USER_AI_CONSENT_REQUIRED/)
    return true
  })
}

test('contract review has an isolated consent version in API and shared contracts', () => {
  const sharedPrivacyTypes = readFileSync(
    resolve(repoRoot, 'packages/shared/src/types/member-privacy.ts'),
    'utf8'
  )

  assert.deepEqual(CONSENT_VERSION_BY_SCOPE, {
    job_ai: CURRENT_JOB_AI_CONSENT_VERSION,
    contract_review: CONTRACT_VERSION,
  })
  assert.match(
    sharedPrivacyTypes,
    /export type MemberAiConsentScope = 'job_ai' \| 'contract_review'/
  )
  assert.match(sharedPrivacyTypes, /export interface MemberAiConsentStatus/)
  assert.equal(consentVersionForScope('contract_review'), CONTRACT_VERSION)
  assert.notEqual(consentVersionForScope('contract_review'), consentVersionForScope('job_ai'))
})

test('GrantAiConsentDto accepts only job_ai and contract_review at runtime', async () => {
  const parameterTypes = Reflect.getMetadata(
    'design:paramtypes',
    MemberPrivacyController.prototype,
    'grantConsent'
  ) as Array<new () => object>
  const GrantAiConsentDto = parameterTypes[1]
  assert.ok(GrantAiConsentDto, 'grantConsent body DTO metadata must exist')

  for (const scope of ['job_ai', 'contract_review']) {
    const errors = await validate(plainToInstance(GrantAiConsentDto, { scope }))
    assert.equal(errors.length, 0, `${scope} must remain accepted by the HTTP DTO`)
  }

  for (const scope of ['unknown_scope', undefined]) {
    const errors = await validate(plainToInstance(GrantAiConsentDto, { scope }))
    assert.equal(errors.length, 1)
    assert.ok(errors[0]?.constraints?.isIn)
  }
})

test('getConsentStatus returns independent job and contract review status entries', async () => {
  const revokedAt = new Date('2026-08-01T01:00:00.000Z')
  const harness = makePrivacyHarness([
    consent('job-active', 'job_ai', CURRENT_JOB_AI_CONSENT_VERSION),
    consent('contract-revoked', 'contract_review', CONTRACT_VERSION, revokedAt),
  ])

  const statuses = await harness.service.getConsentStatus('member-1')

  assert.deepEqual(
    statuses.map(({ scope, consentVersion, granted, revokedAt: revoked }) => ({
      scope,
      consentVersion,
      granted,
      revokedAt: revoked,
    })),
    [
      {
        scope: 'job_ai',
        consentVersion: CURRENT_JOB_AI_CONSENT_VERSION,
        granted: true,
        revokedAt: null,
      },
      {
        scope: 'contract_review',
        consentVersion: CONTRACT_VERSION,
        granted: false,
        revokedAt: revokedAt.toISOString(),
      },
    ]
  )
})

test('grantConsent and requireActiveConsent use the selected scope version', async () => {
  const harness = makePrivacyHarness()

  await harness.service.grantConsent('member-1', 'job_ai', 'terminal-1')
  await harness.service.grantConsent('member-1', 'contract_review', null)
  await harness.service.requireActiveConsent('member-1', 'job_ai')
  await harness.service.requireActiveConsent('member-1', 'contract_review')

  assert.deepEqual(
    harness.state().createData.map(({ scope, consentVersion }) => ({ scope, consentVersion })),
    [
      { scope: 'job_ai', consentVersion: CURRENT_JOB_AI_CONSENT_VERSION },
      { scope: 'contract_review', consentVersion: CONTRACT_VERSION },
    ]
  )
  assert.deepEqual(
    harness
      .state()
      .findFirstCalls.slice(-2)
      .map(({ where, orderBy, select }) => ({ where, orderBy, select })),
    [
      {
        where: { endUserId: 'member-1', scope: 'job_ai' },
        orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, consentVersion: true, grantedAt: true, revokedAt: true },
      },
      {
        where: { endUserId: 'member-1', scope: 'contract_review' },
        orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, consentVersion: true, grantedAt: true, revokedAt: true },
      },
    ]
  )
})

test('invalid runtime scopes fail closed without exposing internal data', async () => {
  const harness = makePrivacyHarness()
  const invalidScope = 'secret-contract-clause' as MemberAiConsentScope

  assert.throws(() => consentVersionForScope(invalidScope), BadRequestException)
  await assert.rejects(
    harness.service.grantConsent('member-1', invalidScope, null),
    BadRequestException
  )
  await assert.rejects(
    harness.service.requireActiveConsent('member-1', invalidScope),
    BadRequestException
  )
  await assert.rejects(harness.service.revokeConsent('member-1', invalidScope), BadRequestException)
  assert.deepEqual(harness.state().createData, [])
})

test('prototype and unknown scope keys fail closed before every Prisma path', async () => {
  const harness = makePrivacyHarness()
  const controller = new MemberPrivacyController(harness.service)
  const invalidScopes = ['toString', '__proto__', 'constructor', 'hasOwnProperty', 'unknown_scope']

  for (const rawScope of invalidScopes) {
    const scope = rawScope as MemberAiConsentScope
    assert.throws(() => consentVersionForScope(scope), isInvalidScopeError)
    await assert.rejects(harness.service.grantConsent('member-1', scope, null), isInvalidScopeError)
    await assert.rejects(
      harness.service.requireActiveConsent('member-1', scope),
      isInvalidScopeError
    )
    await assert.rejects(harness.service.revokeConsent('member-1', scope), isInvalidScopeError)
    await assert.rejects(
      controller.revokeConsent({ endUserId: 'member-1' } as never, scope),
      isInvalidScopeError
    )
  }

  const state = harness.state()
  assert.deepEqual(state.createData, [])
  assert.deepEqual(state.findFirstCalls, [])
  assert.deepEqual(state.consentUpdateWhere, [])
  assert.deepEqual(state.contractTaskUpdateWhere, [])
  assert.equal(state.transactionCalls, 0)
})

test('latest old-version event makes status false and require deny', async () => {
  const harness = makePrivacyHarness([
    consent(
      'current-older',
      'contract_review',
      CONTRACT_VERSION,
      null,
      new Date('2026-08-01T00:00:00.000Z')
    ),
    consent(
      'old-newer',
      'contract_review',
      'contract-review-consent-v0',
      null,
      new Date('2026-08-01T00:01:00.000Z')
    ),
  ])

  assert.equal(contractStatus(await harness.service.getConsentStatus('member-1')).granted, false)
  await expectConsentRequired(() =>
    harness.service.requireActiveConsent('member-1', 'contract_review')
  )
})

test('latest current-version event makes status and require allow', async () => {
  const harness = makePrivacyHarness([
    consent(
      'old-older',
      'contract_review',
      'contract-review-consent-v0',
      null,
      new Date('2026-08-01T00:00:00.000Z')
    ),
    consent(
      'current-newer',
      'contract_review',
      CONTRACT_VERSION,
      null,
      new Date('2026-08-01T00:01:00.000Z')
    ),
  ])

  assert.equal(contractStatus(await harness.service.getConsentStatus('member-1')).granted, true)
  await assert.doesNotReject(() =>
    harness.service.requireActiveConsent('member-1', 'contract_review')
  )
})

test('latest revoked current event overrides an earlier active current event', async () => {
  const harness = makePrivacyHarness([
    consent(
      'active-older',
      'contract_review',
      CONTRACT_VERSION,
      null,
      new Date('2026-08-01T00:00:00.000Z')
    ),
    consent(
      'revoked-newer',
      'contract_review',
      CONTRACT_VERSION,
      new Date('2026-08-01T00:02:00.000Z'),
      new Date('2026-08-01T00:01:00.000Z')
    ),
  ])

  assert.equal(contractStatus(await harness.service.getConsentStatus('member-1')).granted, false)
  await expectConsentRequired(() =>
    harness.service.requireActiveConsent('member-1', 'contract_review')
  )
})

test('same grantedAt uses id desc as the latest-event tie-break for status and require', async () => {
  const grantedAt = new Date('2026-08-01T00:00:00.000Z')
  const harness = makePrivacyHarness([
    consent('event-a-active', 'contract_review', CONTRACT_VERSION, null, grantedAt),
    consent(
      'event-z-revoked',
      'contract_review',
      CONTRACT_VERSION,
      new Date('2026-08-01T00:02:00.000Z'),
      grantedAt
    ),
  ])

  assert.equal(contractStatus(await harness.service.getConsentStatus('member-1')).granted, false)
  await expectConsentRequired(() =>
    harness.service.requireActiveConsent('member-1', 'contract_review')
  )
  const contractCalls = harness
    .state()
    .findFirstCalls.filter((call) => call.where.scope === 'contract_review')
  for (const call of contractCalls) {
    assert.deepEqual(call.orderBy, [{ grantedAt: 'desc' }, { id: 'desc' }])
    assert.deepEqual(call.select, {
      id: true,
      consentVersion: true,
      grantedAt: true,
      revokedAt: true,
    })
  }
})

/**
 * Task 6 create must place its final consent check and task creation in one transaction or
 * authorization-generation protocol. These unit tests do not claim that cross-request linearization;
 * the real PostgreSQL two-connection race remains a Task 14 integration gate.
 */
test('repeated grant appends events and the deterministic latest event wins', async () => {
  const harness = makePrivacyHarness()

  await harness.service.grantConsent('member-1', 'contract_review', 'terminal-1')
  await harness.service.grantConsent('member-1', 'contract_review', 'terminal-2')

  const state = harness.state()
  assert.equal(state.createData.length, 2)
  assert.equal(state.consents.length, 2)
  assert.deepEqual(
    state.consents.map(({ id, terminalId, revokedAt }) => ({ id, terminalId, revokedAt })),
    [
      { id: 'consent-1', terminalId: 'terminal-1', revokedAt: null },
      { id: 'consent-2', terminalId: 'terminal-2', revokedAt: null },
    ]
  )
  const latest = contractStatus(await harness.service.getConsentStatus('member-1'))
  assert.equal(latest.granted, true)
  assert.equal(latest.grantedAt, state.consents[1]?.grantedAt.toISOString())
  await assert.doesNotReject(() =>
    harness.service.requireActiveConsent('member-1', 'contract_review')
  )
})

test('grant after revoke appends a new latest active event', async () => {
  const harness = makePrivacyHarness()

  await harness.service.grantConsent('member-1', 'contract_review', 'terminal-1')
  await harness.service.revokeConsent('member-1', 'contract_review')
  await harness.service.grantConsent('member-1', 'contract_review', 'terminal-2')

  const state = harness.state()
  assert.equal(state.consents.length, 2)
  assert.ok(state.consents[0]?.revokedAt)
  assert.equal(state.consents[1]?.revokedAt, null)
  assert.equal(contractStatus(await harness.service.getConsentStatus('member-1')).granted, true)
  await assert.doesNotReject(() =>
    harness.service.requireActiveConsent('member-1', 'contract_review')
  )
})

test('missing contract review consent uses a safe scope-specific error', async () => {
  const harness = makePrivacyHarness()

  await assert.rejects(
    harness.service.requireActiveConsent('member-1', 'contract_review'),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException)
      const response = JSON.stringify(error.getResponse())
      assert.match(response, /USER_AI_CONSENT_REQUIRED/)
      assert.doesNotMatch(response, /contract clause|internal row|secret/i)
      return true
    }
  )
})

test('contract review revoke atomically cancels exactly the processing status set', async () => {
  const tasks: ContractTaskRecord[] = [
    ...PROCESSING_STATUSES.map((status) => ({
      id: `processing-${status}`,
      endUserId: 'member-1',
      status,
    })),
    ...TERMINAL_STATUSES.map((status) => ({
      id: `terminal-${status}`,
      endUserId: 'member-1',
      status,
    })),
    { id: 'other-member', endUserId: 'member-2', status: 'queued' },
  ]
  const harness = makePrivacyHarness(
    [
      consent('job-active', 'job_ai', CURRENT_JOB_AI_CONSENT_VERSION),
      consent('contract-active', 'contract_review', CONTRACT_VERSION),
    ],
    tasks
  )

  const result = await harness.service.revokeConsent('member-1', 'contract_review')
  const state = harness.state()

  assert.deepEqual(result, { revoked: true, count: 1 })
  assert.equal(state.transactionCalls, 1)
  assert.deepEqual(state.transactionOperations, ['consent', 'tasks'])
  assert.deepEqual(state.contractTaskUpdateWhere, [
    { endUserId: 'member-1', status: { in: [...PROCESSING_STATUSES] } },
  ])
  assert.equal(state.consents.find((row) => row.scope === 'job_ai')?.revokedAt, null)
  assert.ok(state.consents.find((row) => row.scope === 'contract_review')?.revokedAt)
  for (const status of PROCESSING_STATUSES) {
    assert.equal(
      state.tasks.find((task) => task.id === `processing-${status}`)?.status,
      'cancelled'
    )
  }
  for (const status of TERMINAL_STATUSES) {
    assert.equal(state.tasks.find((task) => task.id === `terminal-${status}`)?.status, status)
  }
  assert.equal(state.tasks.find((task) => task.id === 'other-member')?.status, 'queued')
})

test('contract review revoke CAS does not move a concurrently completed task backwards', async () => {
  const harness = makePrivacyHarness(
    [consent('contract-active', 'contract_review', CONTRACT_VERSION)],
    [{ id: 'racing-task', endUserId: 'member-1', status: 'queued' }],
    {
      beforeContractTaskUpdate: (tasks) => {
        const racingTask = tasks.find((task) => task.id === 'racing-task')
        if (racingTask) racingTask.status = 'completed'
      },
    }
  )

  await harness.service.revokeConsent('member-1', 'contract_review')

  assert.equal(harness.state().tasks[0]?.status, 'completed')
})

test('contract review revoke rolls back consent and task changes when the transaction fails', async () => {
  const harness = makePrivacyHarness(
    [consent('contract-active', 'contract_review', CONTRACT_VERSION)],
    [{ id: 'queued-task', endUserId: 'member-1', status: 'queued' }],
    { failContractTaskUpdate: true }
  )

  await assert.rejects(
    harness.service.revokeConsent('member-1', 'contract_review'),
    (error: unknown) => {
      assert.ok(error instanceof InternalServerErrorException)
      const response = JSON.stringify(error.getResponse())
      assert.match(response, /CONTRACT_REVIEW_CONSENT_REVOKE_FAILED/)
      assert.doesNotMatch(response, /secret contract clause|internal row 42|database failed/i)
      return true
    }
  )
  assert.equal(harness.state().consents[0]?.revokedAt, null)
  assert.equal(harness.state().tasks[0]?.status, 'queued')
})

test('job_ai revoke preserves its direct update behavior and does not cancel contract tasks', async () => {
  const harness = makePrivacyHarness(
    [
      consent('job-active', 'job_ai', CURRENT_JOB_AI_CONSENT_VERSION),
      consent('contract-active', 'contract_review', CONTRACT_VERSION),
    ],
    [{ id: 'queued-task', endUserId: 'member-1', status: 'queued' }]
  )

  const result = await harness.service.revokeConsent('member-1', 'job_ai')

  assert.deepEqual(result, { revoked: true, count: 1 })
  assert.equal(harness.state().transactionCalls, 0)
  assert.ok(harness.state().consents.find((row) => row.scope === 'job_ai')?.revokedAt)
  assert.equal(
    harness.state().consents.find((row) => row.scope === 'contract_review')?.revokedAt,
    null
  )
  assert.equal(harness.state().tasks[0]?.status, 'queued')
})

test('contract review disclaimer is recognized but newly created documents remain inactive', async () => {
  const sharedDocType = 'contract_review_disclaimer' as const
  const sharedLegalTypes = readFileSync(
    resolve(repoRoot, 'packages/shared/src/types/legalDocs.ts'),
    'utf8'
  )
  const createCalls: Array<Record<string, unknown>> = []
  const prisma = {
    legalDocVersion: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createCalls.push(data)
        return { id: 'doc-1', ...data, createdAt: new Date('2026-08-01T00:00:00.000Z') }
      },
      findFirst: async () => null,
    },
  }
  const service = new LegalService(prisma as never)

  assert.match(sharedLegalTypes, /'contract_review_disclaimer'/)
  assert.ok(LEGAL_DOC_TYPES.includes('contract_review_disclaimer'))
  const created = await service.create({
    docType: sharedDocType,
    version: 'contract-review-disclaimer-v1',
    title: '合同审查免责声明',
    content: '草稿文案',
    adminId: 'admin-1',
  })

  assert.equal(created.isActive, false)
  assert.equal(createCalls[0]?.isActive, false)
  assert.equal(await service.getActive('contract_review_disclaimer'), null)
  assert.equal(createCalls.length, 1, 'recognition must not create or activate a default document')
})
