/**
 * 用户数据请求真实状态集成守卫。
 *
 * SQLite 环境使用独立临时库重放正式 migration；PostgreSQL readiness 使用其
 * 已完成迁移的空库。该验证不启动 AppModule，也不连接 Redis：导出一次性
 * 授权的调用顺序由 state-machine verify 锁住，这里验证真实 schema、账本
 * 及同步撤回同意的事实。
 */
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemberDataRequestService } from '../src/member-privacy/member-data-request.service'
import { MemberPrivacyService } from '../src/member-privacy/member-privacy.service'
import { PrismaService } from '../src/prisma/prisma.service'

const originalDatabaseUrl = process.env['DATABASE_URL']
const usesPostgres = /^(postgres|postgresql):\/\//.test(originalDatabaseUrl ?? '')
const tempDir = usesPostgres ? null : mkdtempSync(join(tmpdir(), 'member-data-request-truth-'))

function cleanupEnvironment(): void {
  if (originalDatabaseUrl === undefined) delete process.env['DATABASE_URL']
  else process.env['DATABASE_URL'] = originalDatabaseUrl
  if (tempDir) rmSync(tempDir, { recursive: true, force: true })
}

if (tempDir) {
  const databasePath = join(tempDir, 'truth.db')
  closeSync(openSync(databasePath, 'a'))
  process.env['DATABASE_URL'] = `file:${databasePath}`
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    cleanupEnvironment()
    throw error
  }
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
  const exception = error as { getResponse?: () => unknown; response?: unknown }
  const response = (typeof exception.getResponse === 'function' ? exception.getResponse() : exception.response) as
    | { error?: { code?: string } }
    | undefined
  return response?.error?.code
}

async function expectError(operation: () => Promise<unknown>, expectedCode: string, label: string): Promise<void> {
  try {
    await operation()
    fail(`${label} — 未 fail closed`)
  } catch (error) {
    if (errorCode(error) === expectedCode) pass(`${label} — ${expectedCode}`)
    else fail(`${label} — 预期 ${expectedCode}，实际 ${errorCode(error) ?? (error as Error).message}`)
  }
}

async function main(): Promise<void> {
  console.log(`\n=== 用户数据请求真实状态守卫（${usesPostgres ? 'PostgreSQL' : '临时 SQLite'}）===`)

  const prisma = new PrismaService()
  let stepUpCalls = 0
  const requests = new MemberDataRequestService(
    prisma,
    {
      consumeGrant: async () => {
        stepUpCalls += 1
        throw new Error('truth verify must not consume export grant')
      },
    } as never,
  )
  const tag = `wave1b-data-rights-${Date.now()}-${process.pid}`
  const endUserId = `${tag}-member`

  await prisma.onModuleInit()
  try {
    await prisma.endUser.create({
      data: {
        id: endUserId,
        phoneHash: `${tag}-phone-hash`,
        phoneEnc: 'verify-only-encrypted-placeholder',
        nickname: 'Wave 1-B Verify Member',
      },
    })

    await expectError(
      () => requests.create(endUserId, {
        requestType: 'delete',
        idempotencyKey: null,
        stepUpToken: null,
        terminalId: null,
      }),
      'ACCOUNT_CLOSURE_NOT_AVAILABLE',
      'delete 请求不创建账本或消费 Step-up',
    )
    const afterDelete = await prisma.userDataRequest.count({ where: { endUserId } })
    if (afterDelete === 0 && stepUpCalls === 0) pass('delete 拒绝后真实数据库没有请求行，且 Step-up 零调用')
    else fail(`delete 拒绝仍留下副作用: rows=${afterDelete} stepUp=${stepUpCalls}`)

    const legacyOne = await prisma.userDataRequest.create({
      data: { endUserId, requestType: 'export', status: 'pending' },
    })
    const legacyTwo = await prisma.userDataRequest.create({
      data: { endUserId, requestType: 'revoke_consent', status: 'completed', handledAt: new Date() },
    })
    const legacyPage = await requests.listMyDataRequests(endUserId)
    if (legacyPage.items.some((item) => item.id === legacyOne.id) && legacyPage.items.some((item) => item.id === legacyTwo.id)) {
      pass('历史无 idempotencyKey 的请求可查询，nullable unique 未阻断迁移')
    } else {
      fail('历史无 idempotencyKey 的请求无法查询')
    }

    await new MemberPrivacyService(prisma).grantConsent(endUserId, 'job_ai', null)
    const revokeKey = '6ed2c12e-c6ac-48a8-9ef2-dbcaa0f34dbb'
    const revoked = await requests.create(endUserId, {
      requestType: 'revoke_consent',
      idempotencyKey: revokeKey,
      stepUpToken: null,
      terminalId: null,
    })
    const replay = await requests.create(endUserId, {
      requestType: 'revoke_consent',
      idempotencyKey: revokeKey,
      stepUpToken: null,
      terminalId: null,
    })
    const activeConsent = await prisma.userAiConsent.findFirst({
      where: { endUserId, scope: 'job_ai', revokedAt: null },
    })
    if (revoked.id === replay.id && revoked.status === 'completed' && revoked.executionStep === 'consent_revoked' && !activeConsent) {
      pass('revoke_consent 同步撤回同意、写 completed 账本，并支持幂等重放')
    } else {
      fail(`revoke_consent 账本或同意状态不真实: ${JSON.stringify({ revoked, replay, activeConsent })}`)
    }

    const exportRequest = await prisma.userDataRequest.create({
      data: {
        endUserId,
        requestType: 'export',
        status: 'pending',
        idempotencyKey: '63c93f92-2a96-47c6-947a-857f7e0f0759',
        activeKey: `member-data-request:${endUserId}`,
        executionVersion: 0,
      },
    })
    const rejected = await requests.rejectExportRequest(exportRequest.id, 'verify-admin', 'rejected')
    if (rejected.status === 'rejected') {
      const stored = await prisma.userDataRequest.findUnique({ where: { id: exportRequest.id } })
      if (stored?.activeKey === null && stored.executionStep === 'admin_rejected' && stored.handledBy === 'verify-admin') {
        pass('Admin 仅能将 export 置为 rejected，并清理 activeKey')
      } else {
        fail(`Admin reject 未完整收口: ${JSON.stringify(stored)}`)
      }
    } else {
      fail(`Admin reject 未进入 rejected: ${JSON.stringify(rejected)}`)
    }

    const legacyDelete = await prisma.userDataRequest.create({
      data: { endUserId, requestType: 'delete', status: 'pending' },
    })
    await expectError(
      () => requests.rejectExportRequest(legacyDelete.id, 'verify-admin', 'rejected'),
      'DATA_REQUEST_ACTION_NOT_ALLOWED',
      'Admin 不能 reject 历史 delete 请求',
    )
  } finally {
    await prisma.userDataRequest.deleteMany({ where: { endUserId } })
    await prisma.userAiConsent.deleteMany({ where: { endUserId } })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
    await prisma.onModuleDestroy()
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} 项失败 — 用户数据请求账本与实际状态不一致\n`)
    process.exitCode = 1
    return
  }
  console.log('✅ ALL PASS — 用户数据请求账本与实际状态一致\n')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    cleanupEnvironment()
  })
