/**
 * 管理员删除与清理审计的 PostgreSQL 变体。
 *
 * SQLite 门禁只有一条连接，看不出连接池上的两件事：
 * 1. updateMany 落墓碑之后，同事务里的 findUnique 必须读到未提交的墓碑。
 *    换到事务外的连接上，READ COMMITTED 读到的仍是旧行，事务会提交一条没有审计的墓碑。
 * 2. 同一条无审计墓碑上的并发重试，各自的事务都要写下这一次的审计。
 *
 * 审计插入失败时，墓碑必须跟审计一起回滚，对象不动。
 * DATABASE_URL 不是 PostgreSQL 时直接失败，避免误在 SQLite 上变绿。
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HttpException } from '@nestjs/common'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'

const jwtSecret = 'o1d-admin-delete-audit-pg-secret'

function errorOf(err: unknown): { code: string; message: string } {
  assert.ok(err instanceof HttpException, err instanceof Error ? err.stack ?? err.message : String(err))
  const body = err.getResponse()
  assert.equal(typeof body, 'object')
  const error = (body as { error?: { code?: string; message?: string } }).error
  assert.ok(error?.code, '错误响应缺少 code')
  assert.ok(error?.message, '错误响应缺少 message')
  return { code: error.code, message: error.message }
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? ''
  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    throw new Error('FILE_ADMIN_DELETE_AUDIT_VERIFY_POSTGRES_REQUIRED: DATABASE_URL must be PostgreSQL')
  }
  process.env['DATABASE_URL'] = url
  assertIsolatedVerificationDatabase()
  const storageDir = mkdtempSync(path.join(tmpdir(), 'o1d-file-audit-pg-'))
  process.env['FILE_STORAGE_DRIVER'] = 'local'
  process.env['FILE_STORAGE_DIR'] = storageDir
  process.env['FILE_SIGNING_SECRET'] ??= 'verify-file-admin-delete-audit-pg-0123456789'

  const [
    { PrismaService },
    { AuditService },
    { StorageService },
    { FilesService },
    { FilesController },
    { JwtService },
    { LOCAL_BUCKET_SENTINEL },
  ] = await Promise.all([
    import('../src/prisma/prisma.service'),
    import('../src/audit/audit.service'),
    import('../src/storage/storage.service'),
    import('../src/files/files.service'),
    import('../src/files/files.controller'),
    import('@nestjs/jwt'),
    import('../src/storage/storage.interface'),
  ])

  const prisma = new PrismaService()
  if (prisma.dbKind !== 'postgres') {
    throw new Error('FILE_ADMIN_DELETE_AUDIT_VERIFY_POSTGRES_REQUIRED')
  }
  await prisma.onModuleInit()

  const runId = randomBytes(4).toString('hex')
  const storage = new StorageService()
  const files = new FilesService(prisma, new AuditService(prisma), storage)
  const jwt = new JwtService({ secret: jwtSecret })
  const redis = {
    setJsonIfVersionNotOlder: async () => 'stored',
    get: async () => null,
  }
  const controller = new FilesController(files, new AuditService(prisma), jwt, redis as never, prisma)
  const adminId = `o1dpg_${runId}_admin`
  const orgId = `o1dpg_${runId}_org`
  const partnerId = `o1dpg_${runId}_partner`
  const fileIds: string[] = []
  let passed = 0

  const req = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
    ip: '127.0.0.1',
    requestId: `o1d-pg-${runId}`,
  })

  async function seedFile(name: string, owner?: { uploaderId: string; ownerId: string }): Promise<{ id: string; storageKey: string }> {
    const id = `o1dpg_${runId}_${name}`
    const storageKey = `resume_upload/o1dpg/${id}.pdf`
    await storage.putObject(storageKey, Buffer.from(name), 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id,
        storageKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: 'local',
        filename: `${name}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 4,
        sha256: 'a'.repeat(64),
        purpose: 'resume_upload',
        sensitiveLevel: 'sensitive',
        status: 'active',
        expiresAt: new Date(Date.now() + 86_400_000),
        assetCategory: 'original',
        retentionPolicy: 'system_short',
        retentionSetBy: 'system',
        ...(owner
          ? { uploaderId: owner.uploaderId, ownerType: 'partner', ownerId: owner.ownerId }
          : {}),
      },
    })
    fileIds.push(id)
    return { id, storageKey }
  }

  async function objectExists(storageKey: string): Promise<boolean> {
    const head = await storage.headObject(storageKey, LOCAL_BUCKET_SENTINEL)
    return head !== null
  }

  async function execSql(sql: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await (tx as unknown as { $executeRawUnsafe(query: string): Promise<number> }).$executeRawUnsafe(sql)
    })
  }

  async function installAuditFailure(): Promise<void> {
    await dropAuditFailure()
    await execSql(
      `CREATE FUNCTION o1d_audit_fail_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit insert failure'; END $$`,
    )
    await execSql(
      `CREATE TRIGGER o1d_audit_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION o1d_audit_fail_fn()`,
    )
  }

  async function dropAuditFailure(): Promise<void> {
    await execSql('DROP TRIGGER IF EXISTS o1d_audit_fail ON "AuditLog"')
    await execSql('DROP FUNCTION IF EXISTS o1d_audit_fail_fn()')
  }

  try {
    await prisma.user.create({
      data: {
        id: adminId,
        username: adminId,
        passwordHash: 'x',
        name: '审计必达',
        role: 'admin',
      },
    })
    const admin = { userId: adminId, role: 'admin' as const, orgId: null }
    const adminToken = jwt.sign({ sub: adminId, ver: 0 })
    await prisma.organization.create({
      data: { id: orgId, name: '审计机构', type: 'partner' },
    })
    await prisma.user.create({
      data: {
        id: partnerId,
        username: partnerId,
        passwordHash: 'x',
        name: '机构账号',
        role: 'partner',
        orgId,
      },
    })
    const partnerToken = jwt.sign({ sub: partnerId, ver: 0 })

    const reread = await seedFile('reread')
    const rollback = new Error('o1d-reread-rollback')
    try {
      await prisma.$transaction(async (tx) => {
        await tx.fileObject.updateMany({
          where: { id: reread.id, deletedAt: null },
          data: {
            deletedAt: new Date(),
            deletedBy: `admin:${adminId}`,
            deleteReason: 'reread',
            status: 'deleted',
          },
        })
        const current = await tx.fileObject.findUnique({
          where: { id: reread.id },
          select: { deletedAt: true, status: true },
        })
        assert.ok(current?.deletedAt, '同事务重读必须看见尚未提交的墓碑')
        assert.equal(current?.status, 'deleted')
        throw rollback
      })
      throw new Error('同事务重读的事务没有回滚')
    } catch (error) {
      if (error !== rollback) throw error
    }
    const rereadRow = await prisma.fileObject.findUnique({ where: { id: reread.id } })
    assert.equal(rereadRow?.deletedAt, null)
    assert.equal(rereadRow?.status, 'active')
    passed += 1
    console.log('PASS 1. updateMany 之后同事务重读看见墓碑，回滚后行仍是有效文件')

    const blocked = await seedFile('audit-fail')
    await installAuditFailure()
    try {
      const err = await controller.remove(blocked.id, 'manual delete', req(adminToken)).then(
        () => assert.fail('审计写不进时删除不该成功'),
        (error: unknown) => error,
      )
      const body = errorOf(err)
      assert.equal(body.code, 'ADMIN_USER_AUDIT_UNAVAILABLE')
      assert.match(body.message, /未删除/)
      const row = await prisma.fileObject.findUnique({ where: { id: blocked.id } })
      assert.equal(row?.deletedAt, null)
      assert.equal(row?.status, 'active')
      assert.equal(await objectExists(blocked.storageKey), true)
      assert.equal(await prisma.auditLog.count({ where: { action: 'file.delete', targetId: blocked.id } }), 0)
    } finally {
      await dropAuditFailure()
    }
    passed += 1
    console.log('PASS 2. 审计插入失败时墓碑回滚，对象还在，没有删除审计')

    const ok = await seedFile('delete-ok')
    const deleted = await controller.remove(ok.id, 'manual delete', req(adminToken))
    assert.equal(deleted.data.status, 'deleted')
    assert.equal(await objectExists(ok.storageKey), false)
    const okAudits = await prisma.auditLog.findMany({
      where: { action: 'file.delete', targetId: ok.id },
      select: { actorRole: true, actorId: true },
    })
    assert.equal(okAudits.length, 1)
    assert.equal(okAudits[0]?.actorRole, 'admin')
    assert.equal(okAudits[0]?.actorId, adminId)
    passed += 1
    console.log('PASS 3. 同事务重读确认墓碑后删除成功，恰好一条管理员审计，对象已删')

    const raced = await seedFile('concurrent', { uploaderId: partnerId, ownerId: orgId })
    const originalDelete = storage.deleteObject.bind(storage)
    storage.deleteObject = () => Promise.reject(new Error('injected storage delete failure'))
    try {
      const err = await controller.remove(raced.id, 'org delete', req(partnerToken)).then(
        () => assert.fail('机构删除在存储失败时不该成功'),
        (error: unknown) => error,
      )
      assert.ok(err instanceof Error)
      assert.match(err.message, /injected storage delete failure/)
    } finally {
      storage.deleteObject = originalDelete
    }
    const tombstone = await prisma.fileObject.findUnique({ where: { id: raced.id } })
    assert.ok(tombstone?.deletedAt)
    assert.equal(await objectExists(raced.storageKey), true)
    assert.equal(await prisma.auditLog.count({ where: { action: 'file.delete', targetId: raced.id } }), 0)

    const [first, second] = await Promise.all([
      controller.remove(raced.id, 'admin retry 1', req(adminToken)),
      controller.remove(raced.id, 'admin retry 2', req(adminToken)),
    ])
    assert.equal(first.data.status, 'deleted')
    assert.equal(second.data.status, 'deleted')
    assert.equal(await objectExists(raced.storageKey), false)
    const retryAudits = await prisma.auditLog.findMany({
      where: { action: 'file.delete', targetId: raced.id },
      select: { actorRole: true, actorId: true },
    })
    assert.equal(retryAudits.length, 2)
    assert.ok(retryAudits.every((row) => row.actorRole === 'admin' && row.actorId === adminId))
    passed += 1
    console.log('PASS 4. 同一条无审计墓碑并发重试各写一条审计，对象只删一次')

    console.log(`verify-file-admin-delete-audit-postgres: ${passed}/4 PASS`)
  } finally {
    await dropAuditFailure().catch(() => undefined)
    if (fileIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { targetId: { in: fileIds } } }).catch(() => undefined)
      await prisma.fileObject.deleteMany({ where: { id: { in: fileIds } } }).catch(() => undefined)
    }
    await prisma.auditLog.deleteMany({ where: { actorId: { in: [adminId, partnerId] } } }).catch(() => undefined)
    await prisma.user.deleteMany({ where: { id: { in: [partnerId, adminId] } } }).catch(() => undefined)
    await prisma.organization.deleteMany({ where: { id: orgId } }).catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
    rmSync(storageDir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
