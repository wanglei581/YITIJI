/**
 * Wave 1-B Slice 1 数据请求状态机守卫。
 *
 * 这里刻意使用内存替身，而不是启动完整 Nest/Redis：目的是锁住 service
 * 调用次序。特别是 delete 必须在读取任何外部依赖前拒绝，export 的重复
 * 请求也绝不能二次消费一次性 Step-up grant。
 */
import { MemberDataRequestService } from '../src/member-privacy/member-data-request.service'

type RequestType = 'export' | 'delete' | 'revoke_consent'

interface StoredRequest {
  id: string
  endUserId: string
  requestType: RequestType
  status: string
  requestedAt: Date
  handledAt: Date | null
  idempotencyKey: string | null
  activeKey: string | null
  executionVersion: number
  executionStep: string | null
  progressJson: string | null
  workerJobId: string | null
  exportFileId: string | null
  exportExpiresAt: Date | null
  downloadConsumedAt: Date | null
  failureCode: string | null
  retryCount: number
  lastAttemptAt: Date | null
  handledBy: string | null
  auditRef: string | null
}

let failures = 0

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failures += 1
  console.error(`  FAIL ${message}`)
}

function errorCode(error: unknown): string | undefined {
  const exception = error as { getResponse?: () => unknown; response?: unknown; code?: string }
  const response = (typeof exception.getResponse === 'function' ? exception.getResponse() : exception.response) as
    | { error?: { code?: string } }
    | undefined
  return response?.error?.code ?? exception.code
}

async function expectCode(operation: () => Promise<unknown>, expected: string): Promise<string | undefined> {
  try {
    await operation()
    return undefined
  } catch (error) {
    return errorCode(error)
  }
}

class FakePrisma {
  readonly rows: StoredRequest[] = []
  accountAvailable = true
  private nextId = 0

  readonly userDataRequest: Record<string, unknown> = {}

  constructor() {
    this.userDataRequest['findUnique'] = async (args: { where: Record<string, unknown> }) => {
      const where = args.where
      if (typeof where['id'] === 'string') return this.rows.find((row) => row.id === where['id']) ?? null
      if (typeof where['activeKey'] === 'string') {
        return this.rows.find((row) => row.activeKey === where['activeKey']) ?? null
      }
      const compound = where['endUserId_idempotencyKey'] as
        | { endUserId?: string; idempotencyKey?: string }
        | undefined
      if (compound?.endUserId && compound.idempotencyKey) {
        return this.rows.find(
          (row) => row.endUserId === compound.endUserId && row.idempotencyKey === compound.idempotencyKey,
        ) ?? null
      }
      return null
    }

    ;(this.userDataRequest as { create: (args: { data: Partial<StoredRequest> }) => Promise<StoredRequest> }).create = async (args) => {
      const row: StoredRequest = {
        id: `request-${++this.nextId}`,
        endUserId: args.data.endUserId!,
        requestType: args.data.requestType as RequestType,
        status: args.data.status ?? 'pending',
        requestedAt: new Date('2026-07-17T00:00:00.000Z'),
        handledAt: args.data.handledAt ?? null,
        idempotencyKey: args.data.idempotencyKey ?? null,
        activeKey: args.data.activeKey ?? null,
        executionVersion: args.data.executionVersion ?? 0,
        executionStep: args.data.executionStep ?? null,
        progressJson: args.data.progressJson ?? null,
        workerJobId: args.data.workerJobId ?? null,
        exportFileId: args.data.exportFileId ?? null,
        exportExpiresAt: args.data.exportExpiresAt ?? null,
        downloadConsumedAt: args.data.downloadConsumedAt ?? null,
        failureCode: args.data.failureCode ?? null,
        retryCount: args.data.retryCount ?? 0,
        lastAttemptAt: args.data.lastAttemptAt ?? null,
        handledBy: args.data.handledBy ?? null,
        auditRef: args.data.auditRef ?? null,
      }
      if (row.idempotencyKey && this.rows.some((item) => item.endUserId === row.endUserId && item.idempotencyKey === row.idempotencyKey)) {
        const error = Object.assign(new Error('unique idempotency'), { code: 'P2002' })
        throw error
      }
      if (row.activeKey && this.rows.some((item) => item.activeKey === row.activeKey)) {
        const error = Object.assign(new Error('unique active key'), { code: 'P2002' })
        throw error
      }
      this.rows.push(row)
      return row
    }

    ;(this.userDataRequest as { delete: (args: { where: { id: string } }) => Promise<StoredRequest> }).delete = async (args) => {
      const index = this.rows.findIndex((row) => row.id === args.where.id)
      if (index < 0) throw new Error('request missing')
      return this.rows.splice(index, 1)[0]!
    }

    ;(this.userDataRequest as { update: (args: { where: { id: string }; data: Partial<StoredRequest> }) => Promise<StoredRequest> }).update = async (args) => {
      const row = this.rows.find((item) => item.id === args.where.id)
      if (!row) throw new Error('request missing')
      Object.assign(row, args.data)
      return row
    }

    ;(this.userDataRequest as { findMany: (args: unknown) => Promise<StoredRequest[]> }).findMany = async () => [...this.rows]
    this.userAiConsent = { updateMany: async () => ({ count: 1 }) }
    this.endUser = {
      findUnique: async () => this.accountAvailable ? { enabled: true, status: 'active' } : { enabled: false, status: 'disabled' },
    }
  }

  userAiConsent: { updateMany: () => Promise<{ count: number }> }
  endUser: { findUnique: () => Promise<{ enabled: boolean; status: string }> }

  async $transaction<T>(operation: (tx: FakePrisma) => Promise<T>): Promise<T> {
    return operation(this)
  }
}

function createService(prisma: FakePrisma, options?: { rejectGrant?: boolean }) {
  const counters = { grant: 0 }
  const stepUp = {
    consumeGrant: async () => {
      counters.grant += 1
      if (options?.rejectGrant) throw Object.assign(new Error('grant invalid'), { code: 'STEP_UP_TOKEN_INVALID' })
    },
  }
  return {
    counters,
    service: new MemberDataRequestService(prisma as never, stepUp as never),
  }
}

async function verifyDeleteHasNoSideEffects(): Promise<void> {
  const counters = { prisma: 0, grant: 0 }
  const unavailablePrisma = new Proxy({}, {
    get() {
      counters.prisma += 1
      throw new Error('delete must not touch Prisma')
    },
  })
  const stepUp = { consumeGrant: async () => { counters.grant += 1 } }
  const service = new MemberDataRequestService(unavailablePrisma as never, stepUp as never)

  const code = await expectCode(
    () => service.create('member-delete', {
      requestType: 'delete',
      idempotencyKey: null,
      stepUpToken: null,
      terminalId: null,
    }),
    'ACCOUNT_CLOSURE_NOT_AVAILABLE',
  )

  if (code === 'ACCOUNT_CLOSURE_NOT_AVAILABLE' && Object.values(counters).every((count) => count === 0)) {
    pass('delete 在 Prisma、同意、Step-up 之前 fail closed')
  } else {
    fail(`delete 发生副作用或错误码错误: code=${code ?? 'none'} counters=${JSON.stringify(counters)}`)
  }
}

async function verifyExportIdempotencyAndIsolation(): Promise<void> {
  const prisma = new FakePrisma()
  const { service, counters } = createService(prisma)
  const idempotencyKey = 'f82f8755-4a4e-4c66-9b37-dca241d7d7c8'

  const first = await service.create('member-a', {
    requestType: 'export',
    idempotencyKey,
    stepUpToken: 'grant-a-1',
    terminalId: 'terminal-a',
  })
  const replay = await service.create('member-a', {
    requestType: 'export',
    idempotencyKey,
    stepUpToken: 'grant-a-2',
    terminalId: 'terminal-a',
  })
  const otherMember = await service.create('member-b', {
    requestType: 'export',
    idempotencyKey,
    stepUpToken: 'grant-b-1',
    terminalId: 'terminal-b',
  })

  if (first.id === replay.id && first.id !== otherMember.id && counters.grant === 2 && prisma.rows.length === 2) {
    pass('同会员同 UUID 重放不二次消费 grant；不同会员可复用 UUID')
  } else {
    fail(`导出幂等或隔离错误: first=${first.id} replay=${replay.id} other=${otherMember.id} grant=${counters.grant} rows=${prisma.rows.length}`)
  }

  const activeConflict = await expectCode(
    () => service.create('member-a', {
      requestType: 'export',
      idempotencyKey: '0b6837f0-3f95-4301-af23-732486867b2d',
      stepUpToken: 'grant-a-3',
      terminalId: 'terminal-a',
    }),
    'DATA_REQUEST_ACTIVE',
  )
  if (activeConflict === 'DATA_REQUEST_ACTIVE' && counters.grant === 2) {
    pass('活跃请求冲突不消费新的 grant')
  } else {
    fail(`活跃请求冲突消费了 grant 或返回错误: code=${activeConflict ?? 'none'} grant=${counters.grant}`)
  }

  const consentKey = 'a48d9342-0e33-4a1f-a7b3-5c00a63ebf25'
  await service.create('member-c', {
    requestType: 'revoke_consent',
    idempotencyKey: consentKey,
    stepUpToken: null,
    terminalId: null,
  })
  const crossTypeReuse = await expectCode(
    () => service.create('member-c', {
      requestType: 'export',
      idempotencyKey: consentKey,
      stepUpToken: 'grant-c-1',
      terminalId: null,
    }),
    'IDEMPOTENCY_KEY_REUSED',
  )
  if (crossTypeReuse === 'IDEMPOTENCY_KEY_REUSED' && counters.grant === 2) {
    pass('同会员同 UUID 跨请求类型复用被拒绝，且不消费 grant')
  } else {
    fail(`跨类型 UUID 复用未安全拒绝: code=${crossTypeReuse ?? 'none'} grant=${counters.grant}`)
  }
}

async function verifyGrantFailureReleasesReservation(): Promise<void> {
  const prisma = new FakePrisma()
  const rejected = createService(prisma, { rejectGrant: true })
  const idempotencyKey = 'de6e7e60-ebf0-4ab8-a36c-14b0b556b38f'
  const code = await expectCode(
    () => rejected.service.create('member-failed-grant', {
      requestType: 'export',
      idempotencyKey,
      stepUpToken: 'rejected-grant',
      terminalId: null,
    }),
    'STEP_UP_TOKEN_INVALID',
  )
  const recovered = createService(prisma)
  const retry = await recovered.service.create('member-failed-grant', {
    requestType: 'export',
    idempotencyKey,
    stepUpToken: 'fresh-grant',
    terminalId: null,
  })
  if (code === 'STEP_UP_TOKEN_INVALID' && prisma.rows.length === 1 && recovered.counters.grant === 1 && retry.id) {
    pass('Step-up 失败会释放未授权的导出预约，后续可安全重试')
  } else {
    fail(`Step-up 失败遗留了请求或无法重试: code=${code ?? 'none'} rows=${prisma.rows.length} grant=${recovered.counters.grant}`)
  }
}

async function verifyUnavailableAccountDoesNotReserveOrConsume(): Promise<void> {
  const prisma = new FakePrisma()
  prisma.accountAvailable = false
  const { service, counters } = createService(prisma)
  const code = await expectCode(
    () => service.create('member-disabled', {
      requestType: 'export',
      idempotencyKey: 'c45415f7-6d45-4b95-a0d0-b0a45df02ef9',
      stepUpToken: 'disabled-grant',
      terminalId: null,
    }),
    'ACCOUNT_UNAVAILABLE',
  )
  if (code === 'ACCOUNT_UNAVAILABLE' && counters.grant === 0 && prisma.rows.length === 0) {
    pass('不可用账户不能预约导出或消费 grant')
  } else {
    fail(`不可用账户留下了导出副作用: code=${code ?? 'none'} grant=${counters.grant} rows=${prisma.rows.length}`)
  }
}

async function main(): Promise<void> {
  console.log('\n=== Wave 1-B Slice 1 数据请求状态机守卫 ===')
  await verifyDeleteHasNoSideEffects()
  await verifyExportIdempotencyAndIsolation()
  await verifyGrantFailureReleasesReservation()
  await verifyUnavailableAccountDoesNotReserveOrConsume()

  if (failures > 0) {
    console.error(`\n❌ ${failures} 项失败 — 数据请求状态机未满足 Slice 1 安全边界\n`)
    process.exitCode = 1
    return
  }
  console.log('✅ ALL PASS — Slice 1 数据请求状态机安全边界成立\n')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
