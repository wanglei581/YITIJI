/**
 * 用户数据请求真实状态集成守卫。
 *
 * SQLite 环境重放正式 migration；PostgreSQL readiness 使用该 job 的空库。
 * 覆盖：
 *   - 唯一请求服务 activeKey 互斥
 *   - delete 零副作用 fail-closed（DATA_DELETION_ENABLED 默认 false）
 *   - revoke_consent 同事务完成
 *   - 队列缺失时 export 不创建伪 pending 记录
 *   - reconciler / download-service 结构存在性
 *   - DATA_DELETION_ENABLED 运行时开关门控
 */
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditService } from '../src/audit/audit.service'
import { MemberDataExportDownloadService } from '../src/member-privacy/member-data-export-download.service'
import { MemberDataExportReconcilerService } from '../src/member-privacy/member-data-export-reconciler.service'
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

async function captureCode(operation: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await operation()
    return undefined
  } catch (error) {
    return errorCode(error)
  }
}

async function main(): Promise<void> {
  console.log(`\n=== 用户数据请求真实状态守卫（${usesPostgres ? 'PostgreSQL' : '临时 SQLite'}）===`)

  const prisma = new PrismaService()
  const audit = new AuditService(prisma)
  const consent = new MemberPrivacyService(prisma)
  const counters = { stepUp: 0, redis: 0 }
  const stepUp = {
    consumeGrant: async () => {
      counters.stepUp += 1
      throw new Error('queue gate should run before step-up')
    },
  }
  const redis = {
    setNxEx: async () => {
      counters.redis += 1
      throw new Error('queue gate should run before Redis lock')
    },
    getAndDelIfEquals: async () => 'matched' as const,
  }
  const requests = new MemberDataRequestService(prisma, stepUp as never, audit, redis as never, undefined)
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

    const legacyMethods = Object.getOwnPropertyNames(MemberPrivacyService.prototype)
    const leaked = ['listMyDataRequests', 'createDataRequest', 'listDataRequestsForAdmin', 'handleDataRequest']
      .filter((method) => legacyMethods.includes(method))
    if (leaked.length === 0) pass('MemberPrivacyService 不再暴露第二套数据请求写入口')
    else fail(`MemberPrivacyService 仍暴露旧入口：${leaked.join(',')}`)

    const beforeDeleteRows = await prisma.userDataRequest.count({ where: { endUserId } })
    const beforeDeleteAudits = await prisma.auditLog.count({ where: { targetId: endUserId } })
    const deleteCode = await captureCode(() => requests.create(
      endUserId,
      'delete',
      randomUUID(),
      'must-not-be-consumed',
      'must-not-be-read',
    ))
    const afterDeleteRows = await prisma.userDataRequest.count({ where: { endUserId } })
    const afterDeleteAudits = await prisma.auditLog.count({ where: { targetId: endUserId } })
    if (
      deleteCode === 'ACCOUNT_CLOSURE_NOT_AVAILABLE'
      && beforeDeleteRows === afterDeleteRows
      && beforeDeleteAudits === afterDeleteAudits
      && counters.stepUp === 0
      && counters.redis === 0
    ) {
      pass('delete 在 DB/审计/Redis/step-up 前 ACCOUNT_CLOSURE_NOT_AVAILABLE')
    } else {
      fail(`delete 零副作用失败 code=${deleteCode ?? 'none'} rows=${afterDeleteRows} audit=${afterDeleteAudits}`)
    }

    await consent.grantConsent(endUserId, 'job_ai', null)
    const revokeKey = randomUUID()
    const revoked = await requests.create(endUserId, 'revoke_consent', revokeKey, null, null)
    const replay = await requests.create(endUserId, 'revoke_consent', revokeKey, null, null)
    const [storedRevoke, activeConsent, revokeAudits] = await Promise.all([
      prisma.userDataRequest.findUnique({ where: { id: revoked.id } }),
      prisma.userAiConsent.count({ where: { endUserId, scope: 'job_ai', revokedAt: null } }),
      prisma.auditLog.count({ where: { targetId: revoked.id, action: 'member_ai_consent.revoke' } }),
    ])
    if (
      revoked.status === 'completed'
      && replay.id === revoked.id
      && storedRevoke?.status === 'completed'
      && storedRevoke.activeKey === null
      && activeConsent === 0
      && revokeAudits === 1
    ) {
      pass('revoke_consent 同事务撤回授权、完成请求、required audit 且幂等重放')
    } else {
      fail(`revoke_consent 真相不一致 request=${JSON.stringify(storedRevoke)} audits=${revokeAudits}`)
    }

    const exportCode = await captureCode(() => requests.create(
      endUserId,
      'export',
      randomUUID(),
      'must-not-be-consumed',
      null,
    ))
    const exportRows = await prisma.userDataRequest.count({ where: { endUserId, requestType: 'export' } })
    if (
      exportCode === 'DATA_REQUEST_QUEUE_UNAVAILABLE'
      && exportRows === 0
      && counters.stepUp === 0
      && counters.redis === 0
    ) {
      pass('队列缺失时 export fail closed，不消费 grant、不加锁、不创建伪记录')
    } else {
      fail(`export 队列门禁失败 code=${exportCode ?? 'none'} rows=${exportRows}`)
    }

    // reconciler 存在性：Wave 1-B 中断修复守卫
    const reconcilerMethods = Object.getOwnPropertyNames(MemberDataExportReconcilerService.prototype)
    const requiredReconcilerMethods = ['reconcile', 'reconcileRequest', 'sweep', 'cleanupOrphanFiles']
    const missingReconcilerMethods = requiredReconcilerMethods.filter((m) => !reconcilerMethods.includes(m))
    if (missingReconcilerMethods.length === 0) {
      pass(`MemberDataExportReconcilerService 具备 reconcile/reconcileRequest/sweep/cleanupOrphanFiles`)
    } else {
      fail(`MemberDataExportReconcilerService 缺少方法: ${missingReconcilerMethods.join(', ')}`)
    }

    // download-service 存在性：一次性 ticket claim 机制守卫
    const downloadMethods = Object.getOwnPropertyNames(MemberDataExportDownloadService.prototype)
    const requiredDownloadMethods = ['authorizeDownload', 'claimDownload', 'finishDownload', 'abortDownload']
    const missingDownloadMethods = requiredDownloadMethods.filter((m) => !downloadMethods.includes(m))
    if (missingDownloadMethods.length === 0) {
      pass(`MemberDataExportDownloadService 具备 authorizeDownload/claimDownload/finishDownload/abortDownload`)
    } else {
      fail(`MemberDataExportDownloadService 缺少方法: ${missingDownloadMethods.join(', ')}`)
    }

    // DATA_DELETION_ENABLED 开关：delete 始终 fail-closed（默认 false，无论环境变量值）
    const savedDeletionEnv = process.env['DATA_DELETION_ENABLED']
    process.env['DATA_DELETION_ENABLED'] = 'true'
    const deletionWithFlagCode = await captureCode(() => requests.create(
      endUserId,
      'delete',
      randomUUID(),
      null,
      null,
    ))
    if (savedDeletionEnv === undefined) delete process.env['DATA_DELETION_ENABLED']
    else process.env['DATA_DELETION_ENABLED'] = savedDeletionEnv
    // Wave 1-B 最小版：实际注销执行未实现，DATA_DELETION_ENABLED=true 仍返回 ACCOUNT_CLOSURE_NOT_AVAILABLE
    // （法务矩阵签字前不允许任何路径产生实际 PII 删除）
    if (deletionWithFlagCode === 'ACCOUNT_CLOSURE_NOT_AVAILABLE') {
      pass('DATA_DELETION_ENABLED=true 仍 fail-closed（注销执行尚未实现，法务矩阵未签字）')
    } else {
      fail(`DATA_DELETION_ENABLED=true 意外执行了删除路径 code=${deletionWithFlagCode ?? 'none（无异常！）'}`)
    }
  } finally {
    const requestIds = (await prisma.userDataRequest.findMany({
      where: { endUserId },
      select: { id: true },
    })).map((row) => row.id)
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [...requestIds, endUserId] } } })
    await prisma.userDataRequest.deleteMany({ where: { endUserId } })
    await prisma.userAiConsent.deleteMany({ where: { endUserId } })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
    await prisma.onModuleDestroy()
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} 项失败 — 用户数据请求真实状态守卫未通过\n`)
    process.exitCode = 1
    return
  }
  console.log('✅ ALL PASS — 数据请求状态与真实执行能力一致\n')
}

void main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(cleanupEnvironment)
