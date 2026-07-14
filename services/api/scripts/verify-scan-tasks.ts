import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-scan-tasks-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '../src/generated/prisma/client'
import { createPrismaClient, dbKindOf } from '../src/prisma/create-client'
import { ScanTaskReaperTask } from '../src/scan-tasks/scan-task-reaper.task'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import type { CreateScanTaskDto } from '../src/scan-tasks/dto/create-scan-task.dto'
// B1-11 follow-up：真实 DB 端到端跑一遍 deliverScanFile() 的内容级去重护栏，需要真实
// AuditService / StorageService / FilesService（而不是本文件的 FakeFilesService）——
// 见 assertRealDbDedupGuardClosesCrossUserLeak() 顶部注释说明为什么必须是这三个真实服务。
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { FilesService } from '../src/files/files.service'

// Task 10 能力门禁直通 stub：门禁真实语义由 verify:admin-print-scan 覆盖，
// 本脚本聚焦扫描任务状态机，不重复测门禁。
const passthroughCapabilities = { assertUserTaskAllowed: async () => undefined } as never

interface StoredScanTask {
  id: string
  terminalId: string
  scanType: string
  status: string
  endUserId: string | null
  fileId: string | null
  matchedFileMtime: Date | null
  errorCode: string | null
  errorMessage: string | null
  controlTokenHash: string | null
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

interface StoredFileObject {
  id: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  purpose: string
  endUserId: string | null
  deletedAt: Date | null
}

/**
 * 最小合法 PDF 字节(魔数 %PDF 开头)。真实 FilesService.upload 现在做魔数校验
 * (files/content-sniff.ts),扫描投递 fixture 与真机行为保持同款字节形态。
 * 按仓库测试惯例本地复制 helper(参考 verify-admin-fairs.ts 的 tinyPdf)。
 */
function tinyPdf(): Buffer {
  return Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n', 'latin1')
}

/** 兼容真实 Prisma 调用形态：status 既可能是裸字符串，也可能是 `{ in: [...] }`（cancel() 的 CAS 用后者）。 */
type StatusMatcher = string | { in: string[] }

function statusMatches(current: string, matcher: StatusMatcher): boolean {
  return typeof matcher === 'string' ? current === matcher : matcher.in.includes(current)
}

class FakePrisma {
  private seq = 1
  readonly scanTasksById = new Map<string, StoredScanTask>()
  readonly filesById = new Map<string, StoredFileObject>()
  readonly terminals = new Map<string, { id: string; enabled: boolean; terminalCode: string }>()

  constructor() {
    this.terminals.set('t_1', { id: 't_1', enabled: true, terminalCode: 'T-001' })
    this.terminals.set('t_disabled', { id: 't_disabled', enabled: false, terminalCode: 'T-002' })
    // B1-5 多行 reap 测试需要第二个独立启用的终端（证明一次 reap 能跨终端一起收敛，
    // 不是只测同一终端的两条行）。
    this.terminals.set('t_2', { id: 't_2', enabled: true, terminalCode: 'T-003' })
  }

  readonly terminal = {
    findFirst: async ({ where }: { where: { OR: Array<{ id?: string; terminalCode?: string }> } }) => {
      const ref = where.OR[0]?.id ?? where.OR[1]?.terminalCode
      for (const t of this.terminals.values()) {
        if (t.id === ref || t.terminalCode === ref) return t
      }
      return null
    },
  }

  readonly scanTask = {
    create: async ({ data }: { data: Partial<StoredScanTask> }) => {
      const id = `scan_${this.seq++}`
      const now = new Date()
      const record: StoredScanTask = {
        id,
        terminalId: data.terminalId!,
        scanType: data.scanType!,
        status: 'waiting',
        endUserId: data.endUserId ?? null,
        fileId: null,
        matchedFileMtime: null,
        errorCode: null,
        errorMessage: null,
        controlTokenHash: data.controlTokenHash ?? null,
        expiresAt: data.expiresAt!,
        createdAt: now,
        updatedAt: now,
      }
      this.scanTasksById.set(id, record)
      return { id }
    },
    findUnique: async ({ where }: { where: { id: string } }) => this.scanTasksById.get(where.id) ?? null,
    findFirst: async ({ where }: { where: { terminalId: string; status: string; expiresAt: { gt: Date } } }) => {
      const candidates = Array.from(this.scanTasksById.values())
        .filter(
          (t) =>
            t.terminalId === where.terminalId &&
            t.status === where.status &&
            t.expiresAt.getTime() > where.expiresAt.gt.getTime(),
        )
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      return candidates[0] ?? null
    },
    // 服务层所有写路径都必须走 CAS 的 updateMany（无条件 update 会绕开状态匹配检查），
    // 这里刻意不提供 update() 方法——如果服务代码回退到无条件 update，测试会直接因方法不存在而报错，
    // 而不是悄悄通过。
    //
    // 支持两种调用形态：
    //   1) 服务层的单行 CAS：{ where: { id, status } }（status 命中才更新，返回 count 0|1）
    //   2) B1-5 reaper 的批量收敛：{ where: { status, updatedAt: { lt } } }（无 id，可能命中多行）
    updateMany: async ({
      where,
      data,
    }: {
      where: { id?: string; status?: StatusMatcher; updatedAt?: { lt: Date } }
      data: Partial<StoredScanTask>
    }) => {
      const matches = Array.from(this.scanTasksById.values()).filter((t) => {
        if (where.id !== undefined && t.id !== where.id) return false
        if (where.status !== undefined && !statusMatches(t.status, where.status)) return false
        if (where.updatedAt?.lt !== undefined && !(t.updatedAt.getTime() < where.updatedAt.lt.getTime())) return false
        return true
      })
      for (const m of matches) {
        this.scanTasksById.set(m.id, { ...m, ...data, updatedAt: new Date() })
      }
      return { count: matches.length }
    },
    // B1-11：内容级去重需要查"该终端最近一段时间内、真正建档完成过（fileId 非空）的任务"，
    // 形态和既有的单条 findFirst 不同（需要返回多条），故单独提供一个 findMany。
    findMany: async ({
      where,
      select,
    }: {
      where: { terminalId: string; fileId: { not: null }; updatedAt: { gt: Date } }
      select?: { fileId: true }
    }) => {
      const matches = Array.from(this.scanTasksById.values()).filter(
        (t) =>
          t.terminalId === where.terminalId &&
          t.fileId !== null &&
          t.updatedAt.getTime() > where.updatedAt.gt.getTime(),
      )
      void select
      return matches.map((t) => ({ fileId: t.fileId }))
    },
  }

  readonly fileObject = {
    findUnique: async ({ where }: { where: { id: string } }) => this.filesById.get(where.id) ?? null,
    // B1-11：内容级去重的第二步——在候选 fileId 集合里找 sha256 完全一致的一条。
    findFirst: async ({
      where,
    }: {
      where: { id: { in: string[] }; sha256: string }
    }) => {
      for (const id of where.id.in) {
        const record = this.filesById.get(id)
        if (record && record.sha256 === where.sha256) return { id: record.id }
      }
      return null
    },
  }
}

class FakeFilesService {
  private seq = 1
  /** B1-6：记录 systemDelete() 的每次调用，供孤儿文件补偿删除测试断言真正调用发生且参数正确。 */
  readonly systemDeleteCalls: Array<{ fileId: string; reason: string }> = []

  constructor(private readonly prisma: FakePrisma) {}

  async upload(args: {
    buffer: Buffer
    filename: string
    mimeType: string
    purpose: string
    uploaderId?: string | null
    endUserId?: string | null
  }) {
    const id = `file_${this.seq++}`
    const record: StoredFileObject = {
      id,
      filename: args.filename,
      sizeBytes: args.buffer.length,
      mimeType: args.mimeType,
      // B1-11：真实 FilesService.upload() 对直传 buffer 就地计算 sha256（见 files.service.ts
      // 顶部注释 "直传路径就 buffer 计算"）。这里必须镜像同一行为（而不是用一个和内容无关的
      // 占位符），否则 deliverScanFile() 新增的内容级去重逻辑（比对 contentHash 与
      // FileObject.sha256）在假 Prisma 环境下永远测不出真实效果。
      sha256: createHash('sha256').update(args.buffer).digest('hex'),
      purpose: args.purpose,
      endUserId: args.endUserId ?? null,
      deletedAt: null,
    }
    this.prisma.filesById.set(id, record)
    return {
      fileId: id,
      filename: record.filename,
      sizeBytes: record.sizeBytes,
      mimeType: record.mimeType,
      sha256: record.sha256,
      signedUrl: `https://files.local/${id}`,
      signedUrlExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      fileExpiresAt: null,
    }
  }

  /** B1-6：镜像真实 FilesService.systemDelete() 的最小行为——软删记录、返回 metadata。 */
  async systemDelete(fileId: string, reason: string) {
    this.systemDeleteCalls.push({ fileId, reason })
    const record = this.prisma.filesById.get(fileId)
    if (!record || record.deletedAt) {
      throw new NotFoundException({ error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' } })
    }
    record.deletedAt = new Date()
    this.prisma.filesById.set(fileId, record)
    return { fileId, deletedAt: record.deletedAt }
  }
}

function makeService(): { service: ScanTasksService; prisma: FakePrisma; files: FakeFilesService } {
  const prisma = new FakePrisma()
  const files = new FakeFilesService(prisma)
  return { service: new ScanTasksService(prisma as never, files as never, passthroughCapabilities), prisma, files }
}

async function expectRejects<T extends Error>(
  action: () => Promise<unknown>,
  errorType: new (...args: never[]) => T,
  label: string,
): Promise<void> {
  let rejected = false
  try {
    await action()
  } catch (error) {
    rejected = true
    assert.ok(error instanceof errorType, `${label}: expected ${errorType.name}, got ${(error as Error).constructor.name}`)
  }
  assert.equal(rejected, true, `${label}: expected rejection`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 访问 ScanTasksService 的 private startMatchedHeartbeat()——TS 的 private 只是编译期限制，B1-10 测试需要直接调用/替换它。 */
type HeartbeatTestAccess = { startMatchedHeartbeat: (id: string, intervalMs?: number) => NodeJS.Timeout }

/**
 * B1-10：对着一个真实迁移过的数据库、真实 `ScanTaskReaperTask`（不改它的 3 分钟阈值）、
 * 真实 `ScanTasksService.startMatchedHeartbeat()`，直接证明本次修复关闭的竞态：
 *
 *   - Row A（模拟"进程真的崩了，没有心跳"）：updatedAt 手工回拨到 4 分钟前，什么都不碰，
 *     直接跑真实 reaper——必须被收敛成 failed/SCAN_MATCHED_TIMEOUT（证明本次修复没有
 *     削弱 reaper 对"真正卡死"任务的收敛能力）。
 *   - Row B（模拟"上传其实还在真实进行中，只是恰好超过 3 分钟没完成"）：updatedAt 同样
 *     先回拨到 4 分钟前，然后启动真实心跳跑几个真实 tick（tick 间隔仅用于让测试在几十
 *     毫秒内看到多次真实 tick，不代表生产间隔改了——生产间隔仍是 60s），停掉心跳后
 *     updatedAt 必然已经被刷新成"刚刚"——再跑同一个真实 reaper，Row B 必须保持
 *     'matched'，不能被误杀。
 *
 * 不需要真的等 3 分钟：updatedAt 是显式回拨出来的（本任务已用真实 SQLite 单独验证过
 * Prisma 会原样接受 data 里的显式值，不会被 `@updatedAt` 自动机制覆盖），心跳和 reaper
 * 全程用的都是生产代码里真实、未经修改的常量与逻辑。
 */
async function assertRealDbMatchedHeartbeatClosesRace(dbUrl: string): Promise<void> {
  const { client } = createPrismaClient(dbUrl)
  await client.$connect()
  // 两个独立终端各挂一条 'matched' 行：B1-2 的 partial unique index 约束同一 terminalId
  // 同时只能有一条 waiting/matched 活跃记录，Row A/Row B 必须分属不同终端，否则第二条
  // create() 会先撞上那条无关的约束，测不到本测试真正要验证的心跳/reaper 行为。
  const terminalIdA = `realdb_hb_a_${randomBytes(4).toString('hex')}`
  const terminalIdB = `realdb_hb_b_${randomBytes(4).toString('hex')}`
  try {
    for (const terminalId of [terminalIdA, terminalIdB]) {
      await client.terminal.create({
        data: {
          id: terminalId,
          terminalCode: `RDB-HB-${randomBytes(3).toString('hex')}`,
          agentToken: randomBytes(16).toString('hex'),
          deviceFingerprint: 'verify-scan-tasks-realdb-heartbeat-fixture',
          enabled: true,
        },
      })
    }

    const realPrisma = { scanTask: client.scanTask } as never
    const service = new ScanTasksService(realPrisma, {} as never, passthroughCapabilities)
    const reaper = new ScanTaskReaperTask(client as never)

    const fourMinutesAgo = new Date(Date.now() - 4 * 60 * 1000)

    const rowA = await client.scanTask.create({
      data: { terminalId: terminalIdA, scanType: 'document', status: 'matched', expiresAt: new Date(Date.now() + 60_000) },
      select: { id: true },
    })
    await client.scanTask.updateMany({ where: { id: rowA.id }, data: { updatedAt: fourMinutesAgo } })

    const rowB = await client.scanTask.create({
      data: { terminalId: terminalIdB, scanType: 'document', status: 'matched', expiresAt: new Date(Date.now() + 60_000) },
      select: { id: true },
    })
    await client.scanTask.updateMany({ where: { id: rowB.id }, data: { updatedAt: fourMinutesAgo } })

    // Row B：启动真实的（未 mock 的）心跳方法，跑几个真实 tick，然后停掉。
    const heartbeat = (service as unknown as HeartbeatTestAccess).startMatchedHeartbeat(rowB.id, 20)
    await sleep(90)
    clearInterval(heartbeat)

    const rowBAfterHeartbeat = await client.scanTask.findUnique({ where: { id: rowB.id }, select: { updatedAt: true } })
    assert.ok(
      rowBAfterHeartbeat!.updatedAt.getTime() > fourMinutesAgo.getTime() + 3 * 60 * 1000,
      'real heartbeat ticks must have refreshed updatedAt back to "now" against the real database',
    )

    // 真实 reaper，未经任何修改，跑一次。
    await reaper.reapStuckMatched()

    const rowAAfter = await client.scanTask.findUnique({ where: { id: rowA.id } })
    assert.equal(
      rowAAfter?.status,
      'failed',
      'real DB: a genuinely stuck matched row (no heartbeat, stale updatedAt) must still be correctly reaped by the unmodified real reaper',
    )
    assert.equal(rowAAfter?.errorCode, 'SCAN_MATCHED_TIMEOUT')

    const rowBAfter = await client.scanTask.findUnique({ where: { id: rowB.id } })
    assert.equal(
      rowBAfter?.status,
      'matched',
      'real DB: the SAME unmodified real reaper must NOT reap a matched row whose heartbeat kept updatedAt fresh — this is the race the fix closes',
    )
  } finally {
    await client.scanTask.deleteMany({ where: { terminalId: { in: [terminalIdA, terminalIdB] } } })
    await client.terminal.deleteMany({ where: { id: { in: [terminalIdA, terminalIdB] } } })
    await client.$disconnect()
  }
}

/**
 * B1-9 共享断言体：对一个真实迁移过的数据库（SQLite 或 Postgres 皆可）连接，
 * 端到端跑一遍 B1-2 partial unique index 的完整行为断言——create() 成功、
 * 'waiting' 状态下第二次 create() 命中真实 P2002 并映射为 SCAN_TERMINAL_BUSY、
 * 'matched' 状态同样被挡、四种终态（completed/cancelled/expired/failed）依次
 * 验证均不再挡后续创建。SQLite 块与 Postgres 块（见 main() 内两个独立 `{}` 块）
 * 共用同一套断言，避免"两个数据库各测各的、悄悄漂移出不一致覆盖"。
 *
 * `label` 仅用于失败消息里标注是哪个数据库跑出的断言失败，方便排障。
 */
async function assertRealDbPartialUniqueIndex(dbUrl: string, label: 'sqlite' | 'postgres'): Promise<void> {
  const { client } = createPrismaClient(dbUrl)
  await client.$connect()
  try {
    const realPrisma = { terminal: client.terminal, scanTask: client.scanTask } as never
    // create() 本身不触碰 this.files，真实 FilesService 在这里没有必要。
    const service = new ScanTasksService(realPrisma, {} as never, passthroughCapabilities)

    const terminalId = `realdb_t_${label}_${randomBytes(4).toString('hex')}`
    try {
      await client.terminal.create({
        data: {
          id: terminalId,
          terminalCode: `RDB-${label}-${randomBytes(3).toString('hex')}`,
          agentToken: randomBytes(16).toString('hex'),
          deviceFingerprint: 'verify-scan-tasks-realdb-fixture',
          enabled: true,
        },
      })

      const first = await service.create({ scanType: 'document', terminalId }, null)
      assert.ok(first.scanTaskId, `real DB (${label}): first create() must succeed`)

      let caughtWaiting: unknown
      try {
        await service.create({ scanType: 'document', terminalId }, null)
      } catch (error) {
        caughtWaiting = error
      }
      assert.ok(
        caughtWaiting instanceof ConflictException,
        `real DB (${label}): second create() while first is still 'waiting' must hit the real partial unique index and be mapped to ConflictException, got ${(caughtWaiting as Error)?.constructor?.name}`,
      )
      assert.equal(
        ((caughtWaiting as ConflictException).getResponse() as { error?: { code?: string } }).error?.code,
        'SCAN_TERMINAL_BUSY',
        `real DB (${label}): real P2002 from the actual migration-created index must map to SCAN_TERMINAL_BUSY`,
      )

      // 约束的 WHERE 子句是 status IN ('waiting','matched')——单独验证 'matched' 分支也真的
      // 挡住新建，不能只测 'waiting'（否则如果约束被误写成只覆盖 'waiting'，这里测不出来）。
      await client.scanTask.updateMany({ where: { id: first.scanTaskId }, data: { status: 'matched' } })
      let caughtMatched: unknown
      try {
        await service.create({ scanType: 'document', terminalId }, null)
      } catch (error) {
        caughtMatched = error
      }
      assert.ok(
        caughtMatched instanceof ConflictException,
        `real DB (${label}): a 'matched' (not just 'waiting') active task must also block new create(), got ${(caughtMatched as Error)?.constructor?.name}`,
      )

      // 四种终态依次验证：每种都必须真的不再挡后续创建（证明约束只覆盖 waiting/matched，
      // 不是全状态生效，也不是压根没生效导致"看起来放行"其实是约束整体失效）。
      let activeTaskId = first.scanTaskId
      for (const terminalState of ['completed', 'cancelled', 'expired', 'failed'] as const) {
        await client.scanTask.updateMany({ where: { id: activeTaskId }, data: { status: terminalState } })
        const created = await service.create({ scanType: 'document', terminalId }, null)
        assert.ok(
          created.scanTaskId,
          `real DB (${label}): after prior task transitions to '${terminalState}', same terminal must be able to create again`,
        )
        activeTaskId = created.scanTaskId
      }
    } finally {
      // 无论断言是否失败都尝试清理，避免污染共享的 Postgres 开发库/CI 库
      // （SQLite 分支额外靠外层临时目录整体删除兜底，这里的清理对它是锦上添花）。
      await client.scanTask.deleteMany({ where: { terminalId } })
      await client.terminal.deleteMany({ where: { id: terminalId } })
    }
  } finally {
    await client.$disconnect()
  }
}

/**
 * B1-11 follow-up：真实 DB 端到端验证 deliverScanFile() 的内容级去重护栏本体。
 *
 * 背景（诚实澄清，纠正 c325b2ff 提交信息里的失实表述）：该提交声称做过"a standalone
 * real-SQLite smoke check of the actual Prisma query shapes used by the dedup guard"，
 * 但实际diff里从来没有这项测试——本文件此前的两个 real-DB 函数
 * （assertRealDbMatchedHeartbeatClosesRace / assertRealDbPartialUniqueIndex）都不曾调用过
 * deliverScanFile()，B1-11 新增的全部 5 条去重测试（见 main() 里标注"B1-11"的几个代码块）
 * 只用了本文件顶部的 FakePrisma/makeService()。FakePrisma.scanTask.findMany /
 * FakePrisma.fileObject.findFirst 是手写的近似实现，只证明服务层判别逻辑本身通了，
 * 不能证明 deliverScanFile() 里实际写的这两条 Prisma 查询语法（`fileId: { not: null }`
 * 搭配 `updatedAt: { gt }`，以及 `id: { in: [...] }` 搭配 `sha256` 等值比较）对真实 Prisma
 * 查询引擎/真实数据库语义确实正确——这正是本函数要补的洞。
 *
 * 因此这里必须用真实 PrismaClient（隔离临时 SQLite，沿用 assertRealDbPartialUniqueIndex()
 * 的 mkdtempSync + migrate deploy 手法）+ 真实 AuditService + 真实 StorageService（local
 * 驱动，FILE_STORAGE_DIR 指向独立临时目录，绝不写入仓库真实 storage/）+ 真实 FilesService
 * + 真实（未 mock）ScanTasksService，完整跑一遍 deliverScanFile() 本体，而不是只测服务层
 * 判别函数。三条断言：
 *
 *   1) 跨用户场景（本次修复要关闭的真实威胁模型）：member_a 的投递真正建档完成
 *      （FileObject 落库、ScanTask.fileId 落库），随后同一物理终端出现属于 member_b 的
 *      全新等待任务；member_a 的同一份字节内容重试投递，必须被真实 Prisma 查询正确识别
 *      为重复并拒绝（SCAN_FILE_ALREADY_DELIVERED），member_b 的任务必须原封不动保持
 *      waiting、fileId 仍为 null——这就是"一个用户的身份证扫描件被错误地挂到另一个用户
 *      任务上"这条 PII 泄漏路径。
 *   2) 不同内容不得被误伤：紧接着用真正不同的字节再投递一次，必须正常成功匹配到 member_b
 *      的任务——证明真实 Prisma 的 sha256 等值比较是真的按内容甄别，不是"同终端有历史
 *      记录就全部拒绝"。
 *   3) 直接对着真实 DB，用与 deliverScanFile() 里完全相同的过滤形状单独重放一次
 *      scanTask.findMany({ where: { terminalId, fileId: { not: null }, updatedAt: { gt } } })
 *      与 fileObject.findFirst({ where: { id: { in: [...] }, sha256 } })，断言返回的行数/
 *      内容与预期精确一致——这是 FakePrisma 永远证明不了的一层：写的 Prisma 过滤语法本身
 *      对真实查询引擎是否语义正确。
 */
async function assertRealDbDedupGuardClosesCrossUserLeak(dbUrl: string): Promise<void> {
  const { client } = createPrismaClient(dbUrl)
  await client.$connect()

  const tmpStorageDir = mkdtempSync(path.join(tmpdir(), 'verify-scan-tasks-realdb-dedup-storage-'))
  const originalStorageDir = process.env['FILE_STORAGE_DIR']
  process.env['FILE_STORAGE_DIR'] = tmpStorageDir

  const terminalId = `realdb_dedup_${randomBytes(4).toString('hex')}`
  const endUserAId = `realdb_dedup_member_a_${randomBytes(4).toString('hex')}`
  const endUserBId = `realdb_dedup_member_b_${randomBytes(4).toString('hex')}`

  try {
    await client.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `RDB-DEDUP-${randomBytes(3).toString('hex')}`,
        agentToken: randomBytes(16).toString('hex'),
        deviceFingerprint: 'verify-scan-tasks-realdb-dedup-fixture',
        enabled: true,
      },
    })
    // 真实 EndUser 行（而不是任意字符串）：ScanTask.endUserId / FileObject.endUserId
    // 都有 FK → EndUser，且这样才能真实还原"两个不同用户"这条威胁模型的字面意思。
    await client.endUser.create({
      data: { id: endUserAId, phoneHash: `hash_${endUserAId}`, phoneEnc: 'enc_a' },
    })
    await client.endUser.create({
      data: { id: endUserBId, phoneHash: `hash_${endUserBId}`, phoneEnc: 'enc_b' },
    })

    const realPrisma = client as never
    const audit = new AuditService(realPrisma)
    const storage = new StorageService()
    const files = new FilesService(realPrisma, audit, storage)
    const service = new ScanTasksService(realPrisma, files, passthroughCapabilities)

    const bufferA = tinyPdf()
    const contentHashA = createHash('sha256').update(bufferA).digest('hex')

    // member_a 真实投递，真实建档完成（真实 upload() 写真实 FileObject 行）。
    const taskA = await service.create({ scanType: 'document', terminalId }, endUserAId)
    const deliveredA = await service.deliverScanFile({
      terminalId,
      buffer: bufferA,
      filename: 'a.pdf',
      mimeType: 'application/pdf',
    })
    assert.equal(deliveredA.scanTaskId, taskA.scanTaskId, 'real DB: first delivery must match taskA')

    const uploadedFileRow = await client.fileObject.findUnique({ where: { id: deliveredA.fileId } })
    assert.equal(
      uploadedFileRow?.sha256,
      contentHashA,
      'real DB sanity precondition: the real FilesService.upload() must have stored the true content sha256 (not a placeholder)',
    )

    // member_b 在同一物理终端开了一个全新等待任务——deliverScanFile() 匹配"该终端最早一条
    // waiting 任务"完全不知道下一次投递的字节属于谁，这正是去重护栏要挡住的窗口。
    const taskB = await service.create({ scanType: 'document', terminalId }, endUserBId)

    let caught: unknown
    try {
      await service.deliverScanFile({ terminalId, buffer: bufferA, filename: 'a-retry.pdf', mimeType: 'application/pdf' })
    } catch (error) {
      caught = error
    }
    assert.ok(
      caught instanceof ConflictException,
      `real DB: duplicate-content retry must be rejected by the real Prisma dedup query, got ${(caught as Error)?.constructor?.name}`,
    )
    const body = (caught as ConflictException).getResponse() as { error?: { code?: string } }
    assert.equal(
      body.error?.code,
      'SCAN_FILE_ALREADY_DELIVERED',
      'real DB: duplicate rejection must carry the specific SCAN_FILE_ALREADY_DELIVERED code',
    )

    const taskBAfterDuplicateAttempt = await client.scanTask.findUnique({ where: { id: taskB.scanTaskId } })
    assert.equal(
      taskBAfterDuplicateAttempt?.status,
      'waiting',
      'real DB: member_b task must remain completely untouched — this is the cross-user PII leak the fix closes',
    )
    assert.equal(
      taskBAfterDuplicateAttempt?.fileId,
      null,
      'real DB: member_b task must never end up with member_a content attached',
    )

    // 不同内容不得被误伤：真实的 sha256 比对必须真的按字节甄别，不是"同终端有过成功
    // 投递就全部拒绝"。
    const differentBuffer = Buffer.from('%PDF-1.4\nreal DB genuinely different content, not a duplicate\n%%EOF\n', 'latin1')
    const deliveredB = await service.deliverScanFile({
      terminalId,
      buffer: differentBuffer,
      filename: 'b.pdf',
      mimeType: 'application/pdf',
    })
    assert.equal(
      deliveredB.scanTaskId,
      taskB.scanTaskId,
      'real DB: genuinely different content must proceed to normal matching, not be blocked by the dedup guard',
    )

    // 直接对着真实 DB 单独重放一次与 deliverScanFile() 里逐字相同形状的查询——证明写的
    // Prisma 过滤语法本身对真实查询引擎语义正确，不只是"结构上能编译过"。
    const recentlyDeliveredForTerminal = await client.scanTask.findMany({
      where: {
        terminalId,
        fileId: { not: null },
        updatedAt: { gt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      },
      select: { fileId: true },
    })
    assert.equal(
      recentlyDeliveredForTerminal.length,
      2,
      `real DB: the exact findMany() filter shape used by deliverScanFile() must return exactly the 2 completed rows for this terminal (taskA + taskB), got ${recentlyDeliveredForTerminal.length}`,
    )
    const candidateFileIds = recentlyDeliveredForTerminal
      .map((t) => t.fileId)
      .filter((id): id is string => id !== null)

    const dupMatch = await client.fileObject.findFirst({
      where: { id: { in: candidateFileIds }, sha256: contentHashA },
      select: { id: true },
    })
    assert.equal(
      dupMatch?.id,
      deliveredA.fileId,
      'real DB: fileObject.findFirst() with the exact filter shape must resolve back to the original member_a upload',
    )

    const noMatchForUnrelatedHash = await client.fileObject.findFirst({
      where: { id: { in: candidateFileIds }, sha256: 'f'.repeat(64) },
      select: { id: true },
    })
    assert.equal(noMatchForUnrelatedHash, null, 'real DB: an unrelated sha256 must not match any candidate row')
  } finally {
    await client.scanTask.deleteMany({ where: { terminalId } }).catch(() => undefined)
    await client.fileObject.deleteMany({ where: { endUserId: { in: [endUserAId, endUserBId] } } }).catch(() => undefined)
    await client.endUser.deleteMany({ where: { id: { in: [endUserAId, endUserBId] } } }).catch(() => undefined)
    await client.terminal.deleteMany({ where: { id: terminalId } }).catch(() => undefined)
    await client.$disconnect()
    if (originalStorageDir === undefined) {
      delete process.env['FILE_STORAGE_DIR']
    } else {
      process.env['FILE_STORAGE_DIR'] = originalStorageDir
    }
    rmSync(tmpStorageDir, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const dto: CreateScanTaskDto = { scanType: 'document', terminalId: 't_1' }

  {
    // 正常建会话 + 匹配投递 + 状态查询全链路
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    assert.ok(created.scanTaskId)
    assert.equal(created.instructions.length > 0, true, 'instructions must be non-empty')

    // B1-3: create() 铸造并返回明文 controlToken（24 random bytes = 48 hex chars），
    // DB 里只落它的 sha256 hash，绝不落明文。
    assert.match(created.controlToken, /^[0-9a-f]{48}$/, 'controlToken must be a 24-byte hex string')
    const storedTask = prisma.scanTasksById.get(created.scanTaskId)
    assert.notEqual(storedTask?.controlTokenHash, created.controlToken, 'stored value must not be the plaintext token')
    assert.equal(
      storedTask?.controlTokenHash,
      createHash('sha256').update(created.controlToken).digest('hex'),
      'stored controlTokenHash must be sha256(controlToken)',
    )

    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: Buffer.from('%PDF-1.4 scan'),
      filename: 'scan.pdf',
      mimeType: 'application/pdf',
    })
    assert.equal(delivered.scanTaskId, created.scanTaskId)
    // scanType -> FilePurpose 映射:document 扫描必须落 print_doc（顺带覆盖，不单开一个测试块）
    assert.equal(prisma.filesById.get(delivered.fileId)?.purpose, 'print_doc')

    const status = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(status.status, 'completed')
    assert.equal(status.file?.fileId, delivered.fileId)
    assert.match(status.file?.fileUrl ?? '', /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/)
  }

  {
    // B1-3：create() 捕获数据库唯一约束冲突（B1-2 的 partial unique index，Prisma 抛 P2002）
    // 必须映射成 409 ConflictException + error.code === 'SCAN_TERMINAL_BUSY'，不能是未处理异常
    // 也不能被其它无关错误码顶替。FakePrisma 不建模真实唯一索引，这里 monkey-patch
    // scanTask.create 模拟命中约束，复现真实 Prisma 抛出的错误形状——isScanTaskActiveSessionConflict()
    // 用 `instanceof Prisma.PrismaClientKnownRequestError` 判别（而非鸭子类型 duck-typing 一个
    // `.code` 字段），因此这里必须构造一个真正的 PrismaClientKnownRequestError 实例，
    // 一个仅挂了 .code 属性的 plain Error 不再能通过该判别。
    // （real-DB 端到端复现见本任务 verification：against 真实 SQLite + 真实 partial unique index）。
    const { service, prisma } = makeService()
    const originalCreate = prisma.scanTask.create.bind(prisma.scanTask)
    prisma.scanTask.create = (async () => {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`terminalId`)', {
        code: 'P2002',
        clientVersion: 'verify-scan-tasks-fixture',
        meta: { target: ['terminalId'] },
      })
    }) as typeof originalCreate

    let caught: unknown
    try {
      await service.create(dto, null)
    } catch (error) {
      caught = error
    }
    assert.ok(caught instanceof ConflictException, `expected ConflictException, got ${(caught as Error)?.constructor?.name}`)
    const body = (caught as ConflictException).getResponse() as { error?: { code?: string } }
    assert.equal(body.error?.code, 'SCAN_TERMINAL_BUSY', 'P2002 on create() must map to SCAN_TERMINAL_BUSY, not a different/generic code')

    prisma.scanTask.create = originalCreate as typeof prisma.scanTask.create
  }

  {
    // create() 必须只把 P2002 映射成 SCAN_TERMINAL_BUSY；其它数据库错误码/未知错误必须原样透出
    // （不能被误吞成"终端繁忙"，否则会掩盖真实故障，误导排障方向）。
    //
    // 注意：光断言 `error instanceof Error` 是近乎空判断的——ConflictException 本身也
    // extends Error，如果 isScanTaskActiveSessionConflict() 被错误地改成对任意错误都
    // 返回 true（把这个非 P2002 错误也错判成活跃会话冲突），下面这条断言依然会通过，
    // 完全测不出判别逻辑坏了。因此必须同时证明：
    //   1) 抛出的不是 ConflictException（没有被误判成 SCAN_TERMINAL_BUSY 分支）；
    //   2) 抛出的就是原始那个 fake error 对象本身（严格 === 同一引用，证明是真正的
    //      原样透传 `throw e`，而不是换了个新错误但恰好还不是 ConflictException）。
    const { service, prisma } = makeService()
    const originalCreate = prisma.scanTask.create.bind(prisma.scanTask)
    const fakeError = new Error('ECONNRESET: simulated unrelated database failure')
    prisma.scanTask.create = (async () => {
      throw fakeError
    }) as typeof originalCreate

    let caught: unknown
    try {
      await service.create(dto, null)
    } catch (error) {
      caught = error
    }
    assert.ok(caught instanceof Error, 'non-P2002 errors must not be swallowed as SCAN_TERMINAL_BUSY: expected an Error to be thrown')
    assert.ok(
      !(caught instanceof ConflictException),
      `non-P2002 errors must NOT be remapped to ConflictException, got ${(caught as Error)?.constructor?.name}`,
    )
    assert.equal(
      caught,
      fakeError,
      'non-P2002 errors must propagate as the exact same original error instance (true passthrough via `throw e`), not a new/different error',
    )

    prisma.scanTask.create = originalCreate as typeof prisma.scanTask.create
  }

  {
    // B1-9：真实 DB 端到端验证——B1-2 的 partial unique index 只写在 migration.sql 里
    // （Prisma schema.prisma 语法表达不了 WHERE 条件表达式，见 schema.prisma ScanTask 模型
    // 上方注释），上面两个 SCAN_TERMINAL_BUSY 测试全部是对着手工构造/monkey-patch 出来的
    // PrismaClientKnownRequestError 做的单元级判别测试（isScanTaskActiveSessionConflict()），
    // 从未真正跑过这条 migration.sql 本身，也没有验证过真实数据库真的会在正确的时机抛出
    // P2002、在正确的时机放行。
    //
    // 不能依赖 CI 共享的 dev.db：CI 的 "Prepare fresh SQLite db" 步骤用的是 `prisma db push`——
    // 它只按 schema.prisma 建表，schema.prisma 没有声明这条 partial unique index（只在
    // migration.sql 里），已本地验证 `db push` 后 sqlite_master 里确实没有
    // ScanTask_terminalId_active_unique 这条索引。也不能依赖当前进程的 DATABASE_URL：本脚本
    // 同时被 SQLite CI job 和 postgres-readiness job 调用（后者 DATABASE_URL 指向 Postgres，
    // 没有 prisma/dev.db）。因此这里起一个完全独立的临时 SQLite 文件，直接调用本地
    // node_modules/.bin/prisma 跑一遍真实 `migrate deploy`（应用完整迁移历史，含这条约束），
    // 全程不触碰进程当前的 DATABASE_URL / 共享 dev.db，跑完即删。
    const apiRoot = path.resolve(__dirname, '..')
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'verify-scan-tasks-realdb-'))
    const dbPath = path.join(tmpDir, 'verify.db')
    const dbUrl = `file:${dbPath}`

    try {
      execFileSync(path.join(apiRoot, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
        cwd: apiRoot,
        env: { ...process.env, DATABASE_URL: dbUrl },
        stdio: 'pipe',
      })

      await assertRealDbPartialUniqueIndex(dbUrl, 'sqlite')
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  {
    // B1-9 follow-up：上面的 SQLite 块只证明了 prisma/migrations/ 下那份 migration.sql 真实
    // 生效——但 partial unique index 是手写 SQL，SQLite 版和 prisma/postgres/migrations/ 下的
    // Postgres 版是两份独立的 .sql 文件（Prisma 的 @@unique 语法表达不了 WHERE 条件，所以两边
    // 都得手写，天然就有"改了一份忘改另一份"的漂移风险）。CI 的 postgres-readiness job 会真的
    // 把 Postgres 版迁移部署到一个真实 Postgres 实例上，但在这个 B1-9 补丁之前，从没有任何测试
    // 真的对着那个连接跑两次 create() 去验证约束的 WHERE 子句在 Postgres 上语义正确——SQLite
    // 那半边测过不代表 Postgres 那半边也一定对（哪怕两份 .sql 文本几乎一样）。
    //
    // 复用哪个数据库连接、要不要单独建库/建 schema：本仓库目前唯一存在的"对真实 Postgres 跑
    // 测试"先例，是 postgres-readiness CI job 本身的架构——整个 job 起一个 Postgres service
    // 容器、部署一次迁移、seed 一次，然后几十个 verify:* 脚本依次共用同一个数据库连接，靠各自
    // 随机 ID + 用完自己清理来避免互相污染（见本文件其余 verify:* 脚本的调用方式：
    // .github/workflows/ci.yml 的 postgres-readiness job）。这里跟随同一个约定：直接连到
    // POSTGRES_URL（CI 场景）或退化到 DATABASE_URL（本地场景，与 prisma.postgres.config.ts
    // 读取 env 的优先级一致），不额外发明"每个测试起一个独立 schema/database"的新隔离机制——
    // assertRealDbPartialUniqueIndex() 内部沿用与 SQLite 块相同的随机 terminalId + finally
    // 清理，不会残留数据。
    //
    // 没有配置 Postgres 环境时（例如本地开发者跑 `pnpm verify:scan-tasks` 没起 Postgres）优雅
    // 跳过，不失败——跟 scripts/verify-cos-live.ts 对未配置真实凭证时的处理方式一致（SKIPPED
    // + 说明如何补齐环境，而不是让本来就该用 SQLite 跑的日常验证因为缺 Postgres 而报红）。
    const pgUrl = process.env['POSTGRES_URL']?.trim() || process.env['DATABASE_URL']?.trim()
    let pgKind: ReturnType<typeof dbKindOf> | undefined
    try {
      pgKind = pgUrl ? dbKindOf(pgUrl) : undefined
    } catch {
      pgKind = undefined
    }

    if (!pgUrl || pgKind !== 'postgres') {
      console.log(
        'SKIPPED real DB (postgres) partial unique index check — 未检测到指向 PostgreSQL 的 POSTGRES_URL/DATABASE_URL，跳过。' +
          ' 本地要跑此项：export POSTGRES_URL="postgresql://user@localhost:5432/db" 后重试；' +
          ' postgres-readiness CI job 会用真实 Postgres 实例跑到这一段。',
      )
    } else {
      const apiRoot = path.resolve(__dirname, '..')
      // 与 SQLite 块一致：不假设调用方已经在本进程之外部署过迁移，本块自己也跑一遍真实
      // `migrate deploy`（走 Postgres 专用配置/迁移目录，见 prisma.postgres.config.ts）。
      // migrate deploy 是幂等的，对已经部署过这条迁移的库（如 CI 提前 db:pg:deploy 过的库）
      // 重跑是安全的no-op。
      execFileSync(path.join(apiRoot, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy', '--config', 'prisma.postgres.config.ts'], {
        cwd: apiRoot,
        env: { ...process.env, DATABASE_URL: pgUrl, POSTGRES_URL: pgUrl },
        stdio: 'pipe',
      })

      await assertRealDbPartialUniqueIndex(pgUrl, 'postgres')
    }
  }

  {
    // 禁用终端不能建会话
    const { service } = makeService()
    await expectRejects(
      () => service.create({ scanType: 'document', terminalId: 't_disabled' }, null),
      BadRequestException,
      'disabled terminal rejected',
    )
  }

  {
    // 不存在的终端不能建会话
    const { service } = makeService()
    await expectRejects(
      () => service.create({ scanType: 'document', terminalId: 't_missing' }, null),
      BadRequestException,
      'unknown terminal rejected',
    )
  }

  {
    // 没有等待中任务时投递必须 409 ConflictException（不得误建档，也不能静默吞掉文件）
    const { service } = makeService()
    await expectRejects(
      () => service.deliverScanFile({ terminalId: 't_1', buffer: tinyPdf(), filename: 'stray.pdf', mimeType: 'application/pdf' }),
      ConflictException,
      'no waiting task rejected',
    )
  }

  {
    // 最早一条 waiting 任务优先匹配（而不是最新一条）
    const { service } = makeService()
    const first = await service.create(dto, null)
    await new Promise((r) => setTimeout(r, 5))
    const second = await service.create(dto, null)
    const delivered = await service.deliverScanFile({ terminalId: 't_1', buffer: tinyPdf(), filename: 'a.pdf', mimeType: 'application/pdf' })
    assert.equal(delivered.scanTaskId, first.scanTaskId, 'must match the oldest waiting task, not the newest')
    void second
  }

  {
    // 过期任务在查询时惰性转 expired，且不能再被投递匹配
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    const task = prisma.scanTasksById.get(created.scanTaskId)!
    prisma.scanTasksById.set(created.scanTaskId, { ...task, expiresAt: new Date(Date.now() - 1000) })
    const status = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(status.status, 'expired')
    await expectRejects(
      () => service.deliverScanFile({ terminalId: 't_1', buffer: tinyPdf(), filename: 'late.pdf', mimeType: 'application/pdf' }),
      ConflictException,
      'expired task must not be matched',
    )
  }

  {
    // getStatus() 的懒过期落盘必须 CAS（只在仍是 waiting 时才写 expired）。
    // 模拟竞态：读到 waiting + 已过期之后、落盘之前，另一个并发请求的 cancel() 抢先把
    // 任务改成了 cancelled——落盘时必须因为状态已不是 waiting 而放弃写入，
    // 不能无条件覆盖回 expired，抹掉真实的取消结果。
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    const task = prisma.scanTasksById.get(created.scanTaskId)!
    prisma.scanTasksById.set(created.scanTaskId, { ...task, expiresAt: new Date(Date.now() - 1000) })

    const originalUpdateMany = prisma.scanTask.updateMany.bind(prisma.scanTask)
    prisma.scanTask.updateMany = (async (args: Parameters<typeof originalUpdateMany>[0]) => {
      const current = prisma.scanTasksById.get(created.scanTaskId)!
      prisma.scanTasksById.set(created.scanTaskId, { ...current, status: 'cancelled' })
      return originalUpdateMany(args)
    }) as typeof originalUpdateMany

    await service.getStatus(created.scanTaskId, null, created.controlToken)

    assert.equal(
      prisma.scanTasksById.get(created.scanTaskId)?.status,
      'cancelled',
      'lazy-expire write must not clobber a concurrently cancelled task back to expired',
    )
  }

  {
    // 他人不能查看 / 取消绑定了 endUserId 的任务（这里全程带上正确 controlToken，
    // 证明 endUserId 归属校验在 B1-4 之后依然独立生效，不是被 controlToken 校验顶替掉）。
    const { service } = makeService()
    const created = await service.create(dto, 'member_1')
    await expectRejects(
      () => service.getStatus(created.scanTaskId, 'member_2', created.controlToken),
      ForbiddenException,
      'status forbidden for non-owner',
    )
    await expectRejects(
      () => service.cancel(created.scanTaskId, 'member_2', created.controlToken),
      ForbiddenException,
      'cancel forbidden for non-owner',
    )
    const cancelled = await service.cancel(created.scanTaskId, 'member_1', created.controlToken)
    assert.equal(cancelled.status, 'cancelled')
  }

  {
    // B1-4 案例(a)：正确 controlToken → 放行。会员任务（不只游客任务）也必须过 controlToken
    // 校验——即便 endUserId 完全匹配本人，缺了/错了 controlToken 依然要 403。
    const { service } = makeService()
    const created = await service.create(dto, 'member_1')
    const status = await service.getStatus(created.scanTaskId, 'member_1', created.controlToken)
    assert.equal(status.status, 'waiting', 'correct token + correct owner must be granted access')
  }

  {
    // B1-4 案例(b)：缺失 controlToken（undefined）→ 403，即便 endUserId 完全匹配本人
    // （纵深防御：不能因为 JWT 归属校验通过了就跳过 token 校验）。同时覆盖 getStatus 与 cancel。
    const { service } = makeService()
    const createdMember = await service.create(dto, 'member_1')
    await expectRejects(
      () => service.getStatus(createdMember.scanTaskId, 'member_1', undefined),
      ForbiddenException,
      'missing controlToken must be rejected even for the correct member owner (status)',
    )
    await expectRejects(
      () => service.cancel(createdMember.scanTaskId, 'member_1', undefined),
      ForbiddenException,
      'missing controlToken must be rejected even for the correct member owner (cancel)',
    )

    const createdGuest = await service.create(dto, null)
    await expectRejects(
      () => service.getStatus(createdGuest.scanTaskId, null, undefined),
      ForbiddenException,
      'missing controlToken must be rejected for guest tasks too (status)',
    )
    await expectRejects(
      () => service.cancel(createdGuest.scanTaskId, null, undefined),
      ForbiddenException,
      'missing controlToken must be rejected for guest tasks too (cancel)',
    )
  }

  {
    // B1-4 案例(c)：错误 controlToken（格式合法但不匹配该任务的 hash）→ 403。
    // 这条断言真正锁定 timingSafeEqualHex() 的哈希比对逻辑本身——如果实现被错误地改成
    // 无条件 `return true`（或退化成只判断 truthy），这里会因为没有抛出 ForbiddenException
    // 而失败，不是空判断。
    const { service } = makeService()
    const created = await service.create(dto, null)
    const wrongToken = randomBytes(24).toString('hex')
    assert.notEqual(wrongToken, created.controlToken, 'sanity: fixture must generate a genuinely different token')
    await expectRejects(
      () => service.getStatus(created.scanTaskId, null, wrongToken),
      ForbiddenException,
      'wrong controlToken must be rejected (status)',
    )
    await expectRejects(
      () => service.cancel(created.scanTaskId, null, wrongToken),
      ForbiddenException,
      'wrong controlToken must be rejected (cancel)',
    )
    // 用正确 token 复核同一条任务确实还活着、还能正常访问——证明上面两次 403
    // 是 wrongToken 造成的，不是任务本身已经被别的路径弄坏了。
    const status = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(status.status, 'waiting')
  }

  {
    // B1-4 案例(d)：token 属于另一个任务（跨任务）→ 403。证明比对是"逐任务哈希比对"，
    // 不是拿去跟某个全局密钥/常量比。如果实现退化成"只要 token 是任意合法已铸造的
    // token 就放行"，这里会因为没有抛出而失败。
    const { service } = makeService()
    const taskA = await service.create(dto, null)
    const taskB = await service.create(dto, null)
    assert.notEqual(taskA.controlToken, taskB.controlToken, 'sanity: two sessions must mint different tokens')
    await expectRejects(
      () => service.getStatus(taskB.scanTaskId, null, taskA.controlToken),
      ForbiddenException,
      'taskA token must not unlock taskB (status)',
    )
    await expectRejects(
      () => service.cancel(taskB.scanTaskId, null, taskA.controlToken),
      ForbiddenException,
      'taskA token must not unlock taskB (cancel)',
    )
    // taskA 自己的 token 依然能访问 taskA，证明上面失败确实是"跨任务"导致，不是 token 整体失效。
    const statusA = await service.getStatus(taskA.scanTaskId, null, taskA.controlToken)
    assert.equal(statusA.status, 'waiting')
  }

  {
    // B1-4 历史行兼容：controlTokenHash 为 null（B1-1 迁移前创建的旧行）必须一律拒绝，
    // 即便调用方带了某个格式合法的 token——不能因为"看起来像是没设防"就放行，
    // 这类旧行应该在几分钟内自然过期，拒绝比放行更安全。
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    const task = prisma.scanTasksById.get(created.scanTaskId)!
    prisma.scanTasksById.set(created.scanTaskId, { ...task, controlTokenHash: null })

    await expectRejects(
      () => service.getStatus(created.scanTaskId, null, created.controlToken),
      ForbiddenException,
      'legacy row with null controlTokenHash must be rejected even with the (no-longer-verifiable) original token (status)',
    )
    await expectRejects(
      () => service.cancel(created.scanTaskId, null, created.controlToken),
      ForbiddenException,
      'legacy row with null controlTokenHash must be rejected even with the (no-longer-verifiable) original token (cancel)',
    )
    // 再用一个完全无关的随机 token 试一次，确认不是"刚好这个 token 不对"，而是 null hash 本身就全拒。
    await expectRejects(
      () => service.getStatus(created.scanTaskId, null, randomBytes(24).toString('hex')),
      ForbiddenException,
      'legacy row with null controlTokenHash must reject an unrelated token too (status)',
    )
  }

  {
    // 已完成任务不能取消（cancel() 在 CAS 之前就做了 completed 前置检查）
    const { service } = makeService()
    const created = await service.create(dto, null)
    await service.deliverScanFile({ terminalId: 't_1', buffer: tinyPdf(), filename: 'a.pdf', mimeType: 'application/pdf' })
    await expectRejects(
      () => service.cancel(created.scanTaskId, null, created.controlToken),
      BadRequestException,
      'completed task cannot be cancelled',
    )
  }

  {
    // 不存在的任务查询 / 取消都应 404（404 判定必须先于 controlToken 校验：
    // 这里刻意不传 controlToken，证明缺 token 不会把本该是 404 的响应变成别的错误码）。
    const { service } = makeService()
    await expectRejects(() => service.getStatus('missing', null, undefined), NotFoundException, 'status not found')
    await expectRejects(() => service.cancel('missing', null, undefined), NotFoundException, 'cancel not found')
  }

  {
    // scanType -> FilePurpose 映射正确（id 扫描必须落 id_scan，不能落成通用 print_doc）
    const { service, prisma } = makeService()
    const created = await service.create({ scanType: 'id', terminalId: 't_1' }, null)
    const delivered = await service.deliverScanFile({ terminalId: 't_1', buffer: tinyPdf(), filename: 'id.pdf', mimeType: 'application/pdf' })
    const file = prisma.filesById.get(delivered.fileId)
    assert.equal(file?.purpose, 'id_scan')
    void created
  }

  {
    // scanType -> FilePurpose 映射正确（resume 扫描必须落 resume_scan）
    const { service, prisma } = makeService()
    const created = await service.create({ scanType: 'resume', terminalId: 't_1' }, null)
    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: tinyPdf(),
      filename: 'resume.pdf',
      mimeType: 'application/pdf',
    })
    const file = prisma.filesById.get(delivered.fileId)
    assert.equal(file?.purpose, 'resume_scan')
    void created
  }

  {
    // create() 的终端查找同时支持传内部 id 或人类可读的 terminalCode（如 'T-001'）。
    const { service, prisma } = makeService()
    const created = await service.create({ scanType: 'document', terminalId: 'T-001' }, null)
    assert.ok(created.scanTaskId, 'must succeed when terminalId is actually a terminalCode')
    const task = prisma.scanTasksById.get(created.scanTaskId)
    assert.equal(task?.terminalId, 't_1', 'resolved terminalId must be the internal id, not the raw terminalCode')
  }

  {
    // deliverScanFile 的 catch 分支:this.files.upload() 抛错时，任务落 failed +
    // errorCode: 'SCAN_UPLOAD_FAILED'，原始错误信息存入 DB 的 errorMessage，然后原样 rethrow。
    // getStatus() 对外必须把 errorCode 映射成 USER_FACING_SCAN_ERROR 里的白名单文案，
    // 绝不能把原始错误信息透出给用户。
    const prisma = new FakePrisma()
    const throwingFiles = {
      upload: async (): Promise<never> => {
        throw new Error('ENOSPC: disk full — this raw detail must never reach the user')
      },
    }
    const service = new ScanTasksService(prisma as never, throwingFiles as never, passthroughCapabilities)
    const created = await service.create(dto, null)

    await expectRejects(
      () =>
        service.deliverScanFile({
          terminalId: 't_1',
          buffer: tinyPdf(),
          filename: 'broken.pdf',
          mimeType: 'application/pdf',
        }),
      Error,
      'deliverScanFile must rethrow the original upload error',
    )

    const status = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(status.status, 'failed')
    assert.equal(status.errorCode, 'SCAN_UPLOAD_FAILED')
    assert.equal(
      status.errorMessage,
      '扫描文件处理失败，请重新扫描',
      'errorMessage must be the whitelisted user-facing string, not the raw thrown error message',
    )
  }

  {
    // cancel() 的 CAS 用 status:{in:['waiting','matched']}，已被投递匹配但尚未完成（matched）的任务同样可取消，
    // 不能只认 waiting。
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    const task = prisma.scanTasksById.get(created.scanTaskId)!
    prisma.scanTasksById.set(created.scanTaskId, { ...task, status: 'matched' })
    const cancelled = await service.cancel(created.scanTaskId, null, created.controlToken)
    assert.equal(cancelled.status, 'cancelled')
  }

  {
    // 取消后的任务不再是 waiting，不能被后续投递误撞；投递必须匹配到之后新建的会话。
    const { service } = makeService()
    const first = await service.create(dto, null)
    const cancelled = await service.cancel(first.scanTaskId, null, first.controlToken)
    assert.equal(cancelled.status, 'cancelled')
    const second = await service.create(dto, null)
    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: tinyPdf(),
      filename: 'fresh.pdf',
      mimeType: 'application/pdf',
    })
    assert.equal(delivered.scanTaskId, second.scanTaskId, 'delivery must match the fresh session, not the cancelled one')
  }

  {
    // deliverScanFile 完成 CAS：文件上传成功后如果任务在此期间被并发取消（模拟：upload 回调里
    // 直接把任务状态改成 cancelled），完成写入 `updateMany({where:{status:'matched'}})` 必须命中 0 行，
    // 诚实抛 409 ConflictException（SCAN_TASK_STATE_CHANGED），不得静默把文件挂到一个已取消的任务上，
    // 也不能假装投递成功。
    //
    // B1-6：既然文件已经真实上传成功却挂不上任务，deliverScanFile() 必须调用
    // FilesService.systemDelete() 补偿删除这个孤儿文件——断言 systemDelete 真的被调用，
    // 且传入的 fileId 正是刚上传出来的那个（不是随便一个值），并且文件在存储层真的被标记删除了
    // （不是只调用了方法但没有实际效果）。
    const prisma = new FakePrisma()
    const baseFiles = new FakeFilesService(prisma)
    let raceScanTaskId = ''
    const racyFiles = {
      upload: async (args: Parameters<FakeFilesService['upload']>[0]) => {
        const result = await baseFiles.upload(args)
        const task = prisma.scanTasksById.get(raceScanTaskId)!
        prisma.scanTasksById.set(raceScanTaskId, { ...task, status: 'cancelled' })
        return result
      },
      systemDelete: (fileId: string, reason: string) => baseFiles.systemDelete(fileId, reason),
    }
    const service = new ScanTasksService(prisma as never, racyFiles as never, passthroughCapabilities)
    const created = await service.create(dto, null)
    raceScanTaskId = created.scanTaskId

    await expectRejects(
      () =>
        service.deliverScanFile({
          terminalId: 't_1',
          buffer: tinyPdf(),
          filename: 'race.pdf',
          mimeType: 'application/pdf',
        }),
      ConflictException,
      'deliver must refuse to complete a task cancelled during upload',
    )

    const status = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(status.status, 'cancelled', 'task must remain cancelled, not silently marked completed')

    assert.equal(
      baseFiles.systemDeleteCalls.length,
      1,
      'orphaned file must be compensating-deleted exactly once via FilesService.systemDelete()',
    )
    const orphanedFileId = baseFiles.systemDeleteCalls[0]!.fileId
    assert.ok(orphanedFileId.startsWith('file_'), 'systemDelete must be called with the real uploaded fileId, not a placeholder')
    assert.equal(
      baseFiles.systemDeleteCalls[0]!.reason,
      'ScanTask cancelled during upload, compensating orphaned file',
      'reason string must be diagnostic, not empty/generic',
    )
    const orphanedFileRecord = prisma.filesById.get(orphanedFileId)
    assert.ok(orphanedFileRecord?.deletedAt, 'orphaned FileObject must actually be marked deleted, not just have systemDelete() invoked without effect')
  }

  {
    // B1-6：补偿删除本身失败时（例如文件已经被其它路径清理掉，systemDelete() 内部
    // requireAlive() 抛 NotFoundException），deliverScanFile() 原本要走的 409
    // SCAN_TASK_STATE_CHANGED 取消响应流程绝不能被 systemDelete 的异常打断或替换掉——
    // 调用方必须依然看到 ConflictException，而不是 systemDelete 抛出的 NotFoundException
    // 泄漏出来变成一个未预期的错误类型。
    const prisma = new FakePrisma()
    const baseFiles = new FakeFilesService(prisma)
    let raceScanTaskId = ''
    let systemDeleteCallCount = 0
    const racyFiles = {
      upload: async (args: Parameters<FakeFilesService['upload']>[0]) => {
        const result = await baseFiles.upload(args)
        const task = prisma.scanTasksById.get(raceScanTaskId)!
        prisma.scanTasksById.set(raceScanTaskId, { ...task, status: 'cancelled' })
        return result
      },
      systemDelete: async (): Promise<never> => {
        systemDeleteCallCount += 1
        throw new NotFoundException({ error: { code: 'FILE_NOT_FOUND', message: '文件不存在或已被清理' } })
      },
    }
    const service = new ScanTasksService(prisma as never, racyFiles as never, passthroughCapabilities)
    const created = await service.create(dto, null)
    raceScanTaskId = created.scanTaskId

    await expectRejects(
      () =>
        service.deliverScanFile({
          terminalId: 't_1',
          buffer: tinyPdf(),
          filename: 'race-cleanup-fails.pdf',
          mimeType: 'application/pdf',
        }),
      ConflictException,
      'original SCAN_TASK_STATE_CHANGED conflict must still surface even when compensating systemDelete() itself throws',
    )

    assert.equal(systemDeleteCallCount, 1, 'systemDelete must have actually been attempted (not skipped)')

    const status = await service.getStatus(created.scanTaskId, null, created.controlToken)
    assert.equal(
      status.status,
      'cancelled',
      'original cancel-response flow must proceed normally (task stays cancelled) despite the compensating delete failing',
    )
  }

  {
    // cancel() 自身的 CAS 竞态分支：读取时任务还是 waiting/matched（早前检查全部放行），
    // 但在 CAS 的 updateMany 落地前状态被并发改成了 CAS 不认的值（例如刚好过期/被其它路径终结），
    // 导致 updateMany 命中 0 行——此时 cancel() 必须重新读取真实状态，
    // 由于它不是 completed，应诚实抛 409 SCAN_TASK_CANCEL_CONFLICT，而不是谎称取消成功。
    //
    // 模拟手法：monkey-patch FakePrisma.scanTask.updateMany，让它的第一次调用无条件返回
    // { count: 0 }（相当于"别人刚好赢了这场竞态"），同时底层任务真实状态仍是 waiting，
    // 之后的调用恢复原始实现。这样断言真正依赖 cancel() 自己的重读分支，
    // 而不是复用 create()/deliverScanFile() 的其它 CAS 路径。
    const prisma = new FakePrisma()
    const files = new FakeFilesService(prisma)
    const originalUpdateMany = prisma.scanTask.updateMany.bind(prisma.scanTask)
    let updateManyCallCount = 0
    prisma.scanTask.updateMany = (async (args: Parameters<typeof originalUpdateMany>[0]) => {
      updateManyCallCount += 1
      if (updateManyCallCount === 1) {
        return { count: 0 }
      }
      return originalUpdateMany(args)
    }) as typeof originalUpdateMany

    const service = new ScanTasksService(prisma as never, files as never, passthroughCapabilities)
    const created = await service.create(dto, null)
    assert.equal(prisma.scanTasksById.get(created.scanTaskId)?.status, 'waiting')

    let caught: unknown
    try {
      await service.cancel(created.scanTaskId, null, created.controlToken)
    } catch (error) {
      caught = error
    }
    assert.ok(caught instanceof ConflictException, `cancel CAS conflict: expected ConflictException, got ${(caught as Error)?.constructor.name}`)
    const responseBody = (caught as ConflictException).getResponse() as { error?: { code?: string } }
    assert.equal(
      responseBody.error?.code,
      'SCAN_TASK_CANCEL_CONFLICT',
      'cancel CAS conflict must report SCAN_TASK_CANCEL_CONFLICT, not silently succeed or report a different code',
    )
  }

  {
    // B1-5：ScanTaskReaperTask 收敛卡在 'matched' 状态太久的任务。
    // 三条互相制衡的断言，专门防"看起来在跑但其实什么都没测出来"：
    //   1) 超过阈值(3min)的 'matched' 任务必须被 reap 成 failed + SCAN_MATCHED_TIMEOUT
    //      ——防"reaper 是个空实现/永远不生效"；
    //   2) 未超过阈值的 'matched' 任务必须原样保留
    //      ——防"reaper 不看 updatedAt，把所有 matched 任务不分青红皂白全部 reap"；
    //   3) 同样很旧但状态是 'waiting' 的任务必须原样保留
    //      ——防"reaper 的 where 条件漏掉了 status 过滤，把不相干状态也一起扫了"。
    const { service, prisma } = makeService()
    const reaper = new ScanTaskReaperTask(prisma as never)

    const stale = await service.create(dto, null)
    await prisma.scanTask.updateMany({ where: { id: stale.scanTaskId, status: 'waiting' }, data: { status: 'matched' } })
    const staleStored = prisma.scanTasksById.get(stale.scanTaskId)!
    // 4 分钟前——超过 reaper 的 3 分钟阈值。
    prisma.scanTasksById.set(stale.scanTaskId, { ...staleStored, updatedAt: new Date(Date.now() - 4 * 60 * 1000) })

    const fresh = await service.create(dto, null)
    await prisma.scanTask.updateMany({ where: { id: fresh.scanTaskId, status: 'waiting' }, data: { status: 'matched' } })
    // fresh 保持刚更新的 updatedAt（现在），在阈值内。

    const oldWaiting = await service.create(dto, null)
    const oldWaitingStored = prisma.scanTasksById.get(oldWaiting.scanTaskId)!
    // 同样很旧（早于阈值），但状态仍是 'waiting'，不应被这个 reaper 触碰
    // （'waiting' 的过期收敛是另一条既有的惰性过期路径，不归 B1-5 管）。
    prisma.scanTasksById.set(oldWaiting.scanTaskId, { ...oldWaitingStored, updatedAt: new Date(Date.now() - 10 * 60 * 1000) })

    await reaper.reapStuckMatched()

    const staleAfter = prisma.scanTasksById.get(stale.scanTaskId)!
    assert.equal(staleAfter.status, 'failed', 'stale matched task (>3min) must be reaped to failed')
    assert.equal(staleAfter.errorCode, 'SCAN_MATCHED_TIMEOUT', 'reaped task must carry errorCode SCAN_MATCHED_TIMEOUT')

    // errorMessage 必须经 service.getStatus() 校验，而不是直接读裸 Prisma 行：getStatus() 会把
    // errorCode 映射过 USER_FACING_SCAN_ERROR 白名单，raw DB 行只是 reaper 自己写入的中间态，
    // 不代表用户最终能看到什么。这里镜像既有 SCAN_UPLOAD_FAILED 用例的写法（本文件上方
    // "deliverScanFile 的 catch 分支" 那个测试块），是唯一真正锁定"reaper 写的 errorCode
    // 必须在白名单里登记"这条要求的断言——如果 SCAN_MATCHED_TIMEOUT 没有登记进
    // USER_FACING_SCAN_ERROR，getStatus() 会 fallback 成通用文案，这里就会失败。
    const staleStatus = await service.getStatus(stale.scanTaskId, null, stale.controlToken)
    assert.equal(staleStatus.status, 'failed')
    assert.equal(staleStatus.errorCode, 'SCAN_MATCHED_TIMEOUT')
    assert.equal(
      staleStatus.errorMessage,
      '扫描处理超时未完成',
      'getStatus() must return the whitelisted user-facing errorMessage for a reaped task, not the generic fallback',
    )

    const freshAfter = prisma.scanTasksById.get(fresh.scanTaskId)!
    assert.equal(freshAfter.status, 'matched', 'fresh matched task (<3min) must NOT be touched by the reaper')

    const oldWaitingAfter = prisma.scanTasksById.get(oldWaiting.scanTaskId)!
    assert.equal(oldWaitingAfter.status, 'waiting', "old 'waiting' task must NOT be touched by the matched-state reaper")

    // 再跑一次：此时已经没有符合条件的任务了，必须是稳定的 no-op（不重复收敛、不抛错），
    // 防止 reaper 对已经是 failed 的任务重复计数或异常。
    const staleAfterFirstRun = { ...staleAfter }
    await reaper.reapStuckMatched()
    const staleAfterSecondRun = prisma.scanTasksById.get(stale.scanTaskId)!
    assert.equal(staleAfterSecondRun.status, 'failed', 'already-reaped task must remain failed on a second run')
    assert.equal(
      staleAfterSecondRun.errorCode,
      staleAfterFirstRun.errorCode,
      'second no-op run must not mutate an already-reaped task again',
    )
  }

  {
    // B1-5 补充：同一 tick 内、跨不同终端的多条卡死 'matched' 任务必须被一次 reapStuckMatched()
    // 调用全部收敛（而不是只处理其中一条就停手，或者需要多次调用才能收敛干净）。
    // 用两个不同终端（t_1 / t_2）分别制造一条陈旧 'matched' 行，证明 reaper 的 updateMany 是
    // 批量 WHERE 匹配，不是逐条处理后提前 return。
    const { service, prisma } = makeService()
    const reaper = new ScanTaskReaperTask(prisma as never)

    const staleA = await service.create({ scanType: 'document', terminalId: 't_1' }, null)
    await prisma.scanTask.updateMany({ where: { id: staleA.scanTaskId, status: 'waiting' }, data: { status: 'matched' } })
    const staleAStored = prisma.scanTasksById.get(staleA.scanTaskId)!
    prisma.scanTasksById.set(staleA.scanTaskId, { ...staleAStored, updatedAt: new Date(Date.now() - 4 * 60 * 1000) })

    const staleB = await service.create({ scanType: 'document', terminalId: 't_2' }, null)
    await prisma.scanTask.updateMany({ where: { id: staleB.scanTaskId, status: 'waiting' }, data: { status: 'matched' } })
    const staleBStored = prisma.scanTasksById.get(staleB.scanTaskId)!
    prisma.scanTasksById.set(staleB.scanTaskId, { ...staleBStored, updatedAt: new Date(Date.now() - 5 * 60 * 1000) })

    const result = await reaper.reapStuckMatched()
    assert.equal(result.count, 2, 'a single reap tick must report reaping both independently-stale matched rows across two terminals')

    const staleAAfter = prisma.scanTasksById.get(staleA.scanTaskId)!
    const staleBAfter = prisma.scanTasksById.get(staleB.scanTaskId)!
    assert.equal(staleAAfter.status, 'failed', 'terminal t_1 stale matched task must be reaped in the same tick')
    assert.equal(staleBAfter.status, 'failed', 'terminal t_2 stale matched task must be reaped in the same tick')
    assert.equal(staleAAfter.errorCode, 'SCAN_MATCHED_TIMEOUT')
    assert.equal(staleBAfter.errorCode, 'SCAN_MATCHED_TIMEOUT')
  }

  {
    // B1-10：deliverScanFile() 必须在 CAS-to-matched 成功后、上传真正开始前就武装
    // 'matched' 心跳，并且无论上传成功、还是抛异常，都必须在 finally 里清掉这个定时器——
    // 遗漏会让每一次扫描投递都泄漏一个 setInterval。
    //
    // 用 spy 替换 private startMatchedHeartbeat()（TS 的 private 只是编译期限制，运行时
    // 可以直接赋值覆盖）返回一个可辨识的哨兵句柄而不真的起定时器；spy 全局 clearInterval
    // 记录传入的句柄；upload 内部记录调用时刻心跳是否已经被武装——三者合起来断言"武装
    // 时机"（早于 upload）和"清除时机"（成功/失败都发生且恰好一次），不依赖真实定时器
    // 触发，跑得快且完全确定。
    const clearedHandles: unknown[] = []
    const originalClearInterval = global.clearInterval
    global.clearInterval = ((handle: unknown) => {
      clearedHandles.push(handle)
    }) as typeof global.clearInterval

    try {
      {
        // 成功路径
        const prisma = new FakePrisma()
        const baseFiles = new FakeFilesService(prisma)
        const heartbeatCalls: string[] = []
        let armedBeforeUploadStarted = false
        const sentinelHandle = { tag: 'heartbeat-success' } as unknown as NodeJS.Timeout
        const observingFiles = {
          upload: async (args: Parameters<FakeFilesService['upload']>[0]) => {
            armedBeforeUploadStarted = heartbeatCalls.length === 1
            return baseFiles.upload(args)
          },
        }
        const service = new ScanTasksService(prisma as never, observingFiles as never, passthroughCapabilities)
        ;(service as unknown as HeartbeatTestAccess).startMatchedHeartbeat = (id: string) => {
          heartbeatCalls.push(id)
          return sentinelHandle
        }

        const created = await service.create(dto, null)
        await service.deliverScanFile({
          terminalId: 't_1',
          buffer: tinyPdf(),
          filename: 'heartbeat.pdf',
          mimeType: 'application/pdf',
        })

        assert.equal(heartbeatCalls.length, 1, 'startMatchedHeartbeat must be called exactly once per deliverScanFile()')
        assert.equal(heartbeatCalls[0], created.scanTaskId, 'heartbeat must be armed for the matched task id')
        assert.ok(armedBeforeUploadStarted, 'heartbeat must be armed before FilesService.upload() begins, not after')
        assert.equal(clearedHandles.length, 1, 'heartbeat handle must be cleared exactly once on the success path')
        assert.equal(
          clearedHandles[0],
          sentinelHandle,
          'clearInterval must be called with the exact handle startMatchedHeartbeat returned',
        )
      }

      {
        // 失败路径（upload 抛异常）——finally 保证依然要清心跳，且原有的 SCAN_UPLOAD_FAILED
        // 标记流程不受影响。
        clearedHandles.length = 0
        const prisma = new FakePrisma()
        const sentinelHandle = { tag: 'heartbeat-failure' } as unknown as NodeJS.Timeout
        const throwingFiles = {
          upload: async (): Promise<never> => {
            throw new Error('simulated upload failure')
          },
        }
        const service = new ScanTasksService(prisma as never, throwingFiles as never, passthroughCapabilities)
        ;(service as unknown as HeartbeatTestAccess).startMatchedHeartbeat = () => sentinelHandle

        await service.create(dto, null)
        await expectRejects(
          () =>
            service.deliverScanFile({
              terminalId: 't_1',
              buffer: tinyPdf(),
              filename: 'heartbeat-fail.pdf',
              mimeType: 'application/pdf',
            }),
          Error,
          'upload failure must still propagate',
        )
        assert.equal(
          clearedHandles.length,
          1,
          'heartbeat handle must be cleared exactly once even when upload throws (finally guarantee)',
        )
        assert.equal(clearedHandles[0], sentinelHandle)
      }
    } finally {
      global.clearInterval = originalClearInterval
    }
  }

  {
    // B1-10 补充：心跳的真实实现（不是上面的 spy）必须满足两条设计约束：
    //   1) 单次心跳写入失败（例如瞬时 DB 抖动）不能抛出、不能让后续 tick 停摆——
    //      只降级为 warn 日志，继续下一次 tick；
    //   2) where 条件必须与 reaper 一致（status: 'matched'）：任务如果已经并发转移到
    //      其它终态，心跳只能安静 no-op，不能把它"复活"回 matched，也不能报错。
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    await prisma.scanTask.updateMany({ where: { id: created.scanTaskId, status: 'waiting' }, data: { status: 'matched' } })

    const originalUpdateMany = prisma.scanTask.updateMany.bind(prisma.scanTask)
    let tickCount = 0
    prisma.scanTask.updateMany = (async (args: Parameters<typeof originalUpdateMany>[0]) => {
      tickCount += 1
      if (tickCount === 1) {
        throw new Error('simulated transient DB hiccup on first heartbeat tick')
      }
      return originalUpdateMany(args)
    }) as typeof originalUpdateMany

    const beforeTicks = prisma.scanTasksById.get(created.scanTaskId)!.updatedAt.getTime()
    const heartbeat = (service as unknown as HeartbeatTestAccess).startMatchedHeartbeat(created.scanTaskId, 15)
    // 生产间隔是 60s；这里用 15ms 只是为了在几十毫秒内验证机制本身会真的多次 tick，不用等 60s。
    await sleep(80)
    clearInterval(heartbeat)

    assert.ok(
      tickCount >= 2,
      `heartbeat must have ticked more than once within the wait window (got ${tickCount}); a single failed tick must not stop subsequent ticks`,
    )
    const afterTicks = prisma.scanTasksById.get(created.scanTaskId)!
    assert.ok(
      afterTicks.updatedAt.getTime() > beforeTicks,
      'updatedAt must have been bumped by a later successful tick despite the first tick throwing',
    )
    assert.equal(afterTicks.status, 'matched', 'heartbeat must not alter status, only updatedAt')

    prisma.scanTask.updateMany = originalUpdateMany as typeof prisma.scanTask.updateMany

    // 并发把任务状态改成 'cancelled'（模拟用户在上传过程中取消），确认心跳下一轮 tick 是
    // 安静的 no-op：updatedAt 不再被心跳刷新，status 不被心跳篡改回 matched。
    prisma.scanTasksById.set(created.scanTaskId, { ...afterTicks, status: 'cancelled' })
    const cancelledSnapshotUpdatedAt = afterTicks.updatedAt.getTime()
    const heartbeat2 = (service as unknown as HeartbeatTestAccess).startMatchedHeartbeat(created.scanTaskId, 15)
    await sleep(60)
    clearInterval(heartbeat2)

    const afterCancelledTicks = prisma.scanTasksById.get(created.scanTaskId)!
    assert.equal(
      afterCancelledTicks.status,
      'cancelled',
      'heartbeat must never resurrect a task that concurrently left the matched state',
    )
    assert.equal(
      afterCancelledTicks.updatedAt.getTime(),
      cancelledSnapshotUpdatedAt,
      "heartbeat's where:{status:'matched'} must make ticks a true no-op once the task is no longer matched — updatedAt must not move",
    )
  }

  {
    // B1-10：真实数据库验证——见 assertRealDbMatchedHeartbeatClosesRace() 顶部注释：
    // 真实 reaper（未改 3 分钟阈值）+ 真实 startMatchedHeartbeat()，证明本次修复关闭的
    // "慢但存活的上传被 reaper 误杀"竞态，同时证明"真正卡死的任务依然会被正确收敛"。
    const apiRoot = path.resolve(__dirname, '..')
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'verify-scan-tasks-realdb-heartbeat-'))
    const dbPath = path.join(tmpDir, 'verify.db')
    const dbUrl = `file:${dbPath}`
    try {
      execFileSync(path.join(apiRoot, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
        cwd: apiRoot,
        env: { ...process.env, DATABASE_URL: dbUrl },
        stdio: 'pipe',
      })
      await assertRealDbMatchedHeartbeatClosesRace(dbUrl)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  {
    // B1-11（点 4 边缘案例修复）：内容级去重必须真正拦住"同一份文件内容对同一终端重复
    // 投递"——模拟"投递其实已经在服务端成功，只是 HTTP 响应在回传给 Agent 途中丢失，
    // Agent 把它当成失败重试"的场景：第一次投递真正建档完成，第二次投递携带完全相同的
    // 字节，此时该终端已经有一条全新的（属于另一个用户的）waiting 任务在等——如果没有
    // 这层去重，第二次投递会被误判成"新的合法投递"，把第一个用户的内容错误挂到第二个
    // 用户的任务上。
    const { service, prisma } = makeService()
    const buffer = tinyPdf()

    const taskA = await service.create(dto, 'member_a')
    const deliveredA = await service.deliverScanFile({ terminalId: 't_1', buffer, filename: 'a.pdf', mimeType: 'application/pdf' })
    assert.equal(deliveredA.scanTaskId, taskA.scanTaskId)

    // 模拟场景：另一个用户（member_b）在同一物理终端开了一个全新的等待中任务。
    const taskB = await service.create(dto, 'member_b')

    let caught: unknown
    try {
      await service.deliverScanFile({ terminalId: 't_1', buffer, filename: 'a-retry.pdf', mimeType: 'application/pdf' })
    } catch (error) {
      caught = error
    }
    assert.ok(
      caught instanceof ConflictException,
      `duplicate content delivery (same bytes, retried after original success) must be rejected, not silently matched to a new task — got ${(caught as Error)?.constructor?.name}`,
    )
    const responseBody = (caught as ConflictException).getResponse() as { error?: { code?: string } }
    assert.equal(
      responseBody.error?.code,
      'SCAN_FILE_ALREADY_DELIVERED',
      'duplicate content rejection must report the specific SCAN_FILE_ALREADY_DELIVERED code, not a generic conflict',
    )

    // taskB 必须原封不动地保持 waiting——绝不能被这次重复投递偷走匹配、挂上别人的文件。
    const taskBAfter = prisma.scanTasksById.get(taskB.scanTaskId)!
    assert.equal(taskBAfter.status, 'waiting', 'the duplicate-content delivery must NOT consume/match an unrelated waiting task belonging to a different user')
    assert.equal(taskBAfter.fileId, null, 'the unrelated waiting task must not end up with any fileId attached')
  }

  {
    // 回归护栏：内容去重绝不能变成"同一终端连续两次投递就一律拒绝"——必须精确按字节
    // 内容判断，两次内容不同的合法投递都必须正常成功，不能被误伤。
    const { service } = makeService()
    const taskA = await service.create(dto, null)
    const deliveredA = await service.deliverScanFile({ terminalId: 't_1', buffer: tinyPdf(), filename: 'a.pdf', mimeType: 'application/pdf' })
    assert.equal(deliveredA.scanTaskId, taskA.scanTaskId)

    const taskB = await service.create(dto, null)
    const differentBuffer = Buffer.from('%PDF-1.4\ncompletely different content, not a duplicate\n%%EOF\n', 'latin1')
    const deliveredB = await service.deliverScanFile({ terminalId: 't_1', buffer: differentBuffer, filename: 'b.pdf', mimeType: 'application/pdf' })
    assert.equal(
      deliveredB.scanTaskId,
      taskB.scanTaskId,
      'a second delivery with genuinely different content must succeed normally, not be blocked by the dedup guard',
    )
  }

  {
    // 去重窗口边界：SCAN_CONTENT_DEDUP_WINDOW_MS（2 小时，刻意与 Agent 侧
    // DELIVERY_RETRY_MAX_MS 对齐——这是 Agent 理论上可能重试同一份文件的最大时间跨度）
    // 之外的历史投递不应该继续挡住"内容相同"的新投递：一是没必要无界查询更久以前的
    // 记录，二是 Agent 自己过了 2 小时就会放弃重试转入 _unclaimed，服务端理论上根本不会
    // 收到这么老的重试，窗口设计上没必要更长。
    const { service, prisma } = makeService()
    const buffer = tinyPdf()
    const taskA = await service.create(dto, null)
    await service.deliverScanFile({ terminalId: 't_1', buffer, filename: 'a.pdf', mimeType: 'application/pdf' })

    // 把 taskA 的 updatedAt 手工回拨到去重窗口之外（2 小时 + 5 分钟前）。
    const taskAStored = prisma.scanTasksById.get(taskA.scanTaskId)!
    prisma.scanTasksById.set(taskA.scanTaskId, {
      ...taskAStored,
      updatedAt: new Date(Date.now() - (2 * 60 * 60 * 1000 + 5 * 60 * 1000)),
    })

    const taskB = await service.create(dto, null)
    const deliveredB = await service.deliverScanFile({ terminalId: 't_1', buffer, filename: 'a-retry-old.pdf', mimeType: 'application/pdf' })
    assert.equal(
      deliveredB.scanTaskId,
      taskB.scanTaskId,
      'a delivery whose matching historical content falls outside the dedup window must proceed to normal matching, not be blocked forever',
    )
  }

  {
    // 去重必须按终端隔离：终端 t_1 上一次成功投递的内容，不能拿去挡终端 t_2 上一次完全
    // 独立的合法投递（哪怕字节恰好相同）——两个不同物理终端之间没有跨用户误挂载风险，
    // 不应该被误伤（本次修复的威胁模型是"同一终端、不同用户的先后两个会话"）。
    const { service } = makeService()
    const buffer = tinyPdf()
    await service.create({ scanType: 'document', terminalId: 't_1' }, null)
    await service.deliverScanFile({ terminalId: 't_1', buffer, filename: 'a.pdf', mimeType: 'application/pdf' })

    const taskT2 = await service.create({ scanType: 'document', terminalId: 't_2' }, null)
    const deliveredT2 = await service.deliverScanFile({ terminalId: 't_2', buffer, filename: 'a-on-t2.pdf', mimeType: 'application/pdf' })
    assert.equal(
      deliveredT2.scanTaskId,
      taskT2.scanTaskId,
      'dedup must be scoped per terminal — the same bytes delivered to a different terminal must not be blocked',
    )
  }

  {
    // 设计边界验证：SCAN_TASK_STATE_CHANGED 分支（任务在上传期间被并发取消）永远不会给
    // 对应任务写入 fileId（见 deliverScanFile() 的 CAS-to-completed 分支：
    // completed.count === 0 时不落 fileId），因此本次新增的内容级去重（只查 fileId 非空
    // 的任务）不会、也不应该拦住这类场景的重复投递——那条竞态的跨用户误挂载风险，是靠
    // Agent 侧收到 SCAN_TASK_STATE_CHANGED 后立即隔离、绝不重试来防住的（见
    // apps/terminal-agent/src/agent/scan-watcher.ts 的 B1-11 修复），不是本处内容去重
    // 的职责。这里用真实 deliverScanFile() 复现一次 SCAN_TASK_STATE_CHANGED，然后证明
    // "如果 Agent 没有照既定设计立即隔离、而是真的把同一份内容重试投递了"，服务端这层
    // 内容去重确实拦不住（fileId 从未被写入）——这正是 Agent 侧必须绝不重试的理由，
    // 不是服务端这层的漏网之鱼；防止未来有人误以为"反正服务端有去重了"就放宽 Agent
    // 侧的立即隔离行为。
    const prisma = new FakePrisma()
    const baseFiles = new FakeFilesService(prisma)
    let raceScanTaskId = ''
    const racyFiles = {
      upload: async (args: Parameters<FakeFilesService['upload']>[0]) => {
        const result = await baseFiles.upload(args)
        const task = prisma.scanTasksById.get(raceScanTaskId)!
        prisma.scanTasksById.set(raceScanTaskId, { ...task, status: 'cancelled' })
        return result
      },
      systemDelete: (fileId: string, reason: string) => baseFiles.systemDelete(fileId, reason),
    }
    const service = new ScanTasksService(prisma as never, racyFiles as never, passthroughCapabilities)
    const created = await service.create(dto, null)
    raceScanTaskId = created.scanTaskId
    const buffer = tinyPdf()

    await expectRejects(
      () => service.deliverScanFile({ terminalId: 't_1', buffer, filename: 'race.pdf', mimeType: 'application/pdf' }),
      ConflictException,
      'first attempt must hit SCAN_TASK_STATE_CHANGED as before (unrelated to this new dedup check)',
    )
    assert.equal(
      prisma.scanTasksById.get(raceScanTaskId)?.fileId,
      null,
      'sanity precondition: the state-changed task must never have fileId populated',
    )

    const taskB = await service.create(dto, null)
    const deliveredRetry = await service.deliverScanFile({ terminalId: 't_1', buffer, filename: 'race-retry.pdf', mimeType: 'application/pdf' })
    assert.equal(
      deliveredRetry.scanTaskId,
      taskB.scanTaskId,
      'content-hash dedup intentionally does NOT cover the SCAN_TASK_STATE_CHANGED scenario (fileId was never populated) — this gap is closed by the Agent-side immediate-quarantine fix instead, not here',
    )
  }

  {
    // B1-11 follow-up：真实 DB 端到端验证 deliverScanFile() 的内容级去重护栏本体
    // （见 assertRealDbDedupGuardClosesCrossUserLeak() 顶部注释——原提交声称做过这项验证，
    // 实际从未落地，这里补上真正的）。沿用 assertRealDbPartialUniqueIndex() 同款手法：
    // 独立临时 SQLite 文件 + 真实 `prisma migrate deploy`，全程不触碰进程当前的
    // DATABASE_URL / 共享 dev.db，跑完即删。
    const apiRoot = path.resolve(__dirname, '..')
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'verify-scan-tasks-realdb-dedup-'))
    const dbPath = path.join(tmpDir, 'verify.db')
    const dbUrl = `file:${dbPath}`

    try {
      execFileSync(path.join(apiRoot, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
        cwd: apiRoot,
        env: { ...process.env, DATABASE_URL: dbUrl },
        stdio: 'pipe',
      })

      await assertRealDbDedupGuardClosesCrossUserLeak(dbUrl)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  }

  console.log('PASS scan tasks verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
