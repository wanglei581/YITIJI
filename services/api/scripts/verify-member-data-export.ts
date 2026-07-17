/**
 * Wave 1-B 会员数据导出运行时门禁。
 *
 * 使用带双用户真实数据形状的内存 Prisma delegate 验证 mapper 白名单与归属，
 * 并用可观测 CAS/FileService 边界验证限额、幂等、租约及 orphan 补偿。
 */
import assert from 'node:assert/strict'
import type { Job } from 'bullmq'
import {
  MEMBER_EXPORT_MAX_BYTES,
  MemberDataExportService,
} from '../src/member-privacy/member-data-export.service'
import {
  MEMBER_EXPORT_SCHEMA_VERSION,
  MEMBER_EXPORT_SECTION_ROW_LIMIT,
  MemberDataExportMapper,
} from '../src/member-privacy/member-data-export.mapper'
import { MemberPrivacyProcessor } from '../src/member-privacy/member-privacy.processor'
import { MEMBER_EXPORT_JOB } from '../src/member-privacy/member-privacy.queue'

const FORBIDDEN_KEYS = /phoneEnc|phoneHash|contactPhoneEnc|storageKey|objectKey|\bbucket\b|\bregion\b|sha256|accessToken|verificationCode|payloadJson|itemsJson|turnContent|transcript|auditRef|prompt|output/i
const PHONE_LIKE = /1[3-9]\d{9}/

type WalkVisitor = (key: string, value: unknown) => void

export function walkExport(value: unknown, visitor: WalkVisitor, key = '$'): void {
  visitor(key, value)
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkExport(item, visitor, `${key}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    visitor(childKey, childValue)
    walkExport(childValue, visitor, childKey)
  }
}

export function assertNoSensitiveExportData(exported: unknown): void {
  walkExport(exported, (key, value) => {
    assert.doesNotMatch(key, FORBIDDEN_KEYS, `导出包包含禁止字段: ${key}`)
    if (typeof value === 'string') assert.doesNotMatch(value, PHONE_LIKE, '导出包包含疑似明文手机号')
  })
}

interface QueryCall {
  model: string
  where: Record<string, unknown>
  select: Record<string, unknown>
}

type FixtureRow = Record<string, unknown> & { id: string; endUserId?: string }
type FixtureStore = Record<string, FixtureRow[]>

const COLLECTION_MODELS = [
  'fileObject',
  'aiResumeResult',
  'jobAiSession',
  'mockInterviewSession',
  'order',
  'favorite',
  'benefitGrant',
  'browseLog',
  'externalJumpLog',
  'memberNotification',
  'feedbackTicket',
  'userAiConsent',
  'userDataRequest',
] as const

function date(day: number): Date {
  return new Date(`2026-07-${String(day).padStart(2, '0')}T00:00:00.000Z`)
}

function dualUserFixtures(): FixtureStore {
  const base = (id: string, endUserId: string): FixtureRow => ({ id, endUserId, createdAt: date(1) })
  return {
    endUser: [
      { id: 'member-one', nickname: '目标会员', status: 'active', createdAt: date(1), lastLoginAt: date(2), phoneEnc: 'enc-secret', phoneHash: 'hash-secret' },
      { id: 'member-two', nickname: 'OTHER_MEMBER_SECRET', status: 'active', createdAt: date(1), lastLoginAt: null, phoneEnc: 'enc-other', phoneHash: 'hash-other' },
    ],
    fileObject: [
      { ...base('file-one', 'member-one'), filename: '目标简历.pdf', mimeType: 'application/pdf', sizeBytes: 100, purpose: 'resume_upload', assetCategory: 'original', status: 'active', expiresAt: date(20), deletedAt: null, storageKey: 'private/key', bucket: 'secret', region: 'secret', sha256: 'secret' },
      { ...base('file-two', 'member-two'), filename: 'OTHER_MEMBER_SECRET.pdf', mimeType: 'application/pdf', sizeBytes: 200, purpose: 'resume_upload', assetCategory: 'original', status: 'active', expiresAt: date(20), deletedAt: null },
    ],
    aiResumeResult: [
      { ...base('resume-one', 'member-one'), taskId: 'task-one', kind: 'parse', status: 'completed', provider: 'provider', updatedAt: date(2), expiresAt: date(20), payloadJson: '{"secret":true}', output: 'secret' },
      { ...base('resume-two', 'member-two'), taskId: 'OTHER_MEMBER_SECRET', kind: 'parse', status: 'completed', provider: 'provider', updatedAt: date(2), expiresAt: date(20) },
    ],
    jobAiSession: [],
    mockInterviewSession: [],
    order: [
      { ...base('order-one', 'member-one'), orderNo: 'ORDER-ONE', type: 'print', amountCents: 100, currency: 'CNY', payStatus: 'paid', taskStatus: 'completed', paymentSource: 'offline', paidAt: date(2), payChannel: null, discountCents: 0, refundedAmountCents: 0, refundedAt: null, itemsJson: '["secret"]' },
    ],
    favorite: [
      { ...base('favorite-one', 'member-one'), targetType: 'job', targetId: 'job-one', title: '目标收藏' },
      { ...base('favorite-two', 'member-two'), targetType: 'job', targetId: 'job-two', title: 'OTHER_MEMBER_SECRET' },
    ],
    benefitGrant: [],
    browseLog: [],
    externalJumpLog: [],
    memberNotification: [
      { ...base('notice-one', 'member-one'), title: '通知', content: '导出已受理，旧联系方式 13900000000', category: 'system', relatedType: null, isRead: false, readAt: null, deletedAt: null },
    ],
    feedbackTicket: [
      { ...base('feedback-one', 'member-one'), category: 'general', title: '建议', content: '目标反馈', status: 'pending', updatedAt: date(2), contactPhoneEnc: 'secret' },
      { ...base('feedback-two', 'member-two'), category: 'general', title: 'OTHER_MEMBER_SECRET', content: 'OTHER_MEMBER_SECRET', status: 'pending', updatedAt: date(2) },
    ],
    userAiConsent: [],
    userDataRequest: [
      { ...base('request-one', 'member-one'), requestType: 'export', status: 'pending', executionStep: null, exportExpiresAt: null, downloadConsumedAt: null, failureCode: null, requestedAt: date(3), handledAt: null, auditRef: 'secret' },
    ],
  }
}

function project(row: FixtureRow, select: Record<string, unknown>): FixtureRow {
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, enabled]) => enabled === true)
      .map(([key]) => [key, row[key]]),
  ) as FixtureRow
}

function mapperHarness(store = dualUserFixtures()): { mapper: MemberDataExportMapper; calls: QueryCall[] } {
  const calls: QueryCall[] = []
  const prisma: Record<string, unknown> = {
    endUser: {
      findUnique: async (args: { where: { id: string }; select: Record<string, unknown> }) => {
        calls.push({ model: 'endUser', where: args.where, select: args.select })
        const row = store['endUser']?.find((candidate) => candidate.id === args.where.id)
        return row ? project(row, args.select) : null
      },
    },
  }
  for (const model of COLLECTION_MODELS) {
    prisma[model] = {
      findMany: async (args: { where: { endUserId: string }; select: Record<string, unknown>; take: number }) => {
        calls.push({ model, where: args.where, select: args.select })
        return (store[model] ?? [])
          .filter((row) => row.endUserId === args.where.endUserId)
          .slice(0, args.take)
          .map((row) => project(row, args.select))
      },
    }
  }
  return { mapper: new MemberDataExportMapper(prisma as never), calls }
}

interface RequestRow {
  id: string
  endUserId: string
  requestType: 'export'
  status: string
  executionVersion: number
  executionStep: string | null
  exportFileId: string | null
  exportExpiresAt: Date | null
  lastAttemptAt: Date | null
  failureCode: string | null
  failureMessage: string | null
  auditRef: string | null
}

interface ServiceHarnessOptions {
  status?: string
  lastAttemptAt?: Date | null
  envelope?: unknown
  failReadyCas?: boolean
  failCleanup?: boolean
  failReadyAudit?: boolean
  conflictStatusOnReadyCas?: string
  readyAvailability?: 'available' | 'missing_tracked' | 'missing_untracked'
}

function serviceHarness(options: ServiceHarnessOptions = {}) {
  let row: RequestRow = {
    id: 'request-one',
    endUserId: 'member-one',
    requestType: 'export',
    status: options.status ?? 'pending',
    executionVersion: 0,
    executionStep: null,
    exportFileId: null,
    exportExpiresAt: null,
    lastAttemptAt: options.lastAttemptAt ?? null,
    failureCode: null,
    failureMessage: null,
    auditRef: null,
  }
  let creates = 0
  const deleted: string[] = []
  let mapperBuilds = 0
  let requiredAudits = 0

  const matches = (where: Record<string, unknown>): boolean => Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') return (expected as Record<string, unknown>[]).some(matches)
    const actual = row[key as keyof RequestRow]
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const operation = expected as { in?: unknown[]; lte?: Date }
      if (operation.in) return operation.in.includes(actual)
      if (operation.lte) return actual instanceof Date && actual <= operation.lte
    }
    return actual === expected
  })

  const requestDelegate = {
    findUnique: async () => ({ ...row }),
    updateMany: async (args: { where: Record<string, unknown>; data: Partial<RequestRow> }) => {
      if (!matches(args.where)) return { count: 0 }
      if (options.failReadyCas && args.data.status === 'ready') {
        if (options.conflictStatusOnReadyCas) row = { ...row, status: options.conflictStatusOnReadyCas }
        return { count: 0 }
      }
      row = { ...row, ...args.data }
      return { count: 1 }
    },
    update: async (args: { data: Partial<RequestRow> }) => {
      row = { ...row, ...args.data }
      return { ...row }
    },
  }
  const prisma = {
    userDataRequest: requestDelegate,
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      const snapshot = { ...row }
      try {
        return await operation({ userDataRequest: requestDelegate, auditLog: {} })
      } catch (error) {
        row = snapshot
        throw error
      }
    },
  }
  const mapper = {
    build: async () => {
      mapperBuilds += 1
      return options.envelope ?? {
        schemaVersion: MEMBER_EXPORT_SCHEMA_VERSION,
        generatedAt: date(17).toISOString(),
        requestId: row.id,
        sections: { account: { id: row.endUserId } },
      }
    },
  }
  const exportFiles = {
    inspect: async () => {
      if (options.readyAvailability === 'missing_tracked') return { status: 'missing' as const, tracked: true }
      if (options.readyAvailability === 'missing_untracked') return { status: 'missing' as const, tracked: false }
      return { status: 'available' as const, tracked: true }
    },
    create: async ({ buffer }: { buffer: Buffer }) => {
      creates += 1
      return {
        fileId: `export-file-${creates}`,
        filename: 'member-data-export.json',
        mimeType: 'application/json' as const,
        sizeBytes: buffer.length,
        sha256: 'test-only',
        fileExpiresAt: date(18).toISOString(),
      }
    },
  }
  const files = {
    systemDelete: async (fileId: string) => {
      deleted.push(fileId)
      if (options.failCleanup) throw new Error('cleanup failed')
      return {}
    },
  }
  const audit = {
    writeRequired: async (_tx: unknown, args: { action: string }) => {
      requiredAudits += 1
      if (options.failReadyAudit && args.action === 'member_data_export.ready') throw new Error('audit failed')
      return `audit-${requiredAudits}`
    },
  }
  const service = new MemberDataExportService(
    prisma as never,
    mapper as never,
    exportFiles as never,
    files as never,
    audit as never,
  )
  return {
    service,
    row: () => row,
    creates: () => creates,
    deleted,
    mapperBuilds: () => mapperBuilds,
    requiredAudits: () => requiredAudits,
  }
}

function errorCode(error: unknown): string | undefined {
  const candidate = error as { code?: string; getResponse?: () => unknown }
  if (candidate?.code) return candidate.code
  const response = candidate?.getResponse?.() as { error?: { code?: string } } | undefined
  return response?.error?.code
}

async function expectCode(operation: () => Promise<unknown>, code: string): Promise<void> {
  let captured: unknown
  try {
    await operation()
  } catch (error) {
    captured = error
  }
  assert.ok(captured, `预期失败 ${code}`)
  assert.equal(errorCode(captured), code)
}

async function verifyDualUserIsolation(): Promise<void> {
  const { mapper, calls } = mapperHarness()
  const envelope = await mapper.build({ endUserId: 'member-one', requestId: 'request-one', generatedAt: date(17) })
  const serialized = JSON.stringify(envelope)
  assert.match(serialized, /目标会员/)
  assert.doesNotMatch(serialized, /member-two|OTHER_MEMBER_SECRET/)
  assert.deepEqual(envelope.sections.aiRecords.jobSessions, [])
  assert.deepEqual(envelope.sections.aiRecords.mockInterviews, [])
  assert.equal(calls.length, COLLECTION_MODELS.length + 1)
  for (const call of calls) {
    if (call.model === 'endUser') assert.equal(call.where['id'], 'member-one')
    else assert.equal(call.where['endUserId'], 'member-one', `${call.model} 未按 endUserId 查询`)
  }
}

async function verifyWhitelistEnvelope(): Promise<void> {
  const { mapper, calls } = mapperHarness()
  const envelope = await mapper.build({ endUserId: 'member-one', requestId: 'request-one', generatedAt: date(17) })
  assert.equal(envelope.schemaVersion, MEMBER_EXPORT_SCHEMA_VERSION)
  assert.equal(envelope.generatedAt, date(17).toISOString())
  assert.equal(envelope.requestId, 'request-one')
  assert.deepEqual(Object.keys(envelope.sections), [
    'account', 'files', 'aiRecords', 'printOrders', 'favorites', 'benefits',
    'activity', 'notifications', 'feedback', 'consents', 'requests',
  ])
  assertNoSensitiveExportData(envelope)
  for (const call of calls) {
    assert.ok(call.select && Object.keys(call.select).length > 0, `${call.model} 必须显式 select`)
    for (const key of Object.keys(call.select)) assert.doesNotMatch(key, FORBIDDEN_KEYS)
  }
}

async function verifyLimits(): Promise<void> {
  const store = dualUserFixtures()
  store['fileObject'] = Array.from({ length: MEMBER_EXPORT_SECTION_ROW_LIMIT + 1 }, (_, index) => ({
    id: `file-${index}`,
    endUserId: 'member-one',
    filename: `file-${index}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1,
    purpose: 'resume_upload',
    assetCategory: 'original',
    status: 'active',
    createdAt: date(1),
    expiresAt: null,
    deletedAt: null,
  }))
  const { mapper } = mapperHarness(store)
  await expectCode(
    () => mapper.build({ endUserId: 'member-one', requestId: 'request-one' }),
    'EXPORT_TOO_LARGE',
  )

  const huge = 'x'.repeat(MEMBER_EXPORT_MAX_BYTES + 1)
  const harness = serviceHarness({ envelope: { sections: { notifications: [{ content: huge }] } } })
  await expectCode(() => harness.service.execute('request-one', 0), 'EXPORT_TOO_LARGE')
  assert.equal(harness.creates(), 0, '字节超限不得上传部分 JSON')
  assert.equal(harness.row().status, 'failed')
  assert.equal(harness.row().failureCode, 'EXPORT_TOO_LARGE')
  assert.equal(harness.row().exportFileId, null)
}

async function verifyProcessorCasAndLease(): Promise<void> {
  const harness = serviceHarness()
  const processor = new MemberPrivacyProcessor(harness.service, undefined)
  const job = { name: MEMBER_EXPORT_JOB, data: { requestId: 'request-one', executionVersion: 0 } } as Job
  const first = await processor.process(job)
  const second = await processor.process(job)
  assert.equal((first as { status: string }).status, 'ready')
  assert.equal((second as { status: string }).status, 'noop')
  assert.equal(harness.creates(), 1, '重复执行不得生成第二个导出文件')
  assert.equal(harness.requiredAudits(), 1, 'ready CAS 必须在同一事务写 required audit')

  for (const status of ['ready', 'completed', 'expired', 'rejected', 'cancelled']) {
    const terminal = serviceHarness({ status })
    if (status === 'ready') {
      terminal.row().exportFileId = 'export-file-ready'
      terminal.row().exportExpiresAt = new Date(Date.now() + 60_000)
    }
    const result = await terminal.service.execute('request-one', 0)
    assert.equal(result.status, 'noop')
    assert.equal(terminal.creates(), 0)
  }

  const missingTracked = serviceHarness({ status: 'ready', readyAvailability: 'missing_tracked' })
  missingTracked.row().exportFileId = 'lost-export-file'
  missingTracked.row().exportExpiresAt = new Date(Date.now() + 60_000)
  await expectCode(() => missingTracked.service.execute('request-one', 0), 'EXPORT_ARTIFACT_MISSING')
  assert.equal(missingTracked.row().executionStep, 'orphan_cleanup_pending')
  assert.equal(missingTracked.row().exportFileId, 'lost-export-file')

  const missingUntracked = serviceHarness({ status: 'ready', readyAvailability: 'missing_untracked' })
  missingUntracked.row().exportFileId = 'lost-export-file'
  missingUntracked.row().exportExpiresAt = new Date(Date.now() + 60_000)
  await expectCode(() => missingUntracked.service.execute('request-one', 0), 'EXPORT_ARTIFACT_MISSING')
  assert.equal(missingUntracked.row().status, 'failed')
  assert.equal(missingUntracked.row().exportFileId, null)

  const freshLease = serviceHarness({ status: 'handling', lastAttemptAt: new Date() })
  await expectCode(() => freshLease.service.execute('request-one', 0), 'DATA_REQUEST_IN_PROGRESS')
  assert.equal(freshLease.row().status, 'handling', '新鲜 handling 租约不得被失败补偿改写')
  assert.equal(freshLease.mapperBuilds(), 0)
  assert.equal(freshLease.creates(), 0)

  const auditFailure = serviceHarness({ failReadyAudit: true })
  await expectCode(() => auditFailure.service.execute('request-one', 0), 'EXPORT_ARTIFACT_MISSING')
  assert.notEqual(auditFailure.row().status, 'ready', 'ready audit 失败不得留下无审计 ready')
  assert.deepEqual(auditFailure.deleted, ['export-file-1'])
}

async function verifyReadyCasOrphanCompensation(): Promise<void> {
  const compensated = serviceHarness({ failReadyCas: true })
  await expectCode(() => compensated.service.execute('request-one', 0), 'EXPORT_ARTIFACT_MISSING')
  assert.deepEqual(compensated.deleted, ['export-file-1'])
  assert.equal(compensated.row().status, 'failed')
  assert.equal(compensated.row().exportFileId, null)

  const cleanupFailed = serviceHarness({ failReadyCas: true, failCleanup: true })
  await expectCode(() => cleanupFailed.service.execute('request-one', 0), 'EXPORT_CLEANUP_FAILED')
  assert.deepEqual(cleanupFailed.deleted, ['export-file-1'])
  assert.equal(cleanupFailed.row().status, 'failed')
  assert.equal(cleanupFailed.row().failureCode, 'EXPORT_CLEANUP_FAILED')
  assert.equal(cleanupFailed.row().executionStep, 'orphan_cleanup_pending')
  assert.equal(cleanupFailed.row().exportFileId, 'export-file-1', 'cleanup 失败必须留下 reconciler 可恢复的 fileId')
  assert.equal(cleanupFailed.requiredAudits(), 1, 'orphan 证据绑定必须写 required audit')

  const lostOwnership = serviceHarness({
    failReadyCas: true,
    failCleanup: true,
    conflictStatusOnReadyCas: 'cancelled',
  })
  await expectCode(() => lostOwnership.service.execute('request-one', 0), 'EXPORT_CLEANUP_FAILED')
  assert.equal(lostOwnership.row().status, 'cancelled')
  assert.equal(lostOwnership.row().exportFileId, null, '状态已变化时不得越权绑定 orphan fileId')
  assert.equal(lostOwnership.requiredAudits(), 0)
}

const RUNTIME_MATRIX = [
  ['双用户数据隔离', verifyDualUserIsolation],
  ['白名单 envelope 与递归敏感扫描', verifyWhitelistEnvelope],
  ['分区行数与总字节上限', verifyLimits],
  ['processor 幂等、CAS 与 handling 租约', verifyProcessorCasAndLease],
  ['ready CAS 失败后的 orphan 补偿', verifyReadyCasOrphanCompensation],
] as const

async function main(): Promise<void> {
  assert.doesNotThrow(() => assertNoSensitiveExportData({ schemaVersion: MEMBER_EXPORT_SCHEMA_VERSION, sections: {} }))
  assert.throws(() => assertNoSensitiveExportData({ storageKey: 'forbidden' }))
  assert.throws(() => assertNoSensitiveExportData({ value: '13900000000' }))
  console.log('PASS 递归敏感扫描器原语')

  let failures = 0
  for (const [name, run] of RUNTIME_MATRIX) {
    try {
      await run()
      console.log(`PASS ${name}`)
    } catch (error) {
      failures += 1
      console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failures > 0) throw new Error(`member data export verification failed (${failures}/${RUNTIME_MATRIX.length})`)
  console.log(`member data export verification passed (${RUNTIME_MATRIX.length} runtime cases)`)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
