import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-scan-tasks-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
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
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; status: StatusMatcher }
      data: Partial<StoredScanTask>
    }) => {
      const current = this.scanTasksById.get(where.id)
      if (!current || !statusMatches(current.status, where.status)) return { count: 0 }
      this.scanTasksById.set(where.id, { ...current, ...data, updatedAt: new Date() })
      return { count: 1 }
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

    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: Buffer.from('%PDF-1.4 scan'),
      filename: 'scan.pdf',
      mimeType: 'application/pdf',
    })
    assert.equal(delivered.scanTaskId, created.scanTaskId)
    // scanType -> FilePurpose 映射:document 扫描必须落 print_doc（顺带覆盖，不单开一个测试块）
    assert.equal(prisma.filesById.get(delivered.fileId)?.purpose, 'print_doc')

    const status = await service.getStatus(created.scanTaskId, null)
    assert.equal(status.status, 'completed')
    assert.equal(status.file?.fileId, delivered.fileId)
    assert.match(status.file?.fileUrl ?? '', /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/)
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
      () => service.deliverScanFile({ terminalId: 't_1', buffer: Buffer.from('x'), filename: 'stray.pdf', mimeType: 'application/pdf' }),
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
    const delivered = await service.deliverScanFile({ terminalId: 't_1', buffer: Buffer.from('x'), filename: 'a.pdf', mimeType: 'application/pdf' })
    assert.equal(delivered.scanTaskId, first.scanTaskId, 'must match the oldest waiting task, not the newest')
    void second
  }

  {
    // 过期任务在查询时惰性转 expired，且不能再被投递匹配
    const { service, prisma } = makeService()
    const created = await service.create(dto, null)
    const task = prisma.scanTasksById.get(created.scanTaskId)!
    prisma.scanTasksById.set(created.scanTaskId, { ...task, expiresAt: new Date(Date.now() - 1000) })
    const status = await service.getStatus(created.scanTaskId, null)
    assert.equal(status.status, 'expired')
    await expectRejects(
      () => service.deliverScanFile({ terminalId: 't_1', buffer: Buffer.from('x'), filename: 'late.pdf', mimeType: 'application/pdf' }),
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

    await service.getStatus(created.scanTaskId, null)

    assert.equal(
      prisma.scanTasksById.get(created.scanTaskId)?.status,
      'cancelled',
      'lazy-expire write must not clobber a concurrently cancelled task back to expired',
    )
  }

  {
    // 他人不能查看 / 取消绑定了 endUserId 的任务
    const { service } = makeService()
    const created = await service.create(dto, 'member_1')
    await expectRejects(() => service.getStatus(created.scanTaskId, 'member_2'), ForbiddenException, 'status forbidden for non-owner')
    await expectRejects(() => service.cancel(created.scanTaskId, 'member_2'), ForbiddenException, 'cancel forbidden for non-owner')
    const cancelled = await service.cancel(created.scanTaskId, 'member_1')
    assert.equal(cancelled.status, 'cancelled')
  }

  {
    // 已完成任务不能取消（cancel() 在 CAS 之前就做了 completed 前置检查）
    const { service } = makeService()
    const created = await service.create(dto, null)
    await service.deliverScanFile({ terminalId: 't_1', buffer: Buffer.from('x'), filename: 'a.pdf', mimeType: 'application/pdf' })
    await expectRejects(() => service.cancel(created.scanTaskId, null), BadRequestException, 'completed task cannot be cancelled')
  }

  {
    // 不存在的任务查询 / 取消都应 404
    const { service } = makeService()
    await expectRejects(() => service.getStatus('missing', null), NotFoundException, 'status not found')
    await expectRejects(() => service.cancel('missing', null), NotFoundException, 'cancel not found')
  }

  {
    // scanType -> FilePurpose 映射正确（id 扫描必须落 id_scan，不能落成通用 print_doc）
    const { service, prisma } = makeService()
    const created = await service.create({ scanType: 'id', terminalId: 't_1' }, null)
    const delivered = await service.deliverScanFile({ terminalId: 't_1', buffer: Buffer.from('x'), filename: 'id.pdf', mimeType: 'application/pdf' })
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
      buffer: Buffer.from('x'),
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
          buffer: Buffer.from('x'),
          filename: 'broken.pdf',
          mimeType: 'application/pdf',
        }),
      Error,
      'deliverScanFile must rethrow the original upload error',
    )

    const status = await service.getStatus(created.scanTaskId, null)
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
    const cancelled = await service.cancel(created.scanTaskId, null)
    assert.equal(cancelled.status, 'cancelled')
  }

  {
    // 取消后的任务不再是 waiting，不能被后续投递误撞；投递必须匹配到之后新建的会话。
    const { service } = makeService()
    const first = await service.create(dto, null)
    const cancelled = await service.cancel(first.scanTaskId, null)
    assert.equal(cancelled.status, 'cancelled')
    const second = await service.create(dto, null)
    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      buffer: Buffer.from('x'),
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
          buffer: Buffer.from('x'),
          filename: 'race.pdf',
          mimeType: 'application/pdf',
        }),
      ConflictException,
      'deliver must refuse to complete a task cancelled during upload',
    )

    const status = await service.getStatus(created.scanTaskId, null)
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
      await service.cancel(created.scanTaskId, null)
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

  console.log('PASS scan tasks verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
