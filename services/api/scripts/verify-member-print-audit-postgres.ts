/**
 * 会员取件链接与重试的审计，必须在真 PostgreSQL 上落库。
 *
 * 为什么单独成文件：verify-miniapp-cloud-print-m2 把库钉在一次性 SQLite 上。
 * AuditLog.actorId 的外键指向运营 User，SQLite 默认不拒绝「把会员号写进 actorId」。
 * 那条写入在 PostgreSQL 上违反外键，又被 AuditService.write 静默吞掉，会员动作就没有审计。
 * 本文件只连隔离的 PostgreSQL，走真实 PrintJobsService 各做一次取件链接和重试。
 *
 * 阳性对照用旧写法直接插一行（actorId = 会员号）。不经过 AuditService.write
 * （那个方法会把数据库错误吞掉）。PostgreSQL 必须抛外键错误；插得进去就说明
 * 这套库没有守住这条外键，门禁测不出问题。
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? process.env['POSTGRES_URL'] ?? ''
  if (!url.startsWith('postgresql://') && !url.startsWith('postgres://')) {
    throw new Error('MEMBER_PRINT_AUDIT_VERIFY_POSTGRES_REQUIRED: DATABASE_URL must be PostgreSQL')
  }
  process.env['DATABASE_URL'] = url
  assertIsolatedVerificationDatabase()
  process.env['FILE_SIGNING_SECRET'] ??= 'verify-member-print-audit-secret-0123456789ab'
  process.env['FILE_STORAGE_DRIVER'] ??= 'local'

  const [
    { PrismaService },
    { AuditService },
    { PrintJobsService },
    { PrintPageCountService },
    { PricingService },
    { OrderStatusService },
    { TerminalCapabilitiesService },
    { StorageService },
  ] = await Promise.all([
    import('../src/prisma/prisma.service'),
    import('../src/audit/audit.service'),
    import('../src/print-jobs/print-jobs.service'),
    import('../src/print-jobs/print-page-count.service'),
    import('../src/payment/pricing.service'),
    import('../src/payment/order-status.service'),
    import('../src/terminals/terminal-capabilities.service'),
    import('../src/storage/storage.service'),
  ])

  const prisma = new PrismaService()
  if (prisma.dbKind !== 'postgres') {
    throw new Error('MEMBER_PRINT_AUDIT_VERIFY_POSTGRES_REQUIRED')
  }
  await prisma.onModuleInit()

  const runId = randomBytes(4).toString('hex')
  const memberId = `eu_auditpg_${runId}`
  const terminalId = `term_auditpg_${runId}`
  const fileId = `file_auditpg_${runId}`
  const taskId = `ptask_auditpg_${runId}`
  const orderId = `ord_auditpg_${runId}`
  const orderNo = `ORD-AUDITPG-${runId}`
  let passed = 0

  try {
    await prisma.endUser.create({
      data: { id: memberId, phoneHash: `hash-${memberId}`, phoneEnc: `enc-${memberId}` },
    })
    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `APG-${runId}`,
        agentToken: `token-${terminalId}`,
        deviceFingerprint: `fp-${terminalId}`,
        displayName: '会员审计验证终端',
        enabled: true,
        lifecycleStatus: 'active',
      },
    })
    // 重提打印要求终端心跳 agentVersion ≥ 0.4.13（#1152 的版本门槛）；不带版本号会被 409 挡下。
    await prisma.terminalHeartbeat.create({
      data: { terminalId, status: 'online', localTaskDatabaseAvailable: true, agentVersion: '0.4.13', createdAt: new Date() },
    })
    await prisma.fileObject.create({
      data: {
        id: fileId,
        storageKey: `verify/member-print-audit/${fileId}.pdf`,
        filename: 'resume.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 128,
        sha256: 'ab'.repeat(32),
        endUserId: memberId,
        purpose: 'print_doc',
        status: 'active',
        deletedAt: null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
    await prisma.printTask.create({
      data: {
        id: taskId,
        terminalId,
        endUserId: memberId,
        fileId,
        fileUrl: 'https://verify.invalid/member-print-audit',
        fileMd5: 'sha256-auditpg',
        status: 'failed',
        errorCode: 'PRINTER_OFFLINE',
      },
    })
    await prisma.order.create({
      data: {
        id: orderId,
        orderNo,
        type: 'print',
        channel: 'miniapp_cloud',
        printTaskId: taskId,
        endUserId: memberId,
        terminalId,
        sourceFileId: fileId,
        amountCents: 80,
        payStatus: 'paid',
        paymentSource: 'offline',
        paidAt: new Date(),
        taskStatus: 'failed',
      },
    })

    const audit = new AuditService(prisma)
    const storage = new StorageService()
    const printJobs = new PrintJobsService(
      prisma,
      audit,
      new PrintPageCountService(prisma, storage),
      new PricingService(prisma),
      new OrderStatusService(prisma, audit),
      new TerminalCapabilitiesService(prisma),
    )

    const takeaway = await printJobs.issueTakeawayUrl(taskId, { endUserId: memberId })
    assert.equal(takeaway.orderId, orderId)
    assert.ok(takeaway.signedUrl.includes('/files/'), '取件链接必须签出本系统文件地址')
    passed += 1
    await assertMemberAudit(prisma, 'print_job.takeaway_url', taskId, memberId)
    passed += 1

    const retried = await printJobs.retryPaidFailedJob(taskId, { endUserId: memberId })
    assert.equal(retried.taskId, taskId)
    assert.equal(retried.orderId, orderId)
    assert.equal(retried.status, 'pending')
    assert.equal(retried.amountCents, 80)
    passed += 1
    await assertMemberAudit(prisma, 'print_job.retry', taskId, memberId)
    passed += 1

    await assertMemberActorIdForeignKeyRejected(prisma, memberId, taskId, orderId, orderNo, fileId)
    passed += 1

    console.log(`verify-member-print-audit-postgres: ${passed}/5 PASS`)
  } finally {
    await prisma.auditLog.deleteMany({ where: { targetId: taskId } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId } })
    await prisma.order.deleteMany({ where: { id: orderId } })
    await prisma.printTask.deleteMany({ where: { id: taskId } })
    await prisma.fileObject.deleteMany({ where: { id: fileId } })
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.endUser.deleteMany({ where: { id: memberId } })
    await prisma.onModuleDestroy()
  }
}

async function assertMemberAudit(
  prisma: {
    auditLog: {
      findMany: (args: {
        where: { action: string; targetId: string }
        orderBy: { createdAt: 'desc' }
      }) => Promise<Array<{ actorId: string | null; payloadJson: string }>>
    }
  },
  action: 'print_job.takeaway_url' | 'print_job.retry',
  taskId: string,
  memberId: string,
): Promise<void> {
  const rows = await prisma.auditLog.findMany({
    where: { action, targetId: taskId },
    orderBy: { createdAt: 'desc' },
  })
  assert.equal(rows.length, 1, `${action} 必须正好落一行审计，实际 ${rows.length} 行`)
  const row = rows[0]!
  assert.equal(row.actorId, null, `${action} 的 actorId 必须为 null（外键指向运营账号）`)
  const payload = JSON.parse(row.payloadJson) as { endUserId?: unknown }
  assert.equal(payload.endUserId, memberId, `${action} 的 payload.endUserId 必须等于会员号`)
}

/**
 * 旧写法：actorId 直接写会员号。AuditService.write 会吞掉这次失败，
 * 所以这里直接插，确认 PostgreSQL 自己拒绝。
 */
async function assertMemberActorIdForeignKeyRejected(
  prisma: {
    auditLog: {
      create: (args: {
        data: {
          actorId: string
          actorRole: string
          action: string
          targetType: string
          targetId: string
          payloadJson: string
        }
      }) => Promise<unknown>
    }
  },
  memberId: string,
  taskId: string,
  orderId: string,
  orderNo: string,
  fileId: string,
): Promise<void> {
  let rejected = false
  try {
    await prisma.auditLog.create({
      data: {
        actorId: memberId,
        actorRole: 'kiosk',
        action: 'print_job.takeaway_url',
        targetType: 'print_task',
        targetId: taskId,
        payloadJson: JSON.stringify({ orderId, orderNo, fileId }),
      },
    })
  } catch (error) {
    assert.equal(
      isForeignKeyViolation(error),
      true,
      `actorId 写会员号必须违反外键，实际 ${describeDbError(error)}`,
    )
    rejected = true
  }
  assert.equal(rejected, true, 'actorId 写会员号在 PostgreSQL 上必须抛外键错误；插进去了说明这套库没在守这条外键')
}

function isForeignKeyViolation(error: unknown): boolean {
  const seen = new Set<unknown>()
  const queue: unknown[] = [error]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    const value = current as {
      code?: unknown
      message?: unknown
      cause?: unknown
      meta?: unknown
    }
    if (value.code === 'P2003' || value.code === '23503') return true
    if (typeof value.message === 'string' && /foreign key constraint|violates foreign key/i.test(value.message)) {
      return true
    }
    if (value.cause) queue.push(value.cause)
    if (value.meta && typeof value.meta === 'object') queue.push(value.meta)
  }
  return false
}

function describeDbError(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error)
  const value = error as {
    name?: unknown
    code?: unknown
    cause?: { code?: unknown; originalCode?: unknown; kind?: unknown }
  }
  return JSON.stringify({
    name: value.name,
    code: value.code,
    causeCode: value.cause?.code ?? value.cause?.originalCode,
    causeKind: value.cause?.kind,
  })
}

main().catch((error: unknown) => {
  console.error('\nFAIL', error instanceof Error ? error.stack : error)
  process.exit(1)
})
