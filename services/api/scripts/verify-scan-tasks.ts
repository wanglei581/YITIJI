import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-scan-tasks-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '../src/generated/prisma/client'
import { ScanTaskReaperTask } from '../src/scan-tasks/scan-task-reaper.task'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import type { CreateScanTaskDto } from '../src/scan-tasks/dto/create-scan-task.dto'

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
  }

  readonly fileObject = {
    findUnique: async ({ where }: { where: { id: string } }) => this.filesById.get(where.id) ?? null,
  }
}

class FakeFilesService {
  private seq = 1
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
      sha256: `sha_${id}`,
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
}

function makeService(): { service: ScanTasksService; prisma: FakePrisma } {
  const prisma = new FakePrisma()
  const files = new FakeFilesService(prisma)
  return { service: new ScanTasksService(prisma as never, files as never, passthroughCapabilities), prisma }
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

  console.log('PASS scan tasks verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
