process.env['FILE_SIGNING_SECRET'] ||= 'verify-scan-tasks-secret-0123456789-abcdef'
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-scan-tasks-admin-secret'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-scan-tasks-action-secret'

import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common'
import {
  ScanTasksService,
  SCAN_MAX_FUTURE_OBSERVATION_MS,
  SCAN_STALE_CAPTURE_TOLERANCE_MS,
} from '../src/scan-tasks/scan-tasks.service'
import {
  buildScanDeliveryLease,
  signScanDeliveryLease,
  getScanLeaseSecret,
  type ScanDeliveryLeasePayload,
} from '../src/scan-tasks/scan-lease'

interface FakeTask {
  id: string
  terminalId: string
  scanType: string
  status: string
  endUserId: string | null
  fileId: string | null
  matchedFileMtime: Date | null
  lastAttemptHash: string | null
  errorCode: string | null
  errorMessage: string | null
  controlTokenHash: string | null
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

export class ScanContractTestPrisma {
  scanTasksById = new Map<string, FakeTask>()
  fileObjectsById = new Map<string, { id: string; sha256: string }>()
  private counter = 1

  readonly $transaction = async <T>(callback: (tx: this) => Promise<T>): Promise<T> => callback(this)

  terminal = {
    findFirst: async ({ where }: { where: { id?: string; terminalCode?: string } }) => {
      const id = where.id ?? where.terminalCode ?? 't_1'
      return { id, terminalCode: id, enabled: true, lifecycleStatus: 'active' }
    },
    updateMany: async () => ({ count: 1 }),
  }

  scanTask = {
    findFirst: async ({ where }: { where: { terminalId: string; status?: string; expiresAt?: { gt: Date }; lastAttemptHash?: string; updatedAt?: { gt: Date } } }) => {
      for (const t of this.scanTasksById.values()) {
        if (t.terminalId !== where.terminalId) continue
        if (where.status !== undefined && t.status !== where.status) continue
        if (where.lastAttemptHash !== undefined && t.lastAttemptHash !== where.lastAttemptHash) continue
        if (where.expiresAt?.gt !== undefined && !(t.expiresAt.getTime() > where.expiresAt.gt.getTime())) continue
        if (where.updatedAt?.gt !== undefined && !(t.updatedAt.getTime() > where.updatedAt.gt.getTime())) continue
        return t
      }
      return null
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      return this.scanTasksById.get(where.id) ?? null
    },
    findMany: async ({ where }: { where: { terminalId: string; fileId?: { not: null }; updatedAt?: { gt: Date } } }) => {
      const results: FakeTask[] = []
      for (const t of this.scanTasksById.values()) {
        if (t.terminalId !== where.terminalId) continue
        if (where.fileId?.not === null && t.fileId === null) continue
        if (where.updatedAt?.gt !== undefined && !(t.updatedAt.getTime() > where.updatedAt.gt.getTime())) continue
        results.push(t)
      }
      return results
    },
    create: async ({ data }: { data: Partial<FakeTask> }) => {
      const id = `scan_${this.counter++}`
      const now = new Date()
      const task: FakeTask = {
        id,
        terminalId: data.terminalId!,
        scanType: data.scanType ?? 'document',
        status: 'waiting',
        endUserId: data.endUserId ?? null,
        fileId: null,
        matchedFileMtime: null,
        lastAttemptHash: null,
        errorCode: null,
        errorMessage: null,
        controlTokenHash: data.controlTokenHash ?? null,
        expiresAt: data.expiresAt ?? new Date(now.getTime() + 10 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
      }
      this.scanTasksById.set(id, task)
      return task
    },
    updateMany: async ({ where, data }: { where: { id: string; status?: string | { in: string[] } }; data: Partial<FakeTask> }) => {
      const task = this.scanTasksById.get(where.id)
      if (!task) return { count: 0 }
      if (where.status !== undefined) {
        const matches = typeof where.status === 'string' ? task.status === where.status : where.status.in.includes(task.status)
        if (!matches) return { count: 0 }
      }
      const updated = { ...task, ...data, updatedAt: new Date() }
      this.scanTasksById.set(where.id, updated)
      return { count: 1 }
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<FakeTask> }) => {
      const task = this.scanTasksById.get(where.id)
      if (!task) throw new Error('not found')
      const updated = { ...task, ...data, updatedAt: new Date() }
      this.scanTasksById.set(where.id, updated)
      return updated
    },
  }

  fileObject = {
    findFirst: async ({ where }: { where: { id: { in: string[] }; sha256: string } }) => {
      for (const id of where.id.in) {
        const file = this.fileObjectsById.get(id)
        if (file && file.sha256 === where.sha256) return file
      }
      return null
    },
  }
}

function makeContractHarness() {
  const prisma = new ScanContractTestPrisma()
  let fileIdCounter = 1
  const filesService = {
    upload: async ({ buffer, originalname, mimeType }: { buffer: Buffer; originalname: string; mimeType: string }) => {
      const fileId = `file_${fileIdCounter++}`
      const sha256 = createHash('sha256').update(buffer).digest('hex')
      prisma.fileObjectsById.set(fileId, { id: fileId, sha256 })
      return { fileId, originalname, mimeType, size: buffer.length, sha256 }
    },
    systemDelete: async (fileId: string) => {
      prisma.fileObjectsById.delete(fileId)
    },
  }
  const capabilities = {
    assertCanStartSession: async () => undefined,
    assertUserTaskAllowed: async () => undefined,
  }
  const service = new ScanTasksService(prisma as never, filesService as never, capabilities as never)
  return { prisma, service }
}

export async function runScanLeaseContractTests(): Promise<void> {
  // 1. Controller 安全守卫断言：create 必须挂载 TerminalIdentityGuard
  const { ScanTasksController } = await import('../src/scan-tasks/scan-tasks.controller')
  const { TerminalIdentityGuard } = await import('../src/terminals/terminal-identity.guard')
  const guards = Reflect.getMetadata('__guards__', ScanTasksController.prototype.create) || []
  assert.ok(
    Array.isArray(guards) && guards.includes(TerminalIdentityGuard),
    'ScanTasksController.create must be guarded with TerminalIdentityGuard',
  )

  // 2. 租约端点签发与参数校验
  {
    const { service, prisma } = makeContractHarness()
    const task = await service.create({ scanType: 'document', terminalId: 't_1' }, null)

    const lease = await service.getScanDeliveryLease('t_1')
    assert.equal(lease.scanTaskId, task.scanTaskId)
    assert.ok(lease.deliveryLease.includes('.'), 'lease must be signed token')
    assert.ok(new Date(lease.serverNow).getTime() > 0)
    assert.ok(new Date(lease.notBefore).getTime() > 0)
    assert.ok(new Date(lease.expiresAt).getTime() > Date.now())

    // 无 waiting 任务时请求租约抛 409 NO_WAITING_SCAN_TASK
    await assert.rejects(
      async () => service.getScanDeliveryLease('t_unknown'),
      (err: unknown) => (err as ConflictException).getResponse?.()['error']?.code === 'NO_WAITING_SCAN_TASK',
    )
  }

  // 3. deliver 必须携带 scanTaskId 与 deliveryLease，缺失抛 400
  {
    const { service } = makeContractHarness()
    const task = await service.create({ scanType: 'document', terminalId: 't_1' }, null)
    const lease = await service.getScanDeliveryLease('t_1')

    await assert.rejects(
      async () =>
        service.deliverScanFile({
          terminalId: 't_1',
          scanTaskId: '',
          deliveryLease: lease.deliveryLease,
          buffer: Buffer.from('%PDF-1.4 test'),
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      (err: unknown) => (err as BadRequestException).getResponse?.()['error']?.code === 'SCAN_TASK_ID_MISSING',
    )

    await assert.rejects(
      async () =>
        service.deliverScanFile({
          terminalId: 't_1',
          scanTaskId: task.scanTaskId,
          deliveryLease: '',
          buffer: Buffer.from('%PDF-1.4 test'),
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      (err: unknown) => (err as BadRequestException).getResponse?.()['error']?.code === 'SCAN_LEASE_MISSING',
    )
  }

  // 4. 篡改签名、伪造任务ID、伪造终端ID、过期租约均被拦截
  {
    const { service } = makeContractHarness()
    const task = await service.create({ scanType: 'document', terminalId: 't_1' }, null)
    const lease = await service.getScanDeliveryLease('t_1')

    // 篡改签名
    await assert.rejects(
      async () =>
        service.deliverScanFile({
          terminalId: 't_1',
          scanTaskId: task.scanTaskId,
          deliveryLease: `${lease.deliveryLease}tampered`,
          buffer: Buffer.from('%PDF-1.4 test'),
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      (err: unknown) => (err as ConflictException).getResponse?.()['error']?.code === 'SCAN_LEASE_INVALID',
    )

    // 终端ID不匹配
    await assert.rejects(
      async () =>
        service.deliverScanFile({
          terminalId: 't_wrong',
          scanTaskId: task.scanTaskId,
          deliveryLease: lease.deliveryLease,
          buffer: Buffer.from('%PDF-1.4 test'),
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      (err: unknown) => (err as ConflictException).getResponse?.()['error']?.code === 'SCAN_LEASE_INVALID',
    )

    // 任务ID不匹配
    await assert.rejects(
      async () =>
        service.deliverScanFile({
          terminalId: 't_1',
          scanTaskId: 'task_other',
          deliveryLease: lease.deliveryLease,
          buffer: Buffer.from('%PDF-1.4 test'),
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      (err: unknown) => (err as ConflictException).getResponse?.()['error']?.code === 'SCAN_LEASE_INVALID',
    )

    // 过期租约
    const expiredPayload: ScanDeliveryLeasePayload = {
      terminalId: 't_1',
      scanTaskId: task.scanTaskId,
      taskCreatedAtEpoch: Date.now() - 100_000,
      leaseEpoch: Date.now() - 100_000,
      notBeforeEpoch: Date.now() - 100_000,
      expiresAtEpoch: Date.now() - 1_000,
      nonce: randomBytes(16).toString('hex'),
    }
    const expiredLease = signScanDeliveryLease(expiredPayload)
    await assert.rejects(
      async () =>
        service.deliverScanFile({
          terminalId: 't_1',
          scanTaskId: task.scanTaskId,
          deliveryLease: expiredLease,
          buffer: Buffer.from('%PDF-1.4 test'),
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      (err: unknown) => (err as ConflictException).getResponse?.()['error']?.code === 'SCAN_LEASE_EXPIRED',
    )
  }

  // 5. 彻底删除“按终端找 waiting 猜归属”：指定错误/取消的 taskId 绝不匹配当前 waiting 任务
  {
    const { service } = makeContractHarness()
    const taskA = await service.create({ scanType: 'document', terminalId: 't_1' }, null)
    const leaseA = await service.getScanDeliveryLease('t_1')
    await service.cancel(taskA.scanTaskId, null, taskA.controlToken)

    // 新任务 B 建立
    const taskB = await service.create({ scanType: 'document', terminalId: 't_1' }, null)

    // 用已取消任务 A 的 lease 尝试投递：即使终端当前有 waiting 任务 B，也绝不猜归属
    await assert.rejects(
      async () =>
        service.deliverScanFile({
          terminalId: 't_1',
          scanTaskId: taskA.scanTaskId,
          deliveryLease: leaseA.deliveryLease,
          buffer: Buffer.from('%PDF-1.4 test'),
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      (err: unknown) => (err as ConflictException).getResponse?.()['error']?.code === 'SCAN_TASK_STATE_CHANGED',
    )

    // 任务 B 保持 waiting 且无文件绑定
    const statusB = await service.getStatus(taskB.scanTaskId, null, taskB.controlToken)
    assert.equal(statusB.status, 'waiting')
    assert.equal(statusB.file, null)
  }

  // 6. 陈旧捕获观察时间拦截与合法观察时间正常完成建档
  {
    const { service, prisma } = makeContractHarness()
    const task = await service.create({ scanType: 'document', terminalId: 't_1' }, null)
    const lease = await service.getScanDeliveryLease('t_1')
    const taskRecord = prisma.scanTasksById.get(task.scanTaskId)!

    // 观察时间早于任务创建边界（> 5s 容差）
    const staleObservedAt = new Date(taskRecord.createdAt.getTime() - SCAN_STALE_CAPTURE_TOLERANCE_MS - 5_000).toISOString()
    await assert.rejects(
      async () =>
        service.deliverScanFile({
          terminalId: 't_1',
          scanTaskId: task.scanTaskId,
          deliveryLease: lease.deliveryLease,
          buffer: Buffer.from('%PDF-1.4 stale'),
          filename: 'stale.pdf',
          mimeType: 'application/pdf',
          candidateSnapshotAt: staleObservedAt,
        }),
      (err: unknown) => (err as ConflictException).getResponse?.()['error']?.code === 'SCAN_FILE_STALE_CAPTURE',
    )

    // 正常观察时间成功投递
    const freshObservedAt = new Date(taskRecord.createdAt.getTime() + 1_000).toISOString()
    const delivered = await service.deliverScanFile({
      terminalId: 't_1',
      scanTaskId: task.scanTaskId,
      deliveryLease: lease.deliveryLease,
      buffer: Buffer.from('%PDF-1.4 fresh valid'),
      filename: 'fresh.pdf',
      mimeType: 'application/pdf',
      candidateSnapshotAt: freshObservedAt,
    })
    assert.equal(delivered.scanTaskId, task.scanTaskId)
    const taskAfter = prisma.scanTasksById.get(task.scanTaskId)!
    assert.equal(taskAfter.status, 'completed')
    assert.ok(taskAfter.fileId)
  }

  // 7. 重复投递与重放边界：内容级查重 (SCAN_FILE_ALREADY_DELIVERED) 与已完成任务重放拦截 (SCAN_TASK_STATE_CHANGED)
  {
    const { service, prisma } = makeContractHarness()
    const task1 = await service.create({ scanType: 'document', terminalId: 't_1' }, null)
    const lease1 = await service.getScanDeliveryLease('t_1')
    const sharedBuffer = Buffer.from('%PDF-1.4 duplicate test content')

    // 第一次投递成功
    const delivered1 = await service.deliverScanFile({
      terminalId: 't_1',
      scanTaskId: task1.scanTaskId,
      deliveryLease: lease1.deliveryLease,
      buffer: sharedBuffer,
      filename: 'doc1.pdf',
      mimeType: 'application/pdf',
      observedAt: new Date().toISOString(),
    })
    assert.equal(delivered1.scanTaskId, task1.scanTaskId)

    // (a) 重放相同文件字节到新任务：即使新任务拥有合法租约，由于内容查重护栏，绝不能跨会话重复投递
    const task2 = await service.create({ scanType: 'document', terminalId: 't_1' }, null)
    const lease2 = await service.getScanDeliveryLease('t_1')
    await assert.rejects(
      async () =>
        service.deliverScanFile({
          terminalId: 't_1',
          scanTaskId: task2.scanTaskId,
          deliveryLease: lease2.deliveryLease,
          buffer: sharedBuffer,
          filename: 'doc2.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      (err: unknown) => (err as ConflictException).getResponse?.()['error']?.code === 'SCAN_FILE_ALREADY_DELIVERED',
      'exact content hash duplicate within dedup window must be rejected',
    )

    // (b) 重放旧任务已用过的租约 lease1：由于 task1 状态已变为 completed，严格拒绝重放
    await assert.rejects(
      async () =>
        service.deliverScanFile({
          terminalId: 't_1',
          scanTaskId: task1.scanTaskId,
          deliveryLease: lease1.deliveryLease,
          buffer: Buffer.from('%PDF-1.4 completely different content'),
          filename: 'doc3.pdf',
          mimeType: 'application/pdf',
          observedAt: new Date().toISOString(),
        }),
      (err: unknown) => (err as ConflictException).getResponse?.()['error']?.code === 'SCAN_TASK_STATE_CHANGED',
      'replaying signed lease against non-waiting task must fail with SCAN_TASK_STATE_CHANGED',
    )
  }

  console.log('PASS scan lease contract helper checks')
}
