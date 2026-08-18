/**
 * 文件生命周期两条不变量 —— 真库行为门禁（CLAUDE.md §11）。
 *
 * 为什么必须用真 Prisma + 真 SQLite：本文件锁的两条不变量都是**数据库 where 语义**，
 * 而 services/api/scripts 下既有的文件门禁全部用手写 prisma 替身，其 updateMany 只认
 * 自己写死的那几个键（见 verify-file-retention.ts 的 `where.deletedAt` / `where.status`
 * 判断，以及 verify-file-delete-consistency.ts 里直接忽略 where 的 updateMany）。
 * 未知键在替身里恒真放行 —— 也就是说，无论 CAS 条件写成什么样，替身都会 count=1。
 * 用替身写这个门禁等于写一个永远绿的空转闸门。这里因此起一个独立的临时 SQLite 库，
 * 让 CAS 由真正的 SQL 判定。
 *
 * ── 不变量 1：清理必须 compare-and-swap，不得按陈旧快照删 ──────────────
 *   cleanupExpired 先 findMany 出候选，再逐条删。两者之间每条候选还要过
 *   fairMaterialPrintBridge.findFirst 与 hasActivePrintTaskForFile（后者把**所有**
 *   pending/claimed/printing 的 PrintTask 拉进内存再在 JS 里过滤），窗口不是微秒级。
 *   期间任何把 expiresAt 推到未来的并发写入都必须让这一条被跳过，而不是照删。
 *   今天就存在这样一个没有过期护栏的写入方：
 *   src/upload-sessions/upload-sessions.service.ts 的 bindMemberFile()（会员确认
 *   手机扫码上传时把匿名文件的 expiresAt 改成会员默认 90 天），它只挡 deletedAt，
 *   不看 expiresAt。本门禁用一次真实的并发 update 模拟这个交错。
 *
 * ── 不变量 2：物理对象删除失败必须留可重试账本，成功必须留删除日志 ────
 *   DB tombstone 必须先于对象存储删除写入，于是存在一个中间态：库里说"已删"、
 *   对象仍在。此前该中间态只有一行 logger.warn，而 cleanupExpired 只捞
 *   deletedAt=null，永远够不到这些行 —— 简历 / 身份证扫描件就此在对象存储里
 *   变成孤儿，且因为库里说已删，审计也查不出来。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:file-cleanup-cas-ledger
 * 本脚本自建并自删一个临时库，不触碰共享 dev.db，可与其它 verify 串行共存。
 */
import 'dotenv/config'
import 'reflect-metadata'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { closeSync, openSync, rmSync } from 'node:fs'
import path from 'node:path'
import { NotFoundException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { FilesService } from '../src/files/files.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const apiRoot = path.resolve(__dirname, '..')
const dbName = `verify-file-cas-ledger-${randomUUID().slice(0, 8)}.db`
const dbPath = path.join(apiRoot, 'prisma', dbName)
// 无条件自建临时库：这个门禁要写 FileObject 行并断言 deletedAt/status，
// 不能污染串行套件共享的 dev.db。
process.env['DATABASE_URL'] = `file:./prisma/${dbName}`
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
assertIsolatedVerificationDatabase()

let passed = 0
function pass(m: string): void {
  passed += 1
  console.log(`  PASS ${m}`)
}
function fail(m: string): never {
  console.error(`  FAIL ${m}`)
  throw new Error(`VERIFY FAILED: ${m}`)
}
function check(condition: boolean, m: string): void {
  if (!condition) fail(m)
  pass(m)
}
function eq(actual: unknown, expected: unknown, m: string): void {
  if (actual !== expected) fail(`${m} — 期望 ${String(expected)}，实际 ${String(actual)}`)
  pass(m)
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** 只对 fairMaterialPrintBridge.findFirst 挂钩子，其余委托真 Prisma。 */
function withInterleave(
  prisma: PrismaService,
  hook: (fileId: string) => Promise<void>
): PrismaService {
  return {
    fileObject: prisma.fileObject,
    printTask: prisma.printTask,
    fairMaterialPrintBridge: {
      findFirst: async (args: { where: { fileObjectId: string } }) => {
        await hook(args.where.fileObjectId)
        return prisma.fairMaterialPrintBridge.findFirst(args as never)
      },
      update: (args: unknown) => prisma.fairMaterialPrintBridge.update(args as never),
    },
  } as unknown as PrismaService
}

interface StorageStub {
  deleteObject(storageKey: string, bucket: string): Promise<void>
  deletedKeys: string[]
  failKeys: Set<string>
  signTtlSeconds: number
}

function makeStorage(): StorageStub {
  const stub: StorageStub = {
    deletedKeys: [],
    failKeys: new Set<string>(),
    signTtlSeconds: 1800,
    async deleteObject(storageKey: string) {
      if (stub.failKeys.has(storageKey)) {
        throw new Error('controlled object storage delete failure')
      }
      stub.deletedKeys.push(storageKey)
    },
  }
  return stub
}

interface AuditEntry {
  action: string
  payload: Record<string, unknown>
}

async function main(): Promise<void> {
  prepareDb()
  const prisma = new PrismaService()
  const auditEntries: AuditEntry[] = []
  const audit = {
    write: async (entry: AuditEntry) => {
      auditEntries.push(entry)
    },
  }
  const storage = makeStorage()

  const runId = randomUUID().slice(0, 8)
  const memberId = `casledger-member-${runId}`
  const key = (name: string) => `verify/${runId}/${name}.pdf`
  const fileId = (name: string) => `casledger-${runId}-${name}`

  async function seedFile(args: {
    name: string
    expiresAt: Date | null
    status?: string
    deletedAt?: Date | null
    storageDeletePendingAt?: Date | null
    storageDeletedAt?: Date | null
  }): Promise<string> {
    const id = fileId(args.name)
    await prisma.fileObject.create({
      data: {
        id,
        storageKey: key(args.name),
        bucket: 'private-files',
        region: 'local',
        filename: `${args.name}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1024,
        sha256: 'a'.repeat(64),
        endUserId: memberId,
        ownerType: 'user',
        ownerId: memberId,
        purpose: 'resume_upload',
        sensitiveLevel: 'sensitive',
        status: args.status ?? 'active',
        expiresAt: args.expiresAt,
        deletedAt: args.deletedAt ?? null,
        deletedBy: args.deletedAt ? 'auto' : null,
        assetCategory: 'original',
        retentionPolicy: 'system_short',
        retentionSetBy: 'system',
        storageDeletePendingAt: args.storageDeletePendingAt ?? null,
        storageDeletedAt: args.storageDeletedAt ?? null,
      },
    })
    return id
  }

  const row = async (id: string) => {
    const found = await prisma.fileObject.findUnique({ where: { id } })
    if (!found) fail(`测试数据丢失：${id}`)
    return found
  }

  try {
    await prisma.endUser.create({
      data: {
        id: memberId,
        phoneHash: `casledger-${runId}`,
        phoneEnc: 'verify-only',
        nickname: 'CAS 账本门禁',
      },
    })

    // ── 不变量 1：候选快照之后条件不再成立 → 必须跳过 ────────────────────
    const raced = await seedFile({ name: 'raced', expiresAt: new Date(Date.now() - HOUR) })
    const control = await seedFile({ name: 'control', expiresAt: new Date(Date.now() - HOUR) })

    let interleaved = false
    const racingPrisma = withInterleave(prisma, async (touchedId) => {
      if (touchedId !== raced || interleaved) return
      interleaved = true
      // 并发写入方（如 upload-sessions.bindMemberFile）把保存期限推到未来。
      // 它落在 findMany 快照之后、真正删除之前 —— 正是被复核的那个窗口。
      await prisma.fileObject.update({
        where: { id: raced },
        data: { expiresAt: new Date(Date.now() + 90 * DAY), retentionPolicy: 'months_3' },
      })
    })
    const racingFiles = new FilesService(racingPrisma, audit as never, storage as never)
    const cleanupResult = await racingFiles.cleanupExpired('manual')

    check(interleaved, '交错钩子确实在候选处理过程中触发（否则本用例什么都没测）')
    const racedRow = await row(raced)
    eq(racedRow.deletedAt, null, '条件已变化的候选不得被 tombstone')
    eq(racedRow.status, 'active', '条件已变化的候选不得被隔离（隔离即对外 404，等于事实删除）')
    check(
      !storage.deletedKeys.includes(key('raced')),
      '条件已变化的候选，其对象存储实体不得被删除'
    )
    check(
      !cleanupResult.deletedFileIds.includes(raced),
      '清理结果不得把被跳过的候选算成已删除'
    )

    // 下界：不能靠「谁都不删」来通过本门禁。
    const controlRow = await row(control)
    check(Boolean(controlRow.deletedAt), '条件仍成立的过期文件必须照常被清理')
    eq(controlRow.status, 'deleted', '条件仍成立的过期文件必须落 tombstone')
    check(storage.deletedKeys.includes(key('control')), '条件仍成立的过期文件必须真删对象')
    check(Boolean(controlRow.storageDeletedAt), '清理成功必须写物理删除日志（§11）')
    eq(controlRow.storageDeletePendingAt, null, '清理成功不得残留待重试标记')
    eq(cleanupResult.deletedFileIds.length, 1, '本轮只应删掉那一条条件仍成立的候选')

    // ── 不变量 2a：tombstone 后物理删除失败 → 落可重试账本 ────────────────
    const files = new FilesService(prisma, audit as never, storage as never)
    const orphan = await seedFile({ name: 'orphan', expiresAt: new Date(Date.now() + DAY) })
    storage.failKeys.add(key('orphan'))
    let rejected = false
    try {
      await files.ownerDelete(orphan, { kind: 'member', endUserId: memberId }, 'verify delete')
    } catch {
      rejected = true
    }
    check(rejected, '物理删除失败必须让删除调用失败，不得静默成功')
    const orphanRow = await row(orphan)
    check(Boolean(orphanRow.deletedAt), 'tombstone 仍必须先于对象删除写入（原有不变量）')
    eq(orphanRow.status, 'deleted', '物理删除失败不得把记录恢复成可访问状态')
    check(
      orphanRow.storageDeletePendingAt !== null,
      '物理删除失败必须落 storageDeletePendingAt，否则这行永远没人再碰（孤儿）'
    )
    eq(orphanRow.storageDeletedAt, null, '删除失败不得伪造物理删除日志')
    eq(orphanRow.storageDeleteAttempts, 1, '失败必须计入尝试次数')
    check(Boolean(orphanRow.storageDeleteError), '失败必须记录错误类型')
    check(
      !String(orphanRow.storageDeleteError).includes(key('orphan')),
      '错误字段不得回写对象键 / 文件名'
    )
    let stillHidden = false
    try {
      await files.getAccessUrl(orphan, { kind: 'member', endUserId: memberId }, 'inline')
    } catch (e) {
      stillHidden = e instanceof NotFoundException
    }
    check(stillHidden, '待重试的删除记录对外仍必须一律 404')

    // ── 不变量 2b：清理路径的物理删除失败也要落账本 ──────────────────────
    const quarantined = await seedFile({
      name: 'quarantined',
      expiresAt: new Date(Date.now() - HOUR),
    })
    storage.failKeys.add(key('quarantined'))
    const failedCleanup = await files.cleanupExpired('manual')
    eq(failedCleanup.deletedCount, 0, '物理删除失败的候选不得被计入已删除数')
    const quarantinedRow = await row(quarantined)
    eq(quarantinedRow.status, 'quarantined', '清理中途失败必须停在隔离态（对外 404）')
    check(
      quarantinedRow.storageDeletePendingAt !== null,
      '清理路径的物理删除失败同样必须落可重试账本'
    )

    // ── 不变量 2c：存量 / 未记账的已删除行不得被追溯重删 ──────────────────
    const legacy = await seedFile({
      name: 'legacy',
      expiresAt: new Date(Date.now() - DAY),
      status: 'deleted',
      deletedAt: new Date(Date.now() - DAY),
    })

    // ── 不变量 2d：对账轮次把孤儿收敛，并留删除日志 ──────────────────────
    storage.failKeys.clear()
    auditEntries.length = 0
    const reconciled = await files.reconcileStorageDeletions('cron')
    eq(reconciled.reconciledCount, 2, '两条待重试记录都必须在对账轮次里收敛')
    eq(reconciled.stillPendingCount, 0, '对账成功后不得仍标记为待重试')

    const orphanAfter = await row(orphan)
    check(Boolean(orphanAfter.storageDeletedAt), '对账成功必须写物理删除日志（§11）')
    eq(orphanAfter.storageDeletePendingAt, null, '对账成功必须清掉待重试标记')
    eq(orphanAfter.storageDeleteError, null, '对账成功必须清掉上次错误')
    check(storage.deletedKeys.includes(key('orphan')), '对账必须真的再删一次对象存储实体')

    const quarantinedAfter = await row(quarantined)
    check(Boolean(quarantinedAfter.storageDeletedAt), '隔离态记录对账后必须留物理删除日志')
    eq(
      quarantinedAfter.status,
      'deleted',
      '对象已确认删除后，隔离态必须补完 tombstone，不得永远卡在 quarantined'
    )
    check(Boolean(quarantinedAfter.deletedAt), '补完的 tombstone 必须有 deletedAt')

    const legacyAfter = await row(legacy)
    eq(legacyAfter.storageDeletedAt, null, '未记账的存量已删行不得被伪造成"已物理删除"')
    check(
      !storage.deletedKeys.includes(key('legacy')),
      '对账不得追溯扫描未记账的存量行去删对象（NULL 语义是"未知"，不是"待重试"）'
    )

    const reconcileAudit = auditEntries.filter((e) => e.action === 'file.storage_delete_reconciled')
    eq(reconcileAudit.length, 1, '对账 cron 必须写审计（§11 删除后须留删除日志）')
    eq(reconcileAudit[0]?.payload['reconciledCount'], 2, '审计必须如实记录收敛条数')

    // ── CAS 跳过必须被如实记账，而不是静默 ──────────────────────────────
    auditEntries.length = 0
    const skipped = await seedFile({ name: 'skipped', expiresAt: new Date(Date.now() - HOUR) })
    const skipPrisma = withInterleave(prisma, async (touchedId) => {
      if (touchedId !== skipped) return
      await prisma.fileObject.update({
        where: { id: skipped },
        data: { expiresAt: new Date(Date.now() + 90 * DAY) },
      })
    })
    await new FilesService(skipPrisma, audit as never, storage as never).cleanupExpired('cron')
    const cleanupAudit = auditEntries.filter((e) => e.action === 'file.cleanup_expired')
    eq(cleanupAudit.length, 1, 'CAS 跳过必须仍然产生一条清理审计')
    eq(
      cleanupAudit[0]?.payload['stateChangedCount'],
      1,
      '审计必须如实记录「条件已变化而被保留」的条数，不能静默丢弃'
    )
    eq(cleanupAudit[0]?.payload['deletedCount'], 0, '被保留的候选不得计入已删除数')

    console.log(`\nALL PASS (${passed})`)
  } finally {
    await prisma.onModuleDestroy().catch(() => undefined)
  }
}

main()
  .then(() => {
    cleanupDb()
  })
  .catch((error: unknown) => {
    console.error('\n', error)
    cleanupDb()
    process.exit(1)
  })

function prepareDb(): void {
  closeSync(openSync(dbPath, 'a'))
  try {
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push'], {
      cwd: apiRoot,
      stdio: 'pipe',
    })
  } catch (error) {
    const details = error as { stdout?: Buffer; stderr?: Buffer }
    console.error(details.stdout?.toString() ?? '')
    console.error(details.stderr?.toString() ?? '')
    cleanupDb()
    throw error
  }
}

function cleanupDb(): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    rmSync(`${dbPath}${suffix}`, { force: true })
  }
}
