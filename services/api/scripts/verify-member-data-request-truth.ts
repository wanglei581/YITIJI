/**
 * 用户数据请求真实状态集成守卫。
 *
 * SQLite 环境使用独立临时库并重放正式 migration；PostgreSQL readiness
 * 直接使用该 job 刚完成迁移的空库。两种路径都只实例化真实
 * PrismaService + AuditService + MemberPrivacyService，不启动完整 AppModule。
 */
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AuditService } from '../src/audit/audit.service'
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
  // Prisma 7.8 的本机 schema engine 在部分 macOS worktree 中不会创建缺失的
  // SQLite 文件；先创建空文件后仍由 migrate deploy 完整建立正式 schema。
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

async function expectHttpError(
  operation: () => Promise<unknown>,
  expectedCode: string,
  label: string,
): Promise<void> {
  try {
    await operation()
    fail(`${label} — 未 fail closed`)
  } catch (error) {
    const actualCode = errorCode(error)
    if (actualCode === expectedCode) pass(`${label} — ${expectedCode}`)
    else fail(`${label} — 错误码应为 ${expectedCode}，实际为 ${actualCode ?? (error as Error).message}`)
  }
}

async function main(): Promise<void> {
  console.log(`\n=== 用户数据请求真实状态守卫（${usesPostgres ? 'PostgreSQL' : '临时 SQLite'}）===`)

  const prisma = new PrismaService()
  const audit = new AuditService(prisma)
  const privacy = new MemberPrivacyService(prisma, audit)
  const tag = `wave0-data-rights-${Date.now()}-${process.pid}`
  const adminId = `${tag}-admin`
  const endUserId = `${tag}-member`

  await prisma.onModuleInit()
  try {
    await prisma.user.create({
      data: {
        id: adminId,
        username: adminId,
        passwordHash: 'verify-only-not-a-login-secret',
        name: 'Wave 0 Verify Admin',
        role: 'admin',
      },
    })
    await prisma.endUser.create({
      data: {
        id: endUserId,
        phoneHash: `${tag}-phone-hash`,
        phoneEnc: 'verify-only-encrypted-placeholder',
        nickname: 'Wave 0 Verify Member',
      },
    })

    const exportRequest = await privacy.createDataRequest(endUserId, 'export')
    const deleteRequest = await privacy.createDataRequest(endUserId, 'delete')
    const revokeRequest = await privacy.createDataRequest(endUserId, 'revoke_consent')

    await expectHttpError(
      () => privacy.handleDataRequest(exportRequest.id, { status: 'completed', handledBy: adminId }),
      'DATA_REQUEST_EXECUTION_INCOMPLETE',
      'export 请求不能在没有真实执行器时标记 completed',
    )
    await expectHttpError(
      () => privacy.handleDataRequest(deleteRequest.id, { status: 'completed', handledBy: adminId }),
      'DATA_REQUEST_EXECUTION_INCOMPLETE',
      'delete 请求不能在没有真实执行器时标记 completed',
    )
    await expectHttpError(
      () => privacy.handleDataRequest(deleteRequest.id, { status: 'rejected', handledBy: adminId }),
      'DATA_REQUEST_EXECUTION_INCOMPLETE',
      'delete 请求不能以普通拒绝替代真实闭环',
    )

    const revoked = await privacy.handleDataRequest(revokeRequest.id, {
      status: 'completed',
      handledBy: adminId,
    })
    if (revoked.status === 'completed') pass('revoke_consent 保持可同步完成')
    else fail(`revoke_consent 状态应为 completed，实际为 ${revoked.status}`)

    const [storedExport, storedDelete, protectedAudits] = await Promise.all([
      prisma.userDataRequest.findUnique({ where: { id: exportRequest.id } }),
      prisma.userDataRequest.findUnique({ where: { id: deleteRequest.id } }),
      prisma.auditLog.findMany({
        where: {
          action: 'member_data_request.handle',
          targetId: { in: [exportRequest.id, deleteRequest.id] },
        },
      }),
    ])

    if (storedExport?.status === 'pending' && storedExport.handledAt === null && storedExport.auditRef === null) {
      pass('export 失败尝试不改变请求状态或审计引用')
    } else {
      fail(`export 失败尝试污染请求：${JSON.stringify(storedExport)}`)
    }
    if (storedDelete?.status === 'pending' && storedDelete.handledAt === null && storedDelete.auditRef === null) {
      pass('delete completed/rejected 失败尝试均不改变请求状态或审计引用')
    } else {
      fail(`delete 失败尝试污染请求：${JSON.stringify(storedDelete)}`)
    }
    if (protectedAudits.length === 0) {
      pass('export/delete 失败尝试不写 completed/rejected 审计')
    } else {
      fail(`export/delete 失败尝试写入了 ${protectedAudits.length} 条审计`)
    }
  } finally {
    await prisma.auditLog.deleteMany({ where: { actorId: adminId } })
    await prisma.userDataRequest.deleteMany({ where: { endUserId } })
    await prisma.endUser.deleteMany({ where: { id: endUserId } })
    await prisma.user.deleteMany({ where: { id: adminId } })
    await prisma.onModuleDestroy()
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} 项失败 — 用户数据请求仍可产生虚假完成/拒绝状态\n`)
    process.exitCode = 1
    return
  }
  console.log('✅ ALL PASS — 用户数据请求状态与真实执行能力一致\n')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    cleanupEnvironment()
  })
