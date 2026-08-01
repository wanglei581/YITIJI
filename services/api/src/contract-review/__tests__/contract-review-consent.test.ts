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
import { LegalService, LEGAL_DOC_TYPES } from '../../legal/legal.service'
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

function makePrivacyHarness(
  initialConsents: ConsentRecord[] = [],
  initialTasks: ContractTaskRecord[] = [],
  options: PrivacyHarnessOptions = {}
) {
  let consents = initialConsents.map(cloneConsent)
  let tasks = initialTasks.map(cloneTask)
  let sequence = 0
  let transactionCalls = 0
  const createData: Array<Record<string, unknown>> = []
  const findFirstWhere: Array<Record<string, unknown>> = []
  const consentUpdateWhere: Array<Record<string, unknown>> = []
  const contractTaskUpdateWhere: Array<Record<string, unknown>> = []
  const transactionOperations: string[] = []

  function consentDelegate(target: ConsentRecord[], inTransaction: boolean) {
    return {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        findFirstWhere.push(where)
        const matches = target
          .filter((record) =>
            Object.entries(where).every(([key, value]) => {
              if (key === 'revokedAt') return record.revokedAt === value
              return record[key as keyof ConsentRecord] === value
            })
          )
          .sort((left, right) => right.grantedAt.getTime() - left.grantedAt.getTime())
        const row = matches[0]
        return row ? cloneConsent(row) : null
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
      consents = transactionConsents
      tasks = transactionTasks
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
      findFirstWhere: [...findFirstWhere],
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
  revokedAt: Date | null = null
): ConsentRecord {
  return {
    id,
    endUserId: 'member-1',
    scope,
    consentVersion,
    terminalId: null,
    grantedAt: new Date('2026-08-01T00:00:00.000Z'),
    revokedAt,
  }
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
      .findFirstWhere.slice(-2)
      .map(({ scope, consentVersion, revokedAt }) => ({
        scope,
        consentVersion,
        revokedAt,
      })),
    [
      { scope: 'job_ai', consentVersion: CURRENT_JOB_AI_CONSENT_VERSION, revokedAt: null },
      { scope: 'contract_review', consentVersion: CONTRACT_VERSION, revokedAt: null },
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
