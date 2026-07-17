/**
 * Wave 1-B 数据权利请求运行时状态机门禁。
 *
 * 本脚本不读取实现源码、不按字符串或注释顺序判定安全。它动态加载真实
 * service/controller，并向 service 注入可观测依赖，验证调用结果与副作用。
 * Layer 2 尚未落地时必须 RED；不存在环境变量跳过路径。
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'

type RequestType = 'export' | 'delete' | 'revoke_consent'

interface CreateCommand {
  endUserId: string
  requestType: RequestType
  idempotencyKey: string
  stepUpToken: string | null
  deviceId: string | null
}

interface RequestRow {
  id: string
  endUserId: string
  requestType: string
  status: string
  idempotencyKey: string | null
  activeKey: string | null
  executionVersion: number
  executionStep: string | null
  progressJson: string
  workerJobId: string | null
  exportFileId: string | null
  exportExpiresAt: Date | null
  downloadConsumedAt: Date | null
  failureCode: string | null
  failureMessage: string | null
  retryCount: number
  lastAttemptAt: Date | null
  requestedAt: Date
  handledAt: Date | null
  handledBy: string | null
  auditRef: string | null
}

interface RuntimeService {
  create: (...args: unknown[]) => Promise<unknown>
  retry?: (id: string, handledBy: string) => Promise<unknown>
  reject?: (id: string, handledBy: string, reason: string) => Promise<unknown>
}

type RuntimeServiceConstructor = new (...args: unknown[]) => RuntimeService

interface QueueCall {
  name: string
  data: Record<string, unknown>
  options: Record<string, unknown>
}

interface RequiredAuditCall {
  transactionClient: unknown
  insideTransactionCallback: boolean
}

interface Counters {
  reads: number
  creates: number
  updates: number
  transactions: number
  endUserWrites: number
  stepUpConsumes: number
  auditRequired: number
  redisLocks: number
  redisUnlocks: number
  queueAdds: number
}

interface HarnessOptions {
  rows?: RequestRow[]
  queueAvailable?: boolean
  lockAcquired?: boolean
  lockFailure?: Error
  auditFailure?: Error
  queueFailure?: Error
  queueStartsWorker?: boolean
}

const TEST_MATRIX = [
  'delete 在任何 Redis/DB/step-up/queue 副作用前 ACCOUNT_CLOSURE_NOT_AVAILABLE',
  '同幂等键重放返回原记录且不再次消费 grant',
  '跨用户复用幂等键拒绝且不消费 grant',
  '同会员 activeKey 冲突拒绝且不消费 grant',
  'queue 不可用 fail closed 且不消费 grant',
  '会员级锁争用返回 DATA_REQUEST_IN_PROGRESS',
  'export 创建在事务内写 required audit 并以 executionVersion 入队',
  'required audit 失败回滚请求且不入队',
  'queue add 失败补偿为 failed 并保留 activeKey',
  'worker 抢先执行不应阻断 workerJobId 写入或误回 503',
  'Admin retry 的 worker 抢先执行不应误回 503',
] as const

let failures = 0

function pass(label: string): void {
  console.log(`  PASS ${label}`)
}

function fail(label: string, error?: unknown): void {
  failures += 1
  const detail = error instanceof Error ? `: ${error.message}` : ''
  console.error(`  FAIL ${label}${detail}`)
}

async function check(label: string, operation: () => void | Promise<void>): Promise<void> {
  try {
    await operation()
    pass(label)
  } catch (error) {
    fail(label, error)
  }
}

function makeRow(overrides: Partial<RequestRow> = {}): RequestRow {
  return {
    id: 'request-existing',
    endUserId: 'member-one',
    requestType: 'export',
    status: 'pending',
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    activeKey: 'member-one:privacy-exclusive',
    executionVersion: 0,
    executionStep: null,
    progressJson: '{}',
    workerJobId: null,
    exportFileId: null,
    exportExpiresAt: null,
    downloadConsumedAt: null,
    failureCode: null,
    failureMessage: null,
    retryCount: 0,
    lastAttemptAt: null,
    requestedAt: new Date('2026-07-17T00:00:00.000Z'),
    handledAt: null,
    handledBy: null,
    auditRef: null,
    ...overrides,
  }
}

function matchesWhere(row: RequestRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected === undefined) return true
    return row[key as keyof RequestRow] === expected
  })
}

function errorCode(error: unknown): string | undefined {
  const exception = error as { getResponse?: () => unknown; response?: unknown }
  const response = (typeof exception?.getResponse === 'function' ? exception.getResponse() : exception?.response) as
    | { error?: { code?: string }; code?: string }
    | undefined
  return response?.error?.code ?? response?.code
}

async function captureError(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation()
  } catch (error) {
    return error
  }
  throw new Error('预期操作失败，实际成功')
}

function assertErrorCode(error: unknown, expected: string): void {
  assert.equal(errorCode(error), expected, `预期 ${expected}，实际 ${(error as Error)?.message ?? '无错误'}`)
}

function createHarness(Constructor: RuntimeServiceConstructor, options: HarnessOptions = {}) {
  let rows = [...(options.rows ?? [])]
  const counters: Counters = {
    reads: 0,
    creates: 0,
    updates: 0,
    transactions: 0,
    endUserWrites: 0,
    stepUpConsumes: 0,
    auditRequired: 0,
    redisLocks: 0,
    redisUnlocks: 0,
    queueAdds: 0,
  }
  const queueCalls: QueueCall[] = []
  const stepUpCalls: unknown[][] = []
  const requiredAuditCalls: RequiredAuditCall[] = []
  const lockCalls: unknown[][] = []
  let currentTransactionClient: unknown = null
  let insideTransactionCallback = false

  const delegate = (getRows: () => RequestRow[], setRows: (next: RequestRow[]) => void) => ({
    findUnique: async (args: { where: Record<string, unknown> }) => {
      counters.reads += 1
      return getRows().find((row) => matchesWhere(row, args.where)) ?? null
    },
    findFirst: async (args: { where: Record<string, unknown> }) => {
      counters.reads += 1
      return getRows().find((row) => matchesWhere(row, args.where)) ?? null
    },
    create: async (args: { data: Record<string, unknown> }) => {
      counters.creates += 1
      const created = makeRow({
        id: String(args.data['id'] ?? 'request-created'),
        endUserId: String(args.data['endUserId']),
        requestType: String(args.data['requestType']),
        status: String(args.data['status'] ?? 'pending'),
        idempotencyKey: (args.data['idempotencyKey'] as string | null | undefined) ?? null,
        activeKey: (args.data['activeKey'] as string | null | undefined) ?? null,
        executionVersion: Number(args.data['executionVersion'] ?? 0),
      })
      setRows([...getRows(), created])
      return created
    },
    updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      counters.updates += 1
      let count = 0
      const next = getRows().map((row) => {
        if (!matchesWhere(row, args.where)) return row
        count += 1
        return { ...row, ...args.data } as RequestRow
      })
      setRows(next)
      return { count }
    },
    update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      counters.updates += 1
      const current = getRows().find((row) => matchesWhere(row, args.where))
      if (!current) throw new Error('harness request row not found')
      const updated = { ...current, ...args.data } as RequestRow
      setRows(getRows().map((row) => (row.id === current.id ? updated : row)))
      return updated
    },
  })

  const rootDelegate = delegate(() => rows, (next) => { rows = next })
  const prisma = {
    userDataRequest: rootDelegate,
    endUser: {
      findUnique: async () => null,
      updateMany: async () => {
        counters.endUserWrites += 1
        return { count: 1 }
      },
    },
    $transaction: async (operation: (tx: unknown) => Promise<unknown>) => {
      counters.transactions += 1
      let stagedRows = [...rows]
      const stagedDelegate = delegate(() => stagedRows, (next) => { stagedRows = next })
      const transactionClient = {
        userDataRequest: stagedDelegate,
        userAiConsent: { updateMany: async () => ({ count: 1 }) },
        auditLog: { create: async () => ({ id: 'audit-row' }) },
      }
      currentTransactionClient = transactionClient
      insideTransactionCallback = true
      try {
        const result = await operation(transactionClient)
        rows = stagedRows
        return result
      } finally {
        insideTransactionCallback = false
      }
    },
  }
  const stepUp = {
    consumeGrant: async (...args: unknown[]) => {
      counters.stepUpConsumes += 1
      stepUpCalls.push(args)
    },
  }
  const audit = {
    writeRequired: async (transactionClient: unknown) => {
      counters.auditRequired += 1
      requiredAuditCalls.push({ transactionClient, insideTransactionCallback })
      if (options.auditFailure) throw options.auditFailure
      return 'audit-required'
    },
  }
  const redis = {
    setNxEx: async (...args: unknown[]) => {
      counters.redisLocks += 1
      lockCalls.push(args)
      if (options.lockFailure) throw options.lockFailure
      return options.lockAcquired ?? true
    },
    getAndDelIfEquals: async () => {
      counters.redisUnlocks += 1
      return true
    },
    revokeMemberSessions: async () => undefined,
  }
  const queue = options.queueAvailable === false ? undefined : {
    add: async (name: string, data: Record<string, unknown>, queueOptions: Record<string, unknown>) => {
      counters.queueAdds += 1
      queueCalls.push({ name, data, options: queueOptions })
      if (options.queueFailure) throw options.queueFailure
      if (options.queueStartsWorker) {
        rows = rows.map((row) => row.id === data['requestId']
          ? { ...row, status: 'handling', executionStep: 'export_building' }
          : row)
      }
      return { id: String(queueOptions['jobId']) }
    },
  }
  const service = new Constructor(prisma, stepUp, audit, redis, queue)

  return {
    service,
    counters,
    queueCalls,
    stepUpCalls,
    requiredAuditCalls,
    lockCalls,
    currentTransactionClient: () => currentTransactionClient,
    rows: () => rows,
  }
}

async function invokeCreate(service: RuntimeService, command: CreateCommand): Promise<unknown> {
  if (service.create.length <= 1) return service.create(command)
  return service.create(
    command.endUserId,
    command.requestType,
    command.idempotencyKey,
    command.stepUpToken,
    command.deviceId,
  )
}

function command(overrides: Partial<CreateCommand> = {}): CreateCommand {
  return {
    endUserId: 'member-one',
    requestType: 'export',
    idempotencyKey: '00000000-0000-4000-8000-000000000002',
    stepUpToken: 'verify-step-up-token',
    deviceId: 'verify-device',
    ...overrides,
  }
}

async function runServiceMatrix(Constructor: RuntimeServiceConstructor): Promise<void> {
  await check(TEST_MATRIX[0], async () => {
    const harness = createHarness(Constructor)
    const error = await captureError(() => invokeCreate(harness.service, command({ requestType: 'delete' })))
    assertErrorCode(error, 'ACCOUNT_CLOSURE_NOT_AVAILABLE')
    assert.deepEqual(harness.counters, {
      reads: 0,
      creates: 0,
      updates: 0,
      transactions: 0,
      endUserWrites: 0,
      stepUpConsumes: 0,
      auditRequired: 0,
      redisLocks: 0,
      redisUnlocks: 0,
      queueAdds: 0,
    })
  })

  await check(TEST_MATRIX[1], async () => {
    const existing = makeRow()
    const harness = createHarness(Constructor, { rows: [existing] })
    const result = await invokeCreate(harness.service, command({ idempotencyKey: existing.idempotencyKey! })) as RequestRow
    assert.equal(result.id, existing.id)
    assert.equal(harness.counters.stepUpConsumes, 0)
    assert.equal(harness.counters.transactions, 0)
    assert.equal(harness.counters.queueAdds, 0)
    assert.equal(harness.counters.redisLocks, 0)
  })

  await check(TEST_MATRIX[2], async () => {
    const existing = makeRow()
    const harness = createHarness(Constructor, { rows: [existing] })
    const error = await captureError(() => invokeCreate(harness.service, command({
      endUserId: 'member-two',
      idempotencyKey: existing.idempotencyKey!,
    })))
    assertErrorCode(error, 'IDEMPOTENCY_KEY_REUSED')
    assert.equal(harness.counters.stepUpConsumes, 0)
    assert.equal(harness.counters.transactions, 0)
  })

  await check(TEST_MATRIX[3], async () => {
    const harness = createHarness(Constructor, { rows: [makeRow()] })
    const error = await captureError(() => invokeCreate(harness.service, command()))
    assertErrorCode(error, 'DATA_REQUEST_ALREADY_ACTIVE')
    assert.equal(harness.counters.stepUpConsumes, 0)
    assert.equal(harness.counters.transactions, 0)
  })

  await check(TEST_MATRIX[4], async () => {
    const harness = createHarness(Constructor, { queueAvailable: false })
    const error = await captureError(() => invokeCreate(harness.service, command()))
    assertErrorCode(error, 'DATA_REQUEST_QUEUE_UNAVAILABLE')
    assert.equal(harness.counters.stepUpConsumes, 0)
    assert.equal(harness.counters.transactions, 0)
    assert.equal(harness.counters.redisLocks, 0)
  })

  await check(TEST_MATRIX[5], async () => {
    const harness = createHarness(Constructor, { lockAcquired: false })
    const error = await captureError(() => invokeCreate(harness.service, command()))
    assertErrorCode(error, 'DATA_REQUEST_IN_PROGRESS')
    assert.equal(harness.counters.stepUpConsumes, 0)
    assert.equal(harness.counters.transactions, 0)
    assert.equal(harness.counters.queueAdds, 0)
    assert.equal(harness.lockCalls[0]?.[0], 'member:data-request:create:member-one')
    assert.equal(harness.lockCalls[0]?.[2], 30)

    const unavailableHarness = createHarness(Constructor, { lockFailure: new Error('redis unavailable') })
    const unavailableError = await captureError(() => invokeCreate(unavailableHarness.service, command()))
    assertErrorCode(unavailableError, 'DATA_REQUEST_QUEUE_UNAVAILABLE')
    assert.equal(unavailableHarness.counters.stepUpConsumes, 0)
    assert.equal(unavailableHarness.counters.transactions, 0)
  })

  await check(TEST_MATRIX[6], async () => {
    const harness = createHarness(Constructor)
    const result = await invokeCreate(harness.service, command()) as RequestRow
    assert.equal(result.id, 'request-created')
    assert.equal(harness.counters.stepUpConsumes, 1)
    assert.equal(harness.counters.transactions, 1)
    assert.equal(harness.counters.auditRequired, 1)
    assert.equal(harness.requiredAuditCalls.length, 1)
    assert.strictEqual(
      harness.requiredAuditCalls[0]?.transactionClient,
      harness.currentTransactionClient(),
      'writeRequired 第一个参数必须是当前 transaction callback 收到的 tx client',
    )
    assert.equal(
      harness.requiredAuditCalls[0]?.insideTransactionCallback,
      true,
      'writeRequired 必须在 transaction callback 尚未结束时调用',
    )
    assert.equal(harness.counters.queueAdds, 1)
    assert.equal(harness.stepUpCalls[0]?.[1], 'export_data_request')
    const stored = harness.rows().find((row) => row.id === result.id)
    assert.equal(stored?.activeKey, 'member-one:privacy-exclusive')
    const queueCall = harness.queueCalls[0]
    assert.equal(queueCall?.name, 'member.export')
    assert.equal(queueCall?.data['requestId'], result.id)
    assert.equal(queueCall?.data['executionVersion'], 0)
    assert.equal(queueCall?.options['jobId'], `member-export-${result.id}-0`)
    assert.doesNotMatch(String(queueCall?.options['jobId']), /:/, 'BullMQ custom jobId 禁止冒号')
    assert.equal(stored?.workerJobId, `member-export-${result.id}-0`)
    assert.equal((result as unknown as { canRetry: boolean }).canRetry, false, '已有 workerJobId 的 pending 不可重试')
  })

  await check(TEST_MATRIX[7], async () => {
    const harness = createHarness(Constructor, { auditFailure: new Error('required audit failed') })
    await captureError(() => invokeCreate(harness.service, command()))
    assert.equal(harness.requiredAuditCalls.length, 1)
    assert.strictEqual(
      harness.requiredAuditCalls[0]?.transactionClient,
      harness.currentTransactionClient(),
    )
    assert.equal(harness.requiredAuditCalls[0]?.insideTransactionCallback, true)
    assert.equal(harness.rows().length, 0)
    assert.equal(harness.counters.queueAdds, 0)
  })

  await check(TEST_MATRIX[8], async () => {
    const harness = createHarness(Constructor, { queueFailure: new Error('queue unavailable') })
    const error = await captureError(() => invokeCreate(harness.service, command()))
    assertErrorCode(error, 'QUEUE_ENQUEUE_FAILED')
    const stored = harness.rows().find((row) => row.id === 'request-created')
    assert.equal(stored?.status, 'failed')
    assert.equal(stored?.failureCode, 'QUEUE_ENQUEUE_FAILED')
    assert.equal(stored?.activeKey, 'member-one:privacy-exclusive')
    assert.equal(stored?.workerJobId, null)
  })

  await check(TEST_MATRIX[9], async () => {
    const harness = createHarness(Constructor, { queueStartsWorker: true })
    const result = await invokeCreate(harness.service, command()) as RequestRow
    const stored = harness.rows().find((row) => row.id === result.id)
    assert.equal(stored?.status, 'handling')
    assert.equal(stored?.workerJobId, `member-export-${result.id}-0`)
  })

  await check(TEST_MATRIX[10], async () => {
    const retryable = makeRow({ status: 'failed', failureCode: 'EXPORT_ARTIFACT_MISSING' })
    const harness = createHarness(Constructor, { rows: [retryable], queueStartsWorker: true })
    assert.ok(harness.service.retry, '管理员 retry 方法必须存在')
    const error = await captureError(() => harness.service.retry!(retryable.id, 'admin-one'))
    assertErrorCode(error, 'END_USER_NOT_FOUND')
    const stored = harness.rows().find((row) => row.id === retryable.id)
    assert.equal(stored?.status, 'handling')
    assert.equal(stored?.workerJobId, `member-export-${retryable.id}-1`)
  })

  await check('orphan_cleanup_pending 禁止管理员 retry/reject 越过 reconciler', async () => {
    const orphan = makeRow({
      status: 'failed',
      failureCode: 'EXPORT_CLEANUP_FAILED',
      executionStep: 'orphan_cleanup_pending',
      exportFileId: 'export-file-orphan',
    })
    const harness = createHarness(Constructor, { rows: [orphan] })
    assert.ok(harness.service.retry && harness.service.reject, '管理员明确动作方法必须存在')
    const retryError = await captureError(() => harness.service.retry!(orphan.id, 'admin-one'))
    assertErrorCode(retryError, 'DATA_REQUEST_INVALID_TRANSITION')
    const rejectError = await captureError(() => harness.service.reject!(orphan.id, 'admin-one', '等待系统清理'))
    assertErrorCode(rejectError, 'DATA_REQUEST_INVALID_TRANSITION')
    const stored = harness.rows().find((row) => row.id === orphan.id)
    assert.equal(stored?.activeKey, orphan.activeKey)
    assert.equal(stored?.exportFileId, orphan.exportFileId)
    assert.equal(harness.counters.auditRequired, 0)
    assert.equal(harness.counters.queueAdds, 0)
  })
}

async function loadRuntimeModule<T>(label: string, loader: () => Promise<T>): Promise<T | null> {
  try {
    return await loader()
  } catch {
    fail(`${label} 无法动态加载`)
    return null
  }
}

function controllerRoutes(Controller: { prototype: object }): Array<{ path: string; method: RequestMethod }> {
  return Object.getOwnPropertyNames(Controller.prototype).flatMap((name) => {
    if (name === 'constructor') return []
    const handler = Object.getOwnPropertyDescriptor(Controller.prototype, name)?.value as object | undefined
    if (!handler) return []
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined
    return path === undefined || method === undefined ? [] : [{ path, method }]
  })
}

async function main(): Promise<void> {
  console.log('\n=== Wave 1-B 数据权利请求运行时状态机 ===')
  const serviceModulePath = '../src/member-privacy/member-data-request.service'
  const queueModulePath = '../src/member-privacy/member-privacy.queue'
  const serviceModule = await loadRuntimeModule(
    'MemberDataRequestService',
    () => import(serviceModulePath),
  )
  const queueModule = await loadRuntimeModule(
    'member-privacy queue',
    () => import(queueModulePath),
  )
  const adminModule = await loadRuntimeModule(
    'AdminMemberPrivacyController',
    () => import('../src/member-privacy/admin-member-privacy.controller'),
  )
  const legacyModule = await loadRuntimeModule(
    'MemberPrivacyService',
    () => import('../src/member-privacy/member-privacy.service'),
  )

  if (queueModule) {
    await check('queue 常量与 executionVersion 运行时契约', () => {
      assert.equal(queueModule.MEMBER_PRIVACY_QUEUE, 'member-privacy')
      assert.equal(queueModule.MEMBER_EXPORT_JOB, 'member.export')
      assert.equal(queueModule.MEMBER_EXPORT_RECONCILE_JOB, 'member.export.reconcile')
    })
  }

  if (adminModule) {
    await check('Admin 移除 arbitrary PATCH，仅保留明确 retry/reject 动作', () => {
      const routes = controllerRoutes(adminModule.AdminMemberPrivacyController)
      assert.ok(routes.every((route) => route.method !== RequestMethod.PATCH))
      assert.ok(routes.some((route) => route.method === RequestMethod.POST && route.path === 'data-requests/:id/retry'))
      assert.ok(routes.some((route) => route.method === RequestMethod.POST && route.path === 'data-requests/:id/reject'))
    })
  }

  if (legacyModule) {
    await check('旧 MemberPrivacyService 不再暴露请求写入口', () => {
      const methods = Object.getOwnPropertyNames(legacyModule.MemberPrivacyService.prototype)
      for (const method of [
        'listMyDataRequests',
        'createDataRequest',
        'listDataRequestsForAdmin',
        'handleDataRequest',
      ]) {
        assert.ok(!methods.includes(method), `仍暴露 ${method}`)
      }
    })
  }

  const Constructor = serviceModule?.MemberDataRequestService as RuntimeServiceConstructor | undefined
  if (!Constructor) {
    for (const label of TEST_MATRIX) fail(`未执行：${label}`)
  } else {
    await runServiceMatrix(Constructor)
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} 项失败 — Layer 2 运行时状态机仍为 RED\n`)
    process.exitCode = 1
    return
  }
  console.log('\n✅ ALL PASS — Layer 2 运行时状态机与副作用顺序已验证\n')
}

void main()
