import 'dotenv/config'
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import { HttpException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { AuditService } from '../src/audit/audit.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import type { RedisService } from '../src/common/redis/redis.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { StorageService } from '../src/storage/storage.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { MANUAL_CLEANUP_BATCH_SIZE } from '../src/files/admin-required-audit'
import { FilesController } from '../src/files/files.controller'
import { FilesService } from '../src/files/files.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const apiRoot = path.resolve(__dirname, '..')
const dbName = `verify-file-admin-delete-audit-${randomUUID().slice(0, 8)}.db`
const dbPath = path.join(apiRoot, 'prisma', dbName)
const storageDir = mkdtempSync(path.join(tmpdir(), 'o1-file-audit-'))
const jwtSecret = 'o1-admin-delete-audit-test-secret'

process.env['DATABASE_URL'] = `file:./prisma/${dbName}`
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
process.env['FILE_STORAGE_DRIVER'] = 'local'
process.env['FILE_STORAGE_DIR'] = storageDir
delete process.env['ADMIN_IP_ALLOWLIST']

const AUDIT_FAIL_TRIGGER = `
CREATE TRIGGER o1_audit_fail
BEFORE INSERT ON "AuditLog"
BEGIN
  SELECT RAISE(ABORT, 'injected audit insert failure');
END`

let prisma: PrismaService
let files: FilesService
let controller: FilesController
let storage: StorageService
let admin: AuthedUser
let token = ''
let partnerToken = ''
let partnerUserId = ''
let orgId = ''

function prepareDb(): void {
  assertIsolatedVerificationDatabase()
  closeSync(openSync(dbPath, 'a'))
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push'], {
      cwd: apiRoot,
      stdio: 'pipe',
      env: process.env,
    })
  } catch (error) {
    const details = error as { stdout?: Buffer; stderr?: Buffer }
    console.error(details.stdout?.toString() ?? '')
    console.error(details.stderr?.toString() ?? '')
    throw error
  }
}

async function execSql(sql: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await (tx as unknown as { $executeRawUnsafe(query: string): Promise<number> }).$executeRawUnsafe(sql)
  })
}

async function setAuditInsertFailure(enabled: boolean): Promise<void> {
  await execSql('DROP TRIGGER IF EXISTS o1_audit_fail')
  if (enabled) await execSql(AUDIT_FAIL_TRIGGER)
}

function req(authToken = token): {
  headers: Record<string, string>
  ip: string
  requestId: string
} {
  return {
    headers: { authorization: `Bearer ${authToken}` },
    ip: '127.0.0.1',
    requestId: 'o1-file-audit',
  }
}

function errorOf(err: unknown): { code: string; message: string } {
  assert.ok(err instanceof HttpException, err instanceof Error ? err.stack ?? err.message : String(err))
  const body = err.getResponse()
  assert.equal(typeof body, 'object')
  const error = (body as { error?: { code?: string; message?: string } }).error
  assert.ok(error?.code, '错误响应缺少 code')
  assert.ok(error?.message, '错误响应缺少 message')
  return { code: error.code, message: error.message }
}

async function seedFile(
  name: string,
  expiresAt: Date,
  owner?: { uploaderId: string; ownerId: string },
): Promise<{ id: string; storageKey: string }> {
  const id = `o1-${name}-${randomUUID().slice(0, 8)}`
  const storageKey = `resume_upload/o1/${id}.pdf`
  await storage.putObject(storageKey, Buffer.from(`o1-${name}`), 'application/pdf', LOCAL_BUCKET_SENTINEL)
  await prisma.fileObject.create({
    data: {
      id,
      storageKey,
      bucket: LOCAL_BUCKET_SENTINEL,
      region: 'local',
      filename: `${name}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: 8,
      sha256: 'a'.repeat(64),
      purpose: 'resume_upload',
      sensitiveLevel: 'sensitive',
      status: 'active',
      expiresAt,
      assetCategory: 'original',
      retentionPolicy: 'system_short',
      retentionSetBy: 'system',
      ...(owner
        ? {
            uploaderId: owner.uploaderId,
            ownerType: 'partner',
            ownerId: owner.ownerId,
          }
        : {}),
    },
  })
  return { id, storageKey }
}

/** 机构删自己的文件时存储删除失败：留下墓碑和对象，控制器到不了后面的普通审计。 */
async function leaveUnauditedOrgTombstone(name: string): Promise<{ id: string; storageKey: string }> {
  const file = await seedFile(name, new Date(Date.now() + 86_400_000), {
    uploaderId: partnerUserId,
    ownerId: orgId,
  })
  const originalDelete = storage.deleteObject.bind(storage)
  storage.deleteObject = () => Promise.reject(new Error('injected storage delete failure'))
  try {
    const err = await controller.remove(file.id, 'org delete', req(partnerToken)).then(
      () => assert.fail('机构删除在存储失败时不该成功'),
      (error: unknown) => error,
    )
    assert.ok(err instanceof Error)
    assert.match(err.message, /injected storage delete failure/)
  } finally {
    storage.deleteObject = originalDelete
  }
  const row = await prisma.fileObject.findUnique({ where: { id: file.id } })
  assert.ok(row?.deletedAt)
  assert.equal(row?.status, 'deleted')
  assert.equal(await objectExists(file.storageKey), true)
  assert.equal(await auditCount('file.delete', file.id), 0)
  return file
}

async function objectExists(storageKey: string): Promise<boolean> {
  const head = await storage.headObject(storageKey, LOCAL_BUCKET_SENTINEL)
  return head !== null
}

async function auditCount(action: string, targetId: string | null): Promise<number> {
  return prisma.auditLog.count({ where: { action, targetId } })
}

async function newCleanupAudits(beforeIds: Set<string>): Promise<Array<{ payloadJson: string }>> {
  const rows = await prisma.auditLog.findMany({
    where: { action: 'file.cleanup_expired' },
    select: { id: true, payloadJson: true },
  })
  return rows.filter((row) => !beforeIds.has(row.id)).map((row) => ({ payloadJson: row.payloadJson }))
}

async function cleanupAuditIds(): Promise<Set<string>> {
  const rows = await prisma.auditLog.findMany({
    where: { action: 'file.cleanup_expired' },
    select: { id: true },
  })
  return new Set(rows.map((row) => row.id))
}

describe('管理员删除与手动清理的审计必达', { concurrency: 1 }, () => {
  before(async () => {
    prepareDb()
    prisma = new PrismaService()
    storage = new StorageService()
    files = new FilesService(prisma, new AuditService(prisma), storage)
    const jwt = new JwtService({ secret: jwtSecret })
    const redis = {
      setJsonIfVersionNotOlder: async () => 'stored',
      get: async () => null,
    } as unknown as RedisService
    controller = new FilesController(files, new AuditService(prisma), jwt, redis, prisma)
    const userId = `o1-admin-${randomUUID().slice(0, 8)}`
    await prisma.user.create({
      data: {
        id: userId,
        username: userId,
        passwordHash: 'x',
        name: '审计必达',
        role: 'admin',
      },
    })
    admin = { userId, role: 'admin', orgId: null }
    token = jwt.sign({ sub: userId, ver: 0 })
    orgId = `o1-org-${randomUUID().slice(0, 8)}`
    await prisma.organization.create({
      data: { id: orgId, name: '审计机构', type: 'partner' },
    })
    partnerUserId = `o1-partner-${randomUUID().slice(0, 8)}`
    await prisma.user.create({
      data: {
        id: partnerUserId,
        username: partnerUserId,
        passwordHash: 'x',
        name: '机构账号',
        role: 'partner',
        orgId,
      },
    })
    partnerToken = jwt.sign({ sub: partnerUserId, ver: 0 })
  }, { timeout: 180_000 })

  after(async () => {
    await prisma?.onModuleDestroy().catch(() => undefined)
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      rmSync(`${dbPath}${suffix}`, { force: true })
    }
    rmSync(storageDir, { recursive: true, force: true })
  })

  test('审计写入失败时删除返回错误，库里的行和存储对象都还在', async () => {
    const file = await seedFile('delete-fail', new Date(Date.now() + 86_400_000))
    await setAuditInsertFailure(true)
    const err = await controller.remove(file.id, 'manual delete', req()).then(
      () => assert.fail('删除不该成功'),
      (error: unknown) => error,
    )
    const body = errorOf(err)
    assert.equal(body.code, 'ADMIN_USER_AUDIT_UNAVAILABLE')
    assert.match(body.message, /未删除/)
    const row = await prisma.fileObject.findUnique({ where: { id: file.id } })
    assert.equal(row?.deletedAt, null)
    assert.equal(row?.status, 'active')
    assert.equal(await objectExists(file.storageKey), true)
    assert.equal(await auditCount('file.delete', file.id), 0)
  })

  test('正常删除恰好留下一条审计', async () => {
    const file = await seedFile('delete-ok', new Date(Date.now() + 86_400_000))
    await setAuditInsertFailure(false)
    const result = await controller.remove(file.id, 'manual delete', req())
    assert.equal(result.data.id, file.id)
    assert.equal(result.data.status, 'deleted')
    assert.equal(await auditCount('file.delete', file.id), 1)
    assert.equal(await objectExists(file.storageKey), false)
    const row = await prisma.fileObject.findUnique({ where: { id: file.id } })
    assert.ok(row?.deletedAt)
  })

  test('清理时审计写入失败则文件还在，成功时恰好一条审计', async () => {
    const failed = await seedFile('cleanup-fail', new Date(Date.now() - 3_600_000))
    await setAuditInsertFailure(true)
    const beforeFail = await auditCount('file.cleanup_expired', null)
    const err = await controller.cleanupExpired(admin, req()).then(
      () => assert.fail('清理不该成功'),
      (error: unknown) => error,
    )
    const body = errorOf(err)
    assert.equal(body.code, 'ADMIN_USER_AUDIT_UNAVAILABLE')
    assert.match(body.message, /未删除/)
    const failedRow = await prisma.fileObject.findUnique({ where: { id: failed.id } })
    assert.equal(failedRow?.deletedAt, null)
    assert.equal(failedRow?.status, 'active')
    assert.equal(await objectExists(failed.storageKey), true)
    assert.equal(await auditCount('file.cleanup_expired', null), beforeFail)

    const ok = await seedFile('cleanup-ok', new Date(Date.now() - 3_600_000))
    await setAuditInsertFailure(false)
    const result = await controller.cleanupExpired(admin, req())
    assert.equal(result.data.deletedCount, 2)
    assert.ok(result.data.deletedFileIds.includes(failed.id))
    assert.ok(result.data.deletedFileIds.includes(ok.id))
    assert.equal(await auditCount('file.cleanup_expired', null), beforeFail + 1)
    assert.equal(await objectExists(failed.storageKey), false)
    assert.equal(await objectExists(ok.storageKey), false)
  })

  test('正在打印的文件删除被拒时没有已删除审计', async () => {
    const file = await seedFile('in-use', new Date(Date.now() + 86_400_000))
    await setAuditInsertFailure(false)
    await prisma.printTask.create({
      data: {
        id: `pt-${file.id}`,
        fileId: file.id,
        fileUrl: `https://example.invalid/files/${file.id}`,
        fileMd5: 'b'.repeat(32),
        status: 'printing',
      },
    })
    const err = await controller.remove(file.id, 'manual delete', req()).then(
      () => assert.fail('正在打印的文件不该删除'),
      (error: unknown) => error,
    )
    const body = errorOf(err)
    assert.equal(body.code, 'FILE_IN_USE')
    assert.equal(await auditCount('file.delete', file.id), 0)
    const row = await prisma.fileObject.findUnique({ where: { id: file.id } })
    assert.equal(row?.deletedAt, null)
    assert.equal(await objectExists(file.storageKey), true)
  })

  test('已有无审计墓碑时，管理员重试若审计写不进则报错且对象还在', async () => {
    const file = await leaveUnauditedOrgTombstone('tombstone-audit-fail')
    await setAuditInsertFailure(true)
    try {
      const err = await controller.remove(file.id, 'manual delete', req()).then(
        () => assert.fail('墓碑重试在审计失败时不该删掉对象'),
        (error: unknown) => error,
      )
      const body = errorOf(err)
      assert.equal(body.code, 'ADMIN_USER_AUDIT_UNAVAILABLE')
      assert.match(body.message, /未删除/)
      const row = await prisma.fileObject.findUnique({ where: { id: file.id } })
      assert.ok(row?.deletedAt)
      assert.equal(row?.status, 'deleted')
      assert.equal(await objectExists(file.storageKey), true)
      assert.equal(await auditCount('file.delete', file.id), 0)
    } finally {
      await setAuditInsertFailure(false)
    }
  })

  test('已有无审计墓碑时，管理员重试审计成功就删掉对象并留下恰好一条管理员审计', async () => {
    const file = await leaveUnauditedOrgTombstone('tombstone-audit-ok')
    await setAuditInsertFailure(false)
    const result = await controller.remove(file.id, 'manual delete', req())
    assert.equal(result.data.id, file.id)
    assert.equal(result.data.status, 'deleted')
    assert.equal(await objectExists(file.storageKey), false)
    const audits = await prisma.auditLog.findMany({
      where: { action: 'file.delete', targetId: file.id },
      select: { actorRole: true, actorId: true },
    })
    assert.equal(audits.length, 1)
    assert.equal(audits[0]?.actorRole, 'admin')
    assert.equal(audits[0]?.actorId, admin.userId)
  })

  test('管理员自己留下的墓碑，每次重试各写一条这一次的审计', async () => {
    const file = await seedFile('admin-tomb', new Date(Date.now() + 86_400_000))
    await setAuditInsertFailure(false)
    const originalDelete = storage.deleteObject.bind(storage)
    storage.deleteObject = () => Promise.reject(new Error('injected storage delete failure'))
    try {
      const err = await controller.remove(file.id, 'admin first', req()).then(
        () => assert.fail('存储失败时不该成功'),
        (error: unknown) => error,
      )
      assert.ok(err instanceof Error)
      assert.match(err.message, /injected storage delete failure/)
    } finally {
      storage.deleteObject = originalDelete
    }
    assert.equal(await objectExists(file.storageKey), true)
    assert.equal(await auditCount('file.delete', file.id), 1)
    const tombstone = await prisma.fileObject.findUnique({ where: { id: file.id } })
    assert.ok(tombstone?.deletedAt)
    assert.equal(tombstone?.status, 'deleted')

    await setAuditInsertFailure(true)
    try {
      const err = await controller.remove(file.id, 'admin second', req()).then(
        () => assert.fail('审计失败时不该删掉对象'),
        (error: unknown) => error,
      )
      const body = errorOf(err)
      assert.equal(body.code, 'ADMIN_USER_AUDIT_UNAVAILABLE')
      assert.match(body.message, /未删除/)
      assert.equal(await objectExists(file.storageKey), true)
      assert.equal(await auditCount('file.delete', file.id), 1)
      const unchanged = await prisma.fileObject.findUnique({ where: { id: file.id } })
      assert.equal(unchanged?.deletedAt?.toISOString(), tombstone?.deletedAt?.toISOString())
      assert.equal(unchanged?.status, 'deleted')
    } finally {
      await setAuditInsertFailure(false)
    }

    const result = await controller.remove(file.id, 'admin third', req())
    assert.equal(result.data.id, file.id)
    assert.equal(result.data.status, 'deleted')
    assert.equal(await objectExists(file.storageKey), false)
    const audits = await prisma.auditLog.findMany({
      where: { action: 'file.delete', targetId: file.id },
      select: { actorRole: true, actorId: true },
    })
    assert.equal(audits.length, 2)
    assert.ok(audits.every((row) => row.actorRole === 'admin' && row.actorId === admin.userId))
  })

  test('手动清理没有任何候选时仍写一条汇总审计', async () => {
    await setAuditInsertFailure(false)
    await controller.cleanupExpired(admin, req())
    const beforeIds = await cleanupAuditIds()
    const result = await controller.cleanupExpired(admin, req())
    assert.equal(result.data.deletedCount, 0)
    assert.equal(result.data.remainingCount, 0)
    assert.deepEqual(result.data.deletedFileIds, [])
    const mine = await newCleanupAudits(beforeIds)
    assert.equal(mine.length, 1)
    const payload = JSON.parse(mine[0]?.payloadJson ?? '{}') as { deletedCount?: number; fileIds?: string[] }
    assert.equal(payload.deletedCount, 0)
    assert.deepEqual(payload.fileIds ?? [], [])
    const row = await prisma.auditLog.findFirst({
      where: { action: 'file.cleanup_expired', id: { notIn: [...beforeIds] } },
      select: { actorRole: true, actorId: true },
    })
    assert.equal(row?.actorRole, 'admin')
    assert.equal(row?.actorId, admin.userId)
  })

  test('清理候选在落墓碑前被机构抢先删成墓碑时，不物理删对象，仍写汇总审计', async () => {
    await setAuditInsertFailure(false)
    await controller.cleanupExpired(admin, req())
    const raced = await seedFile('cas-miss', new Date(Date.now() - 3_600_000), {
      uploaderId: partnerUserId,
      ownerId: orgId,
    })
    const plain = await seedFile('cas-plain', new Date(Date.now() - 3_600_000))
    const svc = files as unknown as {
      hasActivePrintTaskForFile(id: string): Promise<boolean>
    }
    const original = svc.hasActivePrintTaskForFile.bind(files)
    svc.hasActivePrintTaskForFile = async (id: string) => {
      if (id === raced.id) {
        await prisma.fileObject.update({
          where: { id },
          data: {
            deletedAt: new Date(),
            deletedBy: `user:${partnerUserId}`,
            deleteReason: 'org race',
            status: 'deleted',
            storageDeletePendingAt: new Date(),
            storageDeleteAttempts: 1,
            storageDeleteError: 'Error',
          },
        })
      }
      return original(id)
    }
    const beforeIds = await cleanupAuditIds()
    try {
      const result = await controller.cleanupExpired(admin, req())
      assert.ok(result.data.deletedFileIds.includes(plain.id))
      assert.equal(result.data.deletedFileIds.includes(raced.id), false)
      assert.equal(await objectExists(raced.storageKey), true)
      assert.equal(await objectExists(plain.storageKey), false)
      const mine = await newCleanupAudits(beforeIds)
      assert.equal(mine.length, 1)
      const payload = JSON.parse(mine[0]?.payloadJson ?? '{}') as { fileIds?: string[] }
      const fileIds = payload.fileIds ?? []
      assert.equal(fileIds.includes(raced.id), false)
      assert.ok(fileIds.includes(plain.id))
      const racedRow = await prisma.fileObject.findUnique({ where: { id: raced.id } })
      assert.equal(racedRow?.status, 'deleted')
      assert.equal(racedRow?.deletedBy, `user:${partnerUserId}`)
    } finally {
      svc.hasActivePrintTaskForFile = original
    }
  })

  test('两批半过期文件全部清完，汇总审计条数与批数一致', async () => {
    assert.equal(MANUAL_CLEANUP_BATCH_SIZE % 2, 0)
    const total = (MANUAL_CLEANUP_BATCH_SIZE * 5) / 2
    const expectedBatches = Math.ceil(total / MANUAL_CLEANUP_BATCH_SIZE)
    await setAuditInsertFailure(false)
    await controller.cleanupExpired(admin, req())
    const seeded: Array<{ id: string; storageKey: string }> = []
    for (let index = 0; index < total; index += 1) {
      seeded.push(await seedFile(`batch-ok-${index}`, new Date(Date.now() - 3_600_000)))
    }
    const beforeIds = await cleanupAuditIds()
    const result = await controller.cleanupExpired(admin, req())
    assert.equal(result.data.deletedCount, total)
    assert.equal(result.data.remainingCount, 0)
    assert.equal(result.data.deletedFileIds.length, total)
    for (const file of seeded) {
      assert.ok(result.data.deletedFileIds.includes(file.id))
      assert.equal(await objectExists(file.storageKey), false)
      const row = await prisma.fileObject.findUnique({ where: { id: file.id } })
      assert.ok(row?.deletedAt)
      assert.equal(row?.status, 'deleted')
    }
    const mine = await newCleanupAudits(beforeIds)
    assert.equal(mine.length, expectedBatches)
    const cleaned = mine.reduce((sum, row) => {
      const payload = JSON.parse(row.payloadJson) as { deletedCount?: number }
      return sum + (payload.deletedCount ?? 0)
    }, 0)
    assert.equal(cleaned, total)
  })

  test('第二批审计写不进时，只回滚这一批，已清的批次保留，并说明还剩几个', async () => {
    assert.equal(MANUAL_CLEANUP_BATCH_SIZE % 2, 0)
    const total = (MANUAL_CLEANUP_BATCH_SIZE * 5) / 2
    await setAuditInsertFailure(false)
    await controller.cleanupExpired(admin, req())
    const seeded: Array<{ id: string; storageKey: string }> = []
    for (let index = 0; index < total; index += 1) {
      seeded.push(await seedFile(`batch-fail-${index}`, new Date(Date.now() - 3_600_000)))
    }
    const beforeIds = await cleanupAuditIds()
    await execSql('DROP TRIGGER IF EXISTS o1_audit_fail_second_cleanup')
    await execSql(`
CREATE TRIGGER o1_audit_fail_second_cleanup
BEFORE INSERT ON "AuditLog"
WHEN NEW."action" = 'file.cleanup_expired'
 AND (SELECT COUNT(*) FROM "AuditLog" WHERE "action" = 'file.cleanup_expired') >= ${beforeIds.size + 1}
BEGIN
  SELECT RAISE(ABORT, 'injected second batch audit failure');
END`)
    try {
      const err = await controller.cleanupExpired(admin, req()).then(
        () => assert.fail('第二批审计失败时不该把后面的文件也清掉'),
        (error: unknown) => error,
      )
      const body = errorOf(err)
      assert.equal(body.code, 'ADMIN_USER_AUDIT_UNAVAILABLE')
      assert.match(body.message, /未删除/)
      assert.match(body.message, /请稍后重试/)
      assert.match(body.message, new RegExp(`已清理 ${MANUAL_CLEANUP_BATCH_SIZE} 个`))
      assert.match(body.message, new RegExp(`还剩 ${total - MANUAL_CLEANUP_BATCH_SIZE} 个`))
      const rows = await prisma.fileObject.findMany({
        where: { id: { in: seeded.map((file) => file.id) } },
        select: { id: true, deletedAt: true, status: true, storageKey: true },
      })
      const cleaned = rows.filter((row) => row.deletedAt)
      const left = rows.filter((row) => !row.deletedAt)
      assert.equal(cleaned.length, MANUAL_CLEANUP_BATCH_SIZE)
      assert.equal(left.length, total - MANUAL_CLEANUP_BATCH_SIZE)
      for (const row of cleaned) {
        assert.equal(row.status, 'deleted')
        assert.equal(await objectExists(row.storageKey), false)
      }
      for (const row of left) {
        assert.equal(row.status, 'active')
        assert.equal(await objectExists(row.storageKey), true)
      }
      const mine = await newCleanupAudits(beforeIds)
      assert.equal(mine.length, 1)
      const payload = JSON.parse(mine[0]?.payloadJson ?? '{}') as { deletedCount?: number; fileIds?: string[] }
      assert.equal(payload.deletedCount, MANUAL_CLEANUP_BATCH_SIZE)
      assert.deepEqual(new Set(payload.fileIds ?? []), new Set(cleaned.map((row) => row.id)))
    } finally {
      await execSql('DROP TRIGGER IF EXISTS o1_audit_fail_second_cleanup')
    }
  })
})
