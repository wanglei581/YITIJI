/**
 * 打印链路 service 级轻量 E2E 验证（P1-B 守门）。
 *
 * 覆盖上线核心打印链路（创建 → claim → 状态回传 → 查询）的关键不变量：
 *   1. 合法签名 fileUrl + 目标终端 → 创建 PrintTask(pending)。
 *   2. 非法 fileUrl（外部地址 / 无签名 / 篡改 sig）→ 400 PRINT_INVALID_FILE_URL（SSRF 防护）。
 *   3. 终端 claim：只领取已绑定本终端的 pending 任务；错 agentToken → 401。
 *   4. 状态回传：claimed → printing → completed（含 completedAt）。
 *   5. 终态幂等：只允许重复回传相同终态；不同终态或回退到 printing 必须拒绝且不重写 DB。
 *   6. 状态查询：getStatus 反映终态；不存在任务 → 404 PRINT_TASK_NOT_FOUND。
 *   9. 动态价格二次确认：quotedAmountCents 与服务端重算不一致 → 409 PRICE_CHANGED 且零建单副作用。
 *   1d. 有效 HMAC 仍拒绝 uploading（含 resume_export_pending）/ quarantined / deleted / expired，active 对照可建单。
 *
 * 1–8 与 9 的 service 段直调真库（prisma），不起 HTTP server——确定性、CI 友好。
 * 9 的 HTTP 段另起进程内 Nest：真实 PrintJobsController + main.ts 同款 ValidationPipe
 * + 真实 HttpExceptionFilter，只替换终端会话 / Redis / JWT 等与计价无关的依赖。
 * 运行：pnpm --filter ./services/api verify:print-jobs
 */
import 'dotenv/config'
import { createHash, createHmac, randomBytes } from 'crypto'
import { BadRequestException, Module, UnauthorizedException, ValidationPipe, type ValidationError } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'

// terminals.service 在模块加载期 requireEnv 这两项；signing 在调用期读 FILE_SIGNING_SECRET。
// 测试兜底（||= 不覆盖外部已设值；CI 已注入这些测试值）。须在动态 import terminals.service 之前设好。
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-print-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-print-terminal-action-secret-0123456789'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-print-file-signing-secret-0123456789abcd'

import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { TerminalToolboxService } from '../src/terminals/terminal-toolbox.service'
import { TerminalAgentService } from '../src/terminals/terminals-agent.service'
import { TerminalAdminService } from '../src/terminals/terminals-admin.service'
import { AuditService } from '../src/audit/audit.service'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { FilesService } from '../src/files/files.service'
import { FilesController } from '../src/files/files.controller'
import { signFileUrl, verifyFileSignature } from '../src/files/signing'
import { createPaymentSessionToken } from '../src/payment/payment-session-token'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PricingService } from '../src/payment/pricing.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { StorageService } from '../src/storage/storage.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import type { CreatePrintJobDto } from '../src/print-jobs/dto/create-print-job.dto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { buildRealPdf } from './support/minimal-pdf'

// 静态门禁按源码顺序要求本调用先于任何 Prisma 客户端构造，含下方 claim 屏障的辅助连接。
assertIsolatedVerificationDatabase()

function pass(m: string) { console.log(`  PASS ${m}`) }

/** 夹具按 fileId.expires 的 HMAC-SHA256 协议自签，不调用生产签发函数。 */
function fixtureFileSignature(fileId: string, expiresAtMs: number): string {
  const secret = process.env['FILE_SIGNING_SECRET']
  if (!secret) fail('测试签名密钥未设置')
  return createHmac('sha256', secret).update(`${fileId}.${expiresAtMs}`).digest('hex')
}
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

function thrownCode(e: unknown): string | undefined {
  return errCode(e) ?? (/^[A-Z][A-Z0-9_]+$/.test((e as Error).message) ? (e as Error).message : undefined)
}

function parseSignedContentUrl(fileUrl: string): { fileId: string; expires: string; sig: string } {
  const parsed = new URL(fileUrl, 'http://print-verify.local')
  const matched = /^\/api\/v1\/files\/([^/]+)\/content$/.exec(parsed.pathname)
  const expires = parsed.searchParams.get('expires')
  const sig = parsed.searchParams.get('sig')
  if (!matched?.[1] || !expires || !sig) fail(`claim fileUrl 不是 /files/:id/content 签名路径: ${fileUrl.split('?')[0]}`)
  return { fileId: matched[1], expires, sig }
}

/**
 * 在 claim 事务读完目标 FileObject 之后、PrintTask CAS 之前，用另一条连接提交软删除。
 * 这是测试侧事务屏障，不是 sleep，也不是同事务触发器。
 */
async function claimWhileSoftDeleteCommits(
  prisma: PrismaService,
  targetFileId: string,
  claim: () => Promise<void>,
): Promise<void> {
  const deleter = new PrismaService()
  await deleter.onModuleInit()
  const original = prisma.$transaction.bind(prisma)
  let committed = false
  prisma.$transaction = ((arg: unknown, ...rest: unknown[]) => {
    if (typeof arg !== 'function') return original(arg as never, ...(rest as []))
    return original(async (tx: { fileObject: { findUnique: (args: { where?: { id?: string } }) => Promise<unknown> } }) => {
      const findUnique = tx.fileObject.findUnique.bind(tx.fileObject)
      tx.fileObject.findUnique = async (args) => {
        const seen = await findUnique(args)
        if (!committed && args?.where?.id === targetFileId) {
          await deleter.fileObject.update({
            where: { id: targetFileId },
            data: { status: 'deleted', deletedAt: new Date() },
          })
          committed = true
        }
        return seen
      }
      return arg(tx)
    }, ...(rest as []))
  }) as typeof prisma.$transaction
  try {
    await claim()
    if (!committed) fail('claim 未在事务内读取目标文件，软删除屏障没有发生')
  } finally {
    prisma.$transaction = original
    await deleter.onModuleDestroy()
  }
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望抛 ${code}，但未抛`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际: ${c ?? (e as Error).message}`)
  }
}

/** 与 main.ts 的 flattenValidationErrors 同口径（main.ts 有启动副作用，不能直接 import）。 */
function flattenValidation(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const error of errors) {
    const label = parent ? `${parent}.${error.property}` : error.property
    if (error.constraints) out.push(...Object.values(error.constraints).map((m) => `${label}: ${m}`))
    if (error.children?.length) out.push(...flattenValidation(error.children, label))
  }
  return out
}

interface HttpResult { status: number; json: { error?: { code?: string; details?: string[] }; [key: string]: unknown } }

/**
 * 进程内 Nest：真实 PrintJobsController / CreatePrintJobDto / ValidationPipe / HttpExceptionFilter。
 * 控制器依赖在 env 兜底之后再动态加载（同 terminals.service 的处理）。
 */
async function startPrintJobsHttp(printJobs: PrintJobsService, prisma: PrismaService, terminalId: string, sessionToken: string) {
  const { PrintJobsController } = await import('../src/print-jobs/print-jobs.controller')
  const { PickupOrderService } = await import('../src/print-jobs/pickup-order.service')
  const { TerminalSessionService } = await import('../src/terminals/terminal-session.service')
  const { RedisService } = await import('../src/common/redis/redis.service')
  const { HttpExceptionFilter } = await import('../src/common/filters/http-exception.filter')
  class PrintJobsHttpModule {}
  Module({
    controllers: [PrintJobsController],
    providers: [
      { provide: PrintJobsService, useValue: printJobs },
      { provide: PrismaService, useValue: prisma },
      { provide: JwtService, useValue: new JwtService({ secret: 'verify-print-jobs-http-jwt-unused-0123456789' }) },
      { provide: RedisService, useValue: {} },
      { provide: PickupOrderService, useValue: {} },
      {
        provide: TerminalSessionService,
        useValue: {
          validate: async (id?: string, token?: string) => {
            if (id !== terminalId || token !== sessionToken) throw new UnauthorizedException()
          },
        },
      },
    ],
  })(PrintJobsHttpModule)
  const app = await NestFactory.create(PrintJobsHttpModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => {
      const details = flattenValidation(errors)
      return new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: details[0] ?? '请求参数校验失败', details } })
    },
  }))
  app.useGlobalFilters(new HttpExceptionFilter())
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address()
  if (!address || typeof address === 'string') fail('9-http 无法取得监听地址')
  const post = async (body: unknown): Promise<HttpResult> => {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/v1/print/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-terminal-id': terminalId, 'x-terminal-session-token': sessionToken },
      body: JSON.stringify(body),
    })
    return { status: res.status, json: (await res.json().catch(() => ({}))) as HttpResult['json'] }
  }
  return { post, close: () => app.close() }
}

async function main() {
  // 动态 import：terminals.service 模块级 requireEnv 必须在上面 env 设好后再加载。
  // 隔离闸门已在模块顶层执行，早于本文件任何 Prisma 客户端。
  const { TerminalsService } = await import('../src/terminals/terminals.service')

  console.log('\n=== 打印链路 service 级 E2E 验证（P1-B 守门）===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const orderStatus = new OrderStatusService(prisma, audit)
  const pageCount = new PrintPageCountService(prisma, storage)
  let conversionCalls = 0
  const printJobs = new PrintJobsService(
    prisma,
    audit,
    pageCount,
    new PricingService(prisma),
    orderStatus,
    new TerminalCapabilitiesService(prisma),
    {
      convertForPrint: async () => {
        conversionCalls += 1
        throw new Error('CONVERSION_INVOKED')
      },
    } as never,
  )
  // N3 拆分后 TerminalsService 需要 agent + admin 两个子服务
  const agentSvc = new TerminalAgentService(prisma, audit)
  const terminals = new TerminalsService(agentSvc, new TerminalAdminService(prisma, agentSvc, new TerminalToolboxService(prisma)))

  const suffix = randomBytes(6).toString('hex')
  const terminalId = `term_vpj_${suffix}`
  const agentToken = `vpj-agent-token-${suffix}`
  const fileId = `file_vpj_${suffix}`
  const contractSourceFileId = `file_vpj_contract_${suffix}`
  const contractReportFileId = `file_vpj_report_${suffix}`
  const storageKey = `verify/print-jobs/${fileId}.pdf`
  const contractSourceStorageKey = `verify/print-jobs/${contractSourceFileId}.pdf`
  const contractReportStorageKey = `verify/print-jobs/${contractReportFileId}.pdf`
  const fixtureFileIds = [fileId, contractSourceFileId, contractReportFileId]
  const fixtureStorageKeys = [storageKey, contractSourceStorageKey, contractReportStorageKey]
  const createdTaskIds: string[] = []

  async function cleanup() {
    if (createdTaskIds.length) {
      const orders = await prisma.order.findMany({ where: { printTaskId: { in: createdTaskIds } }, select: { id: true } })
      await prisma.auditLog.deleteMany({ where: { targetType: 'order', targetId: { in: orders.map((o: { id: string }) => o.id) } } })
      await prisma.order.deleteMany({ where: { printTaskId: { in: createdTaskIds } } })
      await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: createdTaskIds } } })
      await prisma.auditLog.deleteMany({ where: { targetType: 'print_task', targetId: { in: createdTaskIds } } })
      await prisma.printTask.deleteMany({ where: { id: { in: createdTaskIds } } })
    }
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId } })
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    // 计费接线后新增的真实 fixture / 价目清理。
    await prisma.documentProcessTask.deleteMany({ where: { sourceFileId: { in: fixtureFileIds } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: fixtureFileIds } } })
    await prisma.fileObject.deleteMany({ where: { id: { in: fixtureFileIds } } })
    await Promise.all(fixtureStorageKeys.map((key) =>
      storage.deleteObject(key, LOCAL_BUCKET_SENTINEL).catch(() => undefined),
    ))
    await prisma.priceConfig.deleteMany({ where: { serviceKey: { in: ['print_bw_page', 'print_color_page'] } } })
  }

  try {
    await cleanup()

    await prisma.terminal.create({
      data: { id: terminalId, terminalCode: `VPJ-${suffix}`, agentToken, deviceFingerprint: `fp-${suffix}` },
    })
    pass('终端夹具已创建')

    // 计费接线后 create() 需真实 FileObject + 存储内容识别页数 + PriceConfig 报价（否则 fail-closed）。
    await seedDevDefaultPriceConfig(prisma)
    const pdfBytes = buildRealPdf(1)
    const reportSha256 = createHash('sha256').update(pdfBytes).digest('hex')
    await Promise.all(fixtureStorageKeys.map((key) =>
      storage.putObject(key, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL),
    ))
    await prisma.fileObject.createMany({
      data: [
        {
          id: fileId,
          storageKey,
          filename: 'vpj.pdf',
          mimeType: 'application/pdf',
          sizeBytes: pdfBytes.length,
          sha256: '',
          purpose: 'print_source',
          bucket: LOCAL_BUCKET_SENTINEL,
        },
        {
          id: contractSourceFileId,
          storageKey: contractSourceStorageKey,
          filename: '劳动合同.pdf',
          mimeType: 'application/pdf',
          sizeBytes: pdfBytes.length,
          sha256: reportSha256,
          purpose: 'contract_upload',
          sensitiveLevel: 'highly_sensitive',
          bucket: LOCAL_BUCKET_SENTINEL,
        },
        {
          id: contractReportFileId,
          storageKey: contractReportStorageKey,
          filename: 'AI签约风险提示报告.pdf',
          mimeType: 'application/pdf',
          sizeBytes: pdfBytes.length,
          sha256: reportSha256,
          purpose: 'contract_review_report',
          sensitiveLevel: 'highly_sensitive',
          assetCategory: 'derived',
          sourceFileId: contractSourceFileId,
          status: 'active',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          bucket: LOCAL_BUCKET_SENTINEL,
        },
      ],
    })

    await terminals.heartbeat(
      terminalId,
      {
        status: 'agent_degraded',
        printerStatus: 'ok',
        localTaskDatabaseAvailable: false,
        agentVersion: 'verify-agent',
      },
      `Bearer ${agentToken}`,
    )
    const adminTerminals = await terminals.listTerminalsForAdmin()
    const adminTerminal = adminTerminals.terminals.find((t) => t.id === terminalId)
    if (adminTerminal?.agentStatus === 'agent_degraded' && adminTerminal.localTaskDatabaseAvailable === false) {
      pass('0. Agent 降级心跳 → Admin 终端视图可见 agent_degraded / localTaskDatabaseAvailable=false')
    } else {
      fail(`0. Agent 降级心跳未进入 Admin 视图: ${JSON.stringify(adminTerminal)}`)
    }

    // ── 1. 合法签名 fileUrl → 创建 PrintTask(pending) ──────────────────
    const signed = signFileUrl(fileId, 30 * 60 * 1000)
    const dto1: CreatePrintJobDto = { fileUrl: signed.url, fileMd5: 'sha256-vpj', fileName: '测试简历.pdf' }
    const created = await printJobs.create(dto1, {
      ipAddress: '127.0.0.1',
      userAgent: 'verify',
      endUserId: null,
      terminalId,
    })
    createdTaskIds.push(created.taskId)
    if (created.status === 'pending' && created.taskId.startsWith('ptask_')) {
      pass('1. 合法签名 fileUrl + 目标终端 → 创建任务 pending')
    } else fail(`1. 创建异常: ${JSON.stringify(created)}`)

    const fileExpiry = new Date(Date.now() + 90 * 60 * 1000)
    await prisma.fileObject.update({
      where: { id: fileId },
      data: { expiresAt: fileExpiry, retentionPolicy: 'system_short' },
    })
    const statusWithFile = await printJobs.getStatus(created.taskId)
    if (
      statusWithFile.fileRetentionAvailable === true
      && statusWithFile.fileExpiresAt === fileExpiry.toISOString()
      && statusWithFile.fileRetentionPolicy === 'system_short'
    ) {
      pass('1-retention. getStatus 回传 FileObject.expiresAt / retentionPolicy，不编造时长')
    } else {
      fail(`1-retention. 文件保留字段异常: ${JSON.stringify({
        fileRetentionAvailable: statusWithFile.fileRetentionAvailable,
        fileExpiresAt: statusWithFile.fileExpiresAt,
        fileRetentionPolicy: statusWithFile.fileRetentionPolicy,
        expected: fileExpiry.toISOString(),
      })}`)
    }
    await prisma.printTask.update({ where: { id: created.taskId }, data: { fileId: null } })
    const statusWithoutFile = await printJobs.getStatus(created.taskId)
    if (statusWithoutFile.fileRetentionAvailable === false) {
      pass('1-retention-missing. 无 fileId 时 fileRetentionAvailable=false，前台必须走「以后台策略为准」')
    } else {
      fail(`1-retention-missing. 期望 fileRetentionAvailable=false，实际 ${JSON.stringify(statusWithoutFile.fileRetentionAvailable)}`)
    }
    await prisma.printTask.update({ where: { id: created.taskId }, data: { fileId } })

    // M1 渠道标注：一体机建单必须落 channel='kiosk'。
    // 不显式标注则会员单无法与小程序云单区分（两端写的 terminalId/endUserId 相同），
    // 渠道对比与转化统计全部失真。见 docs/product/miniapp-console-sharing-2026-08.md §六 T-M1。
    {
      const kioskOrder = await prisma.order.findFirst({
        where: { printTaskId: created.taskId },
        select: { channel: true },
      })
      if (kioskOrder?.channel === 'kiosk') {
        pass("1a. 一体机建单落 channel='kiosk'")
      } else {
        fail(`1a. 一体机建单 channel 应为 'kiosk'，实际: ${JSON.stringify(kioskOrder?.channel)}`)
      }
    }

    await expectCode(
      () => printJobs.create({ fileUrl: signFileUrl(contractSourceFileId, 30 * 60 * 1000).url }, { terminalId }),
      'PRINT_CONTRACT_SOURCE_FORBIDDEN',
      '1a. 合同审查原件签名 URL → 拒绝直接创建打印任务',
    )

    await expectCode(
      () => printJobs.create({
        fileUrl: signFileUrl(contractReportFileId, 30 * 60 * 1000).url,
        fileMd5: 'client-supplied-hash-must-not-win',
        fileName: 'AI签约风险提示报告.pdf',
      }, { terminalId }),
      'PRINT_CONTRACT_REPORT_FORBIDDEN',
      '1b. 合同风险提示报告建打印单 → 400 PRINT_CONTRACT_REPORT_FORBIDDEN',
    )

    await prisma.fileObject.update({ where: { id: contractReportFileId }, data: { sha256: 'invalid-server-hash' } })
    await expectCode(
      () => printJobs.create({
        fileUrl: signFileUrl(contractReportFileId, 30 * 60 * 1000).url,
        fileMd5: reportSha256,
      }, { terminalId }),
      'PRINT_CONTRACT_REPORT_FORBIDDEN',
      '1c. 合同风险提示报告即使哈希无效也一律禁止打印',
    )
    await prisma.fileObject.update({ where: { id: contractReportFileId }, data: { sha256: reportSha256 } })

    // ── 1d. 有效 HMAC 不能读取未激活 / 已删 / 已过期文件 ──────────────
    {
      const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      const future = new Date(Date.now() + 3_600_000)
      const past = new Date(Date.now() - 60_000)
      const cases: Array<[string, string, string, Date | null, Date | null, string | null, string]> = [
        ['uploading_pdf', 'uploading', 'application/pdf', null, future, 'resume_export_pending', 'resume_upload'],
        ['uploading_docx', 'uploading', docx, null, future, 'resume_export_pending', 'resume_upload'],
        ['quarantined', 'quarantined', 'application/pdf', null, future, null, 'print_source'],
        ['deleted_docx', 'active', docx, new Date(), future, null, 'print_source'],
        ['expired', 'active', 'application/pdf', null, past, null, 'print_source'],
      ]
      const readObject = storage.getObject.bind(storage)
      let storageReads = 0
      storage.getObject = async (objectKey: string, bucket?: string | null) => {
        storageReads += 1
        return readObject(objectKey, bucket)
      }
      const expectUnavailable = async (id: string, step: 'page-count' | 'create', url: string) => {
        try {
          if (step === 'page-count') await pageCount.resolveBillablePages(url)
          else await printJobs.create({ fileUrl: url, fileName: `${id}.bin` }, { terminalId })
          fail(`1d. ${id} ${step} 应拒绝`)
        } catch (error) {
          const code = thrownCode(error)
          if (code !== 'PRINT_PAGE_COUNT_UNAVAILABLE') fail(`1d. ${id} ${step} 实际 ${code ?? (error as Error).message}`)
        }
      }
      try {
        for (const [key, status, mimeType, deletedAt, expiresAt, retentionLockedReason, purpose] of cases) {
          const id = `file_vpj_${key}_${suffix}`
          const storageKey = `verify/print-jobs/${id}.bin`
          fixtureFileIds.push(id)
          fixtureStorageKeys.push(storageKey)
          await storage.putObject(storageKey, pdfBytes, mimeType, LOCAL_BUCKET_SENTINEL)
          await prisma.fileObject.create({ data: {
            id, storageKey, filename: `${key}.bin`, mimeType, sizeBytes: pdfBytes.length, sha256: reportSha256,
            purpose, status, deletedAt, expiresAt, retentionLockedReason, bucket: LOCAL_BUCKET_SENTINEL,
          } })
          await prisma.auditLog.create({ data: {
            actorRole: 'system', action: 'file.direct_upload_completed', targetType: 'file', targetId: id, payloadJson: '{}',
          } })
          const readsBefore = storageReads
          const conversionsBefore = conversionCalls
          const signedUrl = signFileUrl(id, 30 * 60 * 1000).url
          await expectUnavailable(id, 'page-count', signedUrl)
          await expectUnavailable(id, 'create', signedUrl)
          const [tasks, orders, attempts, audits, createAudits, stored] = await Promise.all([
            prisma.printTask.count({ where: { fileId: id } }),
            prisma.order.count({ where: { printTask: { fileId: id } } }),
            prisma.paymentAttempt.count({ where: { order: { printTask: { fileId: id } } } }),
            prisma.auditLog.count({ where: { targetId: id, action: { not: 'file.direct_upload_completed' } } }),
            prisma.auditLog.count({ where: { action: 'print_job.create', payloadJson: { contains: id } } }),
            prisma.fileObject.findUnique({ where: { id }, select: { status: true, deletedAt: true, retentionLockedReason: true } }),
          ])
          const clean = storageReads === readsBefore && conversionCalls === conversionsBefore
            && tasks === 0 && orders === 0 && attempts === 0 && audits === 0 && createAudits === 0
            && stored?.status === status && Boolean(stored.deletedAt) === Boolean(deletedAt)
            && stored.retentionLockedReason === retentionLockedReason
          if (!clean) {
            fail(`1d. ${key} 拒绝后仍有副作用 ${JSON.stringify({ storageReads, readsBefore, conversionCalls, conversionsBefore, tasks, orders, attempts, audits, createAudits, stored })}`)
          }
          pass(`1d. ${key} 有效 HMAC 拒绝，且无存储读取、转换、PrintTask、Order、PaymentAttempt`)
        }
        const activeId = `file_vpj_active_${suffix}`
        const activeKey = `verify/print-jobs/${activeId}.pdf`
        fixtureFileIds.push(activeId)
        fixtureStorageKeys.push(activeKey)
        await storage.putObject(activeKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
        await prisma.fileObject.create({ data: {
          id: activeId, storageKey: activeKey, filename: 'active.pdf', mimeType: 'application/pdf',
          sizeBytes: pdfBytes.length, sha256: reportSha256, purpose: 'print_source', status: 'active',
          deletedAt: null, expiresAt: future, bucket: LOCAL_BUCKET_SENTINEL,
        } })
        const readsBeforeActive = storageReads
        const activeUrl = signFileUrl(activeId, 30 * 60 * 1000).url
        const counted = await pageCount.resolveBillablePages(activeUrl)
        const activeJob = await printJobs.create({ fileUrl: activeUrl, fileName: 'active.pdf' }, { terminalId })
        createdTaskIds.push(activeJob.taskId)
        if (counted.billablePages !== 1 || activeJob.status !== 'pending' || storageReads <= readsBeforeActive || conversionCalls !== 0) {
          fail(`1d-active. 有效文件应识别页数并建单 pages=${counted.billablePages} status=${activeJob.status} reads=${storageReads}`)
        }
        pass('1d-active. active 且未过期文件仍识别页数并创建任务')
      } finally {
        storage.getObject = readObject
      }
    }

    // ── 2. 非法 fileUrl 拦截（SSRF 防护）──────────────────────────────
    await expectCode(
      () => printJobs.create({ fileUrl: 'https://evil.example.com/secret' }, {}),
      'PRINT_INVALID_FILE_URL',
      '2a. 外部 URL → 400 PRINT_INVALID_FILE_URL',
    )
    await expectCode(
      () => printJobs.create({ fileUrl: `/api/v1/files/${fileId}/content` }, {}),
      'PRINT_INVALID_FILE_URL',
      '2b. 缺签名参数 → 400 PRINT_INVALID_FILE_URL',
    )
    const tamperedUrl = signed.url.replace(/sig=([0-9a-fA-F]+)/, (_m, s: string) => `sig=${s.split('').reverse().join('')}`)
    await expectCode(
      () => printJobs.create({ fileUrl: tamperedUrl }, {}),
      'PRINT_INVALID_FILE_URL',
      '2c. 篡改 sig → 400 PRINT_INVALID_FILE_URL',
    )

    // backdate：claim 取全局最旧 pending；把测试任务回拨到很早，保证 claim 确定命中本任务。
    await prisma.printTask.update({ where: { id: created.taskId }, data: { createdAt: new Date('2020-01-01T00:00:00.000Z') } })

    // ── 3. 终端 claim ────────────────────────────────────────────────
    await expectCode(
      () => terminals.claimTasks(terminalId, { maxTasks: 1 }, 'Bearer wrong-token'),
      'AUTH_TOKEN_INVALID',
      '3a. claim 用错 agentToken → 401 AUTH_TOKEN_INVALID',
    )
    const degradedClaim = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
    const afterDegradedClaim = await prisma.printTask.findUnique({ where: { id: created.taskId } })
    if (degradedClaim.length === 0 && afterDegradedClaim?.status === 'pending') {
      pass('3b. Agent 降级时后端 claim 二道闸门 → 不下发任务且任务保持 pending')
    } else {
      fail(`3b. 降级 claim 闸门异常: claimed=${JSON.stringify(degradedClaim)} status=${afterDegradedClaim?.status}`)
    }

    await terminals.heartbeat(
      terminalId,
      {
        status: 'online',
        printerStatus: 'ok',
        localTaskDatabaseAvailable: true,
        agentVersion: 'verify-agent',
      },
      `Bearer ${agentToken}`,
    )
    // 出纸前置：claim 只领已付款订单（付费门控已写死，不再是可关闭的 env 开关）。
    // 这里按线下收款口径把该单标为 paid，再验证 Agent 能领取——原先夹具留在 unpaid
    // 也能领，那正是 P0-1 的资损路径。
    const beforePayClaim = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
    if (beforePayClaim.length === 0) {
      pass('3c-pre. 未支付时本终端 pending 任务不可领取（先付后印）')
    } else fail(`3c-pre. 未支付任务被领取: ${JSON.stringify(beforePayClaim.map((c) => c.taskId))}`)

    await orderStatus.markPaid(created.orderId, { paymentSource: 'offline' })
    const claimed = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
    if (claimed.length === 1 && claimed[0].taskId === created.taskId && claimed[0].claimedBy === terminalId && !!claimed[0].fileUrl) {
      pass('3c. 线下收款入账后终端 claim：本终端 pending 任务被领取（返回 fileUrl + actionToken）')
    } else fail(`3c. claim 异常: ${JSON.stringify(claimed.map((c) => c.taskId))}`)
    const afterClaim = await prisma.printTask.findUnique({ where: { id: created.taskId } })
    if (afterClaim?.status === 'claimed' && afterClaim.terminalId === terminalId) {
      pass('3d. claim 后 DB 状态为 claimed 且目标终端保持不变')
    } else fail(`3d. claim 后状态异常: ${afterClaim?.status} / ${afterClaim?.terminalId}`)

    // ── 4. 状态回传 printing → completed ──────────────────────────────
    await terminals.patchTaskStatus(created.taskId, { status: 'printing' }, `Bearer ${agentToken}`, terminalId)
    const afterPrinting = await printJobs.getStatus(created.taskId)
    if (afterPrinting.status === 'printing') pass('4a. 状态回传 → printing')
    else fail(`4a. printing 异常: ${afterPrinting.status}`)

    await terminals.patchTaskStatus(created.taskId, { status: 'completed' }, `Bearer ${agentToken}`, terminalId)
    const afterCompleted = await printJobs.getStatus(created.taskId)
    if (afterCompleted.status === 'completed' && typeof afterCompleted.completedAt === 'string') {
      pass('4b. 状态回传 → completed（含 completedAt）')
    } else fail(`4b. completed 异常: ${JSON.stringify(afterCompleted)}`)

    // ── 5. 终态幂等 ───────────────────────────────────────────────────
    const completedAt1 = afterCompleted.completedAt
    const ack = await terminals.patchTaskStatus(created.taskId, { status: 'completed' }, `Bearer ${agentToken}`, terminalId)
    const afterRepatch = await printJobs.getStatus(created.taskId)
    if (ack.acknowledged === true && afterRepatch.status === 'completed' && afterRepatch.completedAt === completedAt1) {
      pass('5a. 终态幂等：重复回传 completed → ack 且 completedAt 不变（DB 未重写）')
    } else fail(`5a. 幂等异常: ${JSON.stringify(afterRepatch)}`)

    await expectCode(
      () => terminals.patchTaskStatus(created.taskId, { status: 'failed' }, `Bearer ${agentToken}`, terminalId),
      'PRINT_TASK_TERMINAL_STATUS_CONFLICT',
      '5b. completed 后回传 failed → 409 终态冲突',
    )
    const afterIllegal = await printJobs.getStatus(created.taskId)
    if (afterIllegal.status === 'completed' && afterIllegal.completedAt === completedAt1) {
      pass('5c. 终态冲突被拒绝后状态与 completedAt 均保持不变')
    } else fail(`5c. 终态冲突后状态异常: ${JSON.stringify(afterIllegal)}`)

    await expectCode(
      () => terminals.patchTaskStatus(created.taskId, { status: 'printing' }, `Bearer ${agentToken}`, terminalId),
      'INVALID_STATUS_TRANSITION',
      '5d. completed 后回退 printing → 400 非法转换',
    )

    // ── 6. 状态查询 404 ───────────────────────────────────────────────
    await expectCode(
      () => printJobs.getStatus(`ptask_nonexistent_${suffix}`),
      'PRINT_TASK_NOT_FOUND',
      '6. 查询不存在任务 → 404 PRINT_TASK_NOT_FOUND',
    )

    // ── 7. 失败原因安全口径（不泄露 Agent 原始 errorMessage）────────────
    // 前置：终端仍 online（section 3 已恢复），失败任务能被本终端 claim。

    // Agent 回传含敏感路径 / 驱动 / 主机名 / 内部堆栈的原始 errorMessage。
    const RAW_SENSITIVE_MESSAGE =
      'TWAIN driver fault 0x8007000E at C:\\Windows\\System32\\spool\\drivers\\x64\\3\\PANTUM.DLL ' +
      'on host KIOSK-PC-01\n    at PrintSpooler.dispatch (spooler.cpp:1423)\n    at Agent.run (agent.ts:88)'
    const SENSITIVE_FRAGMENTS = [
      'C:\\', 'spool', 'PANTUM.DLL', 'KIOSK-PC-01', '0x8007', 'spooler.cpp', 'agent.ts',
    ]

    // 复用 helper：创建 → backdate → claim → 回传 failed（含原始敏感 errorMessage）。
    async function createClaimAndFail(
      label: string,
      backdateIso: string,
      errorCode: string | undefined,
      errorMessage: string,
    ): Promise<string> {
      const dto: CreatePrintJobDto = {
        fileUrl:  signFileUrl(fileId, 30 * 60 * 1000).url,
        fileMd5:  'sha256-vpj-fail',
        fileName: `${label}.pdf`,
      }
      const failCreated = await printJobs.create(dto, { terminalId })
      createdTaskIds.push(failCreated.taskId)
      await prisma.printTask.update({
        where: { id: failCreated.taskId },
        data:  { createdAt: new Date(backdateIso) },
      })
      // 先付后印是硬规则：本节要验的是「失败回传如何脱敏」，不是绕开付费门控，
      // 所以夹具按线下收款入账后再让 Agent 领取。
      await orderStatus.markPaid(failCreated.orderId, { paymentSource: 'offline' })
      const claim = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
      if (claim.length !== 1 || claim[0].taskId !== failCreated.taskId) {
        fail(`7 预备(${label}) — 失败任务未被本终端 claim: ${JSON.stringify(claim.map((c) => c.taskId))}`)
      }
      await terminals.patchTaskStatus(
        failCreated.taskId,
        { status: 'failed', ...(errorCode ? { errorCode } : {}), errorMessage },
        `Bearer ${agentToken}`,
        terminalId,
      )
      return failCreated.taskId
    }

    // 7a/7b/7c/7d：已知错误码（白名单）+ 敏感原始 errorMessage。
    const knownFailId = await createClaimAndFail('失败任务-已知码', '2019-01-01T00:00:00.000Z', 'PRINTER_OFFLINE', RAW_SENSITIVE_MESSAGE)

    // DB 仍完整保留 Agent 原始 errorCode/errorMessage（后台排障可用）。
    const dbFail = await prisma.printTask.findUnique({ where: { id: knownFailId } })
    if (dbFail?.status === 'failed' && dbFail.errorCode === 'PRINTER_OFFLINE' && dbFail.errorMessage === RAW_SENSITIVE_MESSAGE) {
      pass('7a. DB 仍完整保存 Agent 原始 errorCode/errorMessage（后台排障可用）')
    } else {
      fail(`7a. DB 未保留原始错误: ${JSON.stringify({ status: dbFail?.status, errorCode: dbFail?.errorCode, errorMessage: dbFail?.errorMessage })}`)
    }

    // getStatus() 只回白名单安全文案。
    const userView = await printJobs.getStatus(knownFailId)
    const safeExpected = '打印机离线，请联系工作人员检查设备'
    if (userView.failureReasonForUser === safeExpected && userView.errorMessage === safeExpected) {
      pass('7b. getStatus 已知错误码 → failureReasonForUser/errorMessage 均为白名单安全文案')
    } else {
      fail(`7b. 安全文案异常: ${JSON.stringify({ failureReasonForUser: userView.failureReasonForUser, errorMessage: userView.errorMessage })}`)
    }

    // 关键断言：用户视图**任何字段**都不得包含 Agent 原始敏感片段。
    const userBlob = JSON.stringify(userView)
    const leaked = SENSITIVE_FRAGMENTS.filter((frag) => userBlob.includes(frag))
    if (leaked.length === 0) {
      pass('7c. getStatus 返回体不含任何 Agent 原始敏感片段（路径/驱动/主机/堆栈）')
    } else {
      fail(`7c. 检测到敏感信息泄露: ${leaked.join(', ')} ; blob=${userBlob}`)
    }

    // errorCode 仍下发（供前端本地映射兜底）。
    if (userView.errorCode === 'PRINTER_OFFLINE') pass('7d. getStatus 仍返回 errorCode（前端本地映射兜底用）')
    else fail(`7d. errorCode 未返回: ${userView.errorCode}`)

    // 7e：未知错误码 → 统一默认安全文案，且不泄露原始敏感信息。
    const unknownFailId = await createClaimAndFail('失败任务-未知码', '2019-01-02T00:00:00.000Z', 'INTERNAL_SEGFAULT_0x1234', RAW_SENSITIVE_MESSAGE)
    const userView2 = await printJobs.getStatus(unknownFailId)
    const defaultExpected = '打印任务失败，请联系工作人员处理或稍后重试'
    const leaked2 = SENSITIVE_FRAGMENTS.filter((frag) => JSON.stringify(userView2).includes(frag))
    if (userView2.failureReasonForUser === defaultExpected && userView2.errorMessage === defaultExpected && leaked2.length === 0) {
      pass('7e. 未知错误码 → 默认安全兜底文案，且不泄露原始敏感信息')
    } else {
      fail(`7e. 未知错误码兜底异常: ${JSON.stringify({ failureReasonForUser: userView2.failureReasonForUser, errorMessage: userView2.errorMessage, leaked2 })}`)
    }

    // 7f/7g：完全无 errorCode，Agent 只回原始 errorMessage（最易泄露的场景——
    // 失败判定只能靠 errorMessage 命中，且映射函数拿不到任何 errorCode）。
    const noCodeFailId = await createClaimAndFail('失败任务-仅原始文本', '2019-01-03T00:00:00.000Z', undefined, RAW_SENSITIVE_MESSAGE)

    // DB 仍完整保存原始 errorMessage；errorCode 落库为空。
    const dbNoCode = await prisma.printTask.findUnique({ where: { id: noCodeFailId } })
    if (dbNoCode?.status === 'failed' && dbNoCode.errorMessage === RAW_SENSITIVE_MESSAGE && !dbNoCode.errorCode) {
      pass('7f. 仅原始 errorMessage（无 errorCode）→ DB 仍完整保存原文，errorCode 为空')
    } else {
      fail(`7f. DB 状态异常: ${JSON.stringify({ status: dbNoCode?.status, errorCode: dbNoCode?.errorCode, errorMessage: dbNoCode?.errorMessage })}`)
    }

    // getStatus() 无 errorCode 可映射 → 统一默认安全文案，且不泄露原始敏感信息。
    const userView3 = await printJobs.getStatus(noCodeFailId)
    const leaked3 = SENSITIVE_FRAGMENTS.filter((frag) => JSON.stringify(userView3).includes(frag))
    if (userView3.failureReasonForUser === defaultExpected && userView3.errorMessage === defaultExpected && leaked3.length === 0) {
      pass('7g. 仅原始 errorMessage（无 errorCode）→ getStatus 回默认安全文案，failureReasonForUser/errorMessage 一致且不泄露原文')
    } else {
      fail(`7g. 仅原始 errorMessage 兜底异常: ${JSON.stringify({ failureReasonForUser: userView3.failureReasonForUser, errorMessage: userView3.errorMessage, leaked3 })}`)
    }

    const piiFileId = `file_vpj_pii_${suffix}`
    const piiKey = `verify/print-jobs/${piiFileId}.pdf`
    fixtureFileIds.push(piiFileId)
    fixtureStorageKeys.push(piiKey)
    const piiSha = createHash('sha256').update(pdfBytes).digest('hex')
    await storage.putObject(piiKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: piiFileId,
        storageKey: piiKey,
        filename: 'pii.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdfBytes.length,
        sha256: piiSha,
        purpose: 'print_doc',
        status: 'active',
        bucket: LOCAL_BUCKET_SENTINEL,
      },
    })
    await prisma.documentProcessTask.create({
      data: {
        kind: 'pii_scan',
        status: 'completed',
        sourceFileId: piiFileId,
        paramsJson: JSON.stringify({ sourceSha256: piiSha }),
        resultJson: JSON.stringify({ mode: 'real', findingCount: 0 }),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })
    const piiSigned = signFileUrl(piiFileId, 30 * 60 * 1000)
    const piiDto: CreatePrintJobDto = { fileUrl: piiSigned.url, fileMd5: piiSha, fileName: 'pii.pdf' }
    const piiCreated = await printJobs.create(piiDto, {
      ipAddress: '127.0.0.1',
      userAgent: 'verify',
      endUserId: null,
      terminalId,
    })
    createdTaskIds.push(piiCreated.taskId)
    pass('API-27c 扫描 sha256 与文件一致时可建单')
    await prisma.fileObject.update({ where: { id: piiFileId }, data: { sha256: 'b'.repeat(64) } })
    await expectCode(
      () => printJobs.create(piiDto, {
        ipAddress: '127.0.0.1',
        userAgent: 'verify',
        endUserId: null,
        terminalId,
      }),
      'PII_SCAN_STALE',
      'API-27c 建单比对 sha256 不一致 → 409 PII_SCAN_STALE',
    )

    async function sessionFor(taskId: string): Promise<string> {
      const order = await prisma.order.findFirst({ where: { printTaskId: taskId } })
      if (!order) fail(`sessionFor 找不到订单: ${taskId}`)
      return createPaymentSessionToken({
        orderId: order.id,
        orderNo: order.orderNo,
        terminalId,
        amountCents: order.amountCents,
        printTaskId: taskId,
      })
    }

    // ── 8. 失败带走链接 / 已付费失败单重新提交 ────────────────────────
    await expectCode(
      () => printJobs.issueTakeawayUrl(created.taskId, {}),
      'PRINT_TASK_NOT_FOUND',
      '8a. takeaway-url 无归属凭证 → 404',
    )
    const otherOrderSession = await sessionFor(piiCreated.taskId)
    await expectCode(
      () => printJobs.issueTakeawayUrl(created.taskId, { paymentSessionToken: otherOrderSession }),
      'PRINT_TASK_NOT_FOUND',
      '8b. takeaway-url 越权（其他订单支付会话）→ 404',
    )
    const takeaway = await printJobs.issueTakeawayUrl(created.taskId, {
      paymentSessionToken: await sessionFor(created.taskId),
    })
    const takeawayMs = Date.parse(takeaway.expiresAt) - Date.now()
    if (
      takeaway.orderId === created.orderId &&
      takeaway.signedUrl.includes(`/files/`) &&
      takeawayMs > 20 * 60 * 1000
    ) {
      pass('8c. takeaway-url 本单归属可签发约 30 分钟签名 URL')
    } else {
      fail(`8c. takeaway 异常: ${JSON.stringify({ orderId: takeaway.orderId, expiresAt: takeaway.expiresAt, signedUrl: takeaway.signedUrl })}`)
    }

    const retryOrderBefore = await prisma.order.findFirst({ where: { printTaskId: knownFailId } })
    if (!retryOrderBefore) fail('8d 预备：失败单没有订单')
    const orderCountBefore = await prisma.order.count({ where: { printTaskId: knownFailId } })
    const retried = await printJobs.retryPaidFailedJob(knownFailId, {
      paymentSessionToken: await sessionFor(knownFailId),
    })
    const retryOrderAfter = await prisma.order.findFirst({ where: { printTaskId: knownFailId } })
    const orderCountAfter = await prisma.order.count({ where: { printTaskId: knownFailId } })
    if (
      retried.taskId === knownFailId &&
      retried.orderId === retryOrderBefore.id &&
      retried.amountCents === retryOrderBefore.amountCents &&
      retried.status === 'pending' &&
      retryOrderAfter?.id === retryOrderBefore.id &&
      retryOrderAfter.amountCents === retryOrderBefore.amountCents &&
      orderCountBefore === 1 &&
      orderCountAfter === 1
    ) {
      pass('8d. retry 不产生新订单、不改金额，同一任务回到 pending')
    } else {
      fail(`8d. retry 金额/订单异常: ${JSON.stringify({ retried, before: retryOrderBefore, after: retryOrderAfter, orderCountBefore, orderCountAfter })}`)
    }

    const retriedAgain = await printJobs.retryPaidFailedJob(knownFailId, {
      paymentSessionToken: await sessionFor(knownFailId),
    })
    if (retriedAgain.taskId === knownFailId && retriedAgain.orderId === retryOrderBefore.id && retriedAgain.amountCents === retryOrderBefore.amountCents) {
      pass('8e. retry 幂等：已重新提交的 pending 单再调一次仍是同一订单与金额')
    } else {
      fail(`8e. retry 幂等异常: ${JSON.stringify(retriedAgain)}`)
    }

    await expectCode(
      () => printJobs.retryPaidFailedJob(knownFailId, { paymentSessionToken: otherOrderSession }),
      'PRINT_TASK_NOT_FOUND',
      '8f. retry 越权 → 404',
    )

    // retry 会把 knownFailId 放回 pending，且它的 createdAt 更早；
    // 不先移出队列的话，后面 createClaimAndFail 会被它截走 claim。
    await prisma.printTask.update({
      where: { id: knownFailId },
      data: { status: 'cancelled' },
    })
    await prisma.order.updateMany({
      where: { printTaskId: knownFailId },
      data: { taskStatus: 'cancelled' },
    })

    const unconfirmedId = await createClaimAndFail(
      '失败任务-无法确认',
      '2019-01-04T00:00:00.000Z',
      'PRINT_JOB_UNCONFIRMED',
      RAW_SENSITIVE_MESSAGE,
    )
    await expectCode(
      async () => printJobs.retryPaidFailedJob(unconfirmedId, { paymentSessionToken: await sessionFor(unconfirmedId) }),
      'PRINT_RETRY_UNCONFIRMED_FORBIDDEN',
      '8g. PRINT_JOB_UNCONFIRMED 禁止重新提交',
    )

    const unpaid = await printJobs.create({
      fileUrl: signFileUrl(fileId, 30 * 60 * 1000).url,
      fileMd5: 'sha256-vpj-unpaid-retry',
      fileName: '未支付失败单.pdf',
    }, { terminalId })
    createdTaskIds.push(unpaid.taskId)
    await prisma.printTask.update({ where: { id: unpaid.taskId }, data: { status: 'failed', errorCode: 'PRINTER_OFFLINE' } })
    await prisma.order.updateMany({ where: { printTaskId: unpaid.taskId }, data: { taskStatus: 'failed' } })
    await expectCode(
      () => printJobs.retryPaidFailedJob(unpaid.taskId, { paymentSessionToken: unpaid.paymentSessionToken }),
      'PRINT_RETRY_NOT_PAID',
      '8h. 未支付失败单不能重新提交',
    )

    const unpaidTakeaway = await printJobs.issueTakeawayUrl(unpaid.taskId, {
      paymentSessionToken: unpaid.paymentSessionToken,
    })
    const unconfirmedTakeaway = await printJobs.issueTakeawayUrl(unconfirmedId, {
      paymentSessionToken: await sessionFor(unconfirmedId),
    })
    if (unpaidTakeaway.canRetry || unconfirmedTakeaway.canRetry) {
      fail('8i. 未支付或 PRINT_JOB_UNCONFIRMED 不得 canRetry')
    }
    pass('8i. active 文件上，未支付与 PRINT_JOB_UNCONFIRMED 的 canRetry 仍为 false')

    const retryMatrix = await printJobs.create({
      fileUrl: signFileUrl(fileId, 30 * 60 * 1000).url,
      fileName: 'canRetry-matrix.pdf',
    }, { terminalId })
    createdTaskIds.push(retryMatrix.taskId)
    await orderStatus.markPaid(retryMatrix.orderId, { paymentSource: 'offline' })
    await prisma.printTask.update({
      where: { id: retryMatrix.taskId },
      data: { status: 'failed', errorCode: 'PRINT_COMMAND_FAILED' },
    })
    await prisma.order.updateMany({
      where: { printTaskId: retryMatrix.taskId },
      data: { taskStatus: 'failed' },
    })
    const matrixToken = retryMatrix.paymentSessionToken
    const readCanRetry = async () => (await printJobs.issueTakeawayUrl(retryMatrix.taskId, {
      paymentSessionToken: matrixToken,
    })).canRetry
    if (!await readCanRetry()) fail('8j. active 且未过期必须 canRetry')
    await prisma.fileObject.update({ where: { id: fileId }, data: { expiresAt: null } })
    if (!await readCanRetry()) fail('8j. active 且 expiresAt 为空必须 canRetry')
    pass('8j. active future / expiresAt null 的已付失败单 canRetry 为 true')

    const rejectWithoutSideEffect = async (label: string) => {
      const beforeTask = await prisma.printTask.findUnique({
        where: { id: retryMatrix.taskId },
        select: { status: true },
      })
      const beforeOrder = await prisma.order.findUnique({
        where: { id: retryMatrix.orderId },
        select: { payStatus: true, amountCents: true, taskStatus: true, refundedAmountCents: true },
      })
      await expectCode(
        () => printJobs.retryPaidFailedJob(retryMatrix.taskId, { paymentSessionToken: matrixToken }),
        'PRINT_RETRY_FILE_UNAVAILABLE',
        label,
      )
      const afterTask = await prisma.printTask.findUnique({
        where: { id: retryMatrix.taskId },
        select: { status: true },
      })
      const afterOrder = await prisma.order.findUnique({
        where: { id: retryMatrix.orderId },
        select: { payStatus: true, amountCents: true, taskStatus: true, refundedAmountCents: true },
      })
      if (
        beforeTask?.status !== 'failed' || afterTask?.status !== 'failed' ||
        beforeOrder?.payStatus !== 'paid' || afterOrder?.payStatus !== 'paid' ||
        beforeOrder.amountCents !== afterOrder?.amountCents ||
        beforeOrder.taskStatus !== 'failed' || afterOrder?.taskStatus !== 'failed' ||
        beforeOrder.refundedAmountCents !== 0 || afterOrder?.refundedAmountCents !== 0
      ) {
        fail(`${label} 产生了任务或订单副作用`)
      }
    }
    try {
      await prisma.fileObject.update({ where: { id: fileId }, data: { status: 'active', deletedAt: null, expiresAt: new Date(Date.now() - 60_000) } })
      await expectCode(
        () => printJobs.issueTakeawayUrl(retryMatrix.taskId, { paymentSessionToken: matrixToken }),
        'PRINT_TAKEAWAY_FILE_UNAVAILABLE',
        '8k. 过期文件不签发带走链接',
      )
      await rejectWithoutSideEffect('8k. 过期文件 retry 拒绝且无副作用')
      await prisma.fileObject.update({ where: { id: fileId }, data: { status: 'quarantined', deletedAt: null, expiresAt: fileExpiry } })
      await expectCode(
        () => printJobs.issueTakeawayUrl(retryMatrix.taskId, { paymentSessionToken: matrixToken }),
        'PRINT_TAKEAWAY_FILE_UNAVAILABLE',
        '8k. 隔离文件不签发带走链接',
      )
      await rejectWithoutSideEffect('8k. 隔离文件 retry 拒绝且无副作用')
      await prisma.fileObject.update({ where: { id: fileId }, data: { status: 'uploading', deletedAt: null, expiresAt: fileExpiry } })
      await expectCode(
        () => printJobs.issueTakeawayUrl(retryMatrix.taskId, { paymentSessionToken: matrixToken }),
        'PRINT_TAKEAWAY_FILE_UNAVAILABLE',
        '8k. 上传中文件不签发带走链接',
      )
      await rejectWithoutSideEffect('8k. 上传中文件 retry 拒绝且无副作用')
      await prisma.fileObject.update({
        where: { id: fileId },
        data: { status: 'deleted', deletedAt: new Date(), expiresAt: fileExpiry },
      })
      await expectCode(
        () => printJobs.issueTakeawayUrl(retryMatrix.taskId, { paymentSessionToken: matrixToken }),
        'PRINT_TAKEAWAY_FILE_UNAVAILABLE',
        '8k. 已删除文件不返回 canRetry',
      )
      await rejectWithoutSideEffect('8k. 已删除文件 retry 拒绝且无副作用')
    } finally {
      await prisma.fileObject.update({
        where: { id: fileId },
        data: { status: 'active', deletedAt: null, expiresAt: fileExpiry },
      })
    }
    if (!await readCanRetry()) fail('8l. 恢复为 active 后必须重新 canRetry')
    const matrixBefore = await prisma.order.findUnique({
      where: { id: retryMatrix.orderId },
      select: { amountCents: true, payStatus: true },
    })
    const matrixRetried = await printJobs.retryPaidFailedJob(retryMatrix.taskId, { paymentSessionToken: matrixToken })
    if (
      matrixRetried.taskId !== retryMatrix.taskId ||
      matrixRetried.orderId !== retryMatrix.orderId ||
      matrixRetried.amountCents !== matrixBefore?.amountCents ||
      matrixRetried.status !== 'pending' ||
      matrixBefore?.payStatus !== 'paid'
    ) {
      fail(`8l. active 重试应保持同一订单与金额: ${JSON.stringify(matrixRetried)}`)
    }
    const matrixRow = await prisma.printTask.findUnique({ where: { id: retryMatrix.taskId }, select: { status: true } })
    const matrixOrder = await prisma.order.findUnique({
      where: { id: retryMatrix.orderId },
      select: { amountCents: true, payStatus: true, taskStatus: true },
    })
    if (
      matrixRow?.status !== 'pending' ||
      matrixOrder?.taskStatus !== 'pending' ||
      matrixOrder?.payStatus !== 'paid' ||
      matrixOrder?.amountCents !== matrixBefore?.amountCents
    ) {
      fail(`8l. 重试后数据库状态异常: ${JSON.stringify({ matrixRow, matrixOrder })}`)
    }
    pass('8l. active 重试仍是同一订单与金额，数据库回到 pending')
    await prisma.printTask.update({ where: { id: retryMatrix.taskId }, data: { status: 'cancelled' } })
    await prisma.order.updateMany({ where: { printTaskId: retryMatrix.taskId }, data: { taskStatus: 'cancelled' } })

    const legacyFileId = `file_vpj_legacy_${suffix}`
    const legacyKey = `verify/print-jobs/${legacyFileId}.pdf`
    fixtureFileIds.push(legacyFileId)
    fixtureStorageKeys.push(legacyKey)
    await storage.putObject(legacyKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: legacyFileId,
        storageKey: legacyKey,
        filename: 'legacy-file.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdfBytes.length,
        sha256: reportSha256,
        purpose: 'print_source',
        status: 'active',
        expiresAt: fileExpiry,
        bucket: LOCAL_BUCKET_SENTINEL,
      },
    })
    const legacyJob = await printJobs.create({
      fileUrl: signFileUrl(legacyFileId, 30 * 60 * 1000).url,
      fileName: 'legacy-null-file-id.pdf',
    }, { terminalId })
    createdTaskIds.push(legacyJob.taskId)
    await orderStatus.markPaid(legacyJob.orderId, { paymentSource: 'offline' })
    await prisma.printTask.update({
      where: { id: legacyJob.taskId },
      data: { status: 'failed', errorCode: 'PRINT_COMMAND_FAILED', fileId: null },
    })
    await prisma.order.updateMany({
      where: { printTaskId: legacyJob.taskId },
      data: { taskStatus: 'failed' },
    })
    const legacyToken = legacyJob.paymentSessionToken
    const legacyTakeaway = await printJobs.issueTakeawayUrl(legacyJob.taskId, { paymentSessionToken: legacyToken })
    const legacyUrl = parseSignedContentUrl(legacyTakeaway.signedUrl)
    if (!legacyTakeaway.canRetry || legacyUrl.fileId !== legacyFileId || !verifyFileSignature(legacyUrl.fileId, legacyUrl.expires, legacyUrl.sig)) {
      fail('8m. fileId 为空但内部签名 URL 可解析时，active 文件应可带走且 canRetry')
    }
    const forgedUrl = `https://evil.example/api/v1/files/${legacyFileId}/content?expires=123&sig=${'ab'.repeat(32)}`
    await prisma.printTask.update({ where: { id: legacyJob.taskId }, data: { fileUrl: forgedUrl } })
    await expectCode(
      () => printJobs.issueTakeawayUrl(legacyJob.taskId, { paymentSessionToken: legacyToken }),
      'PRINT_TAKEAWAY_FILE_UNAVAILABLE',
      '8m. 外部同路径加伪签名不得恢复 fileId',
    )
    await expectCode(
      () => printJobs.retryPaidFailedJob(legacyJob.taskId, { paymentSessionToken: legacyToken }),
      'PRINT_RETRY_FILE_UNAVAILABLE',
      '8m. 外部同路径加伪签名不得重试',
    )
    const expiredAt = Date.now() - 60_000
    const expiredSig = fixtureFileSignature(legacyFileId, expiredAt)
    const expiredUrl = `/api/v1/files/${legacyFileId}/content?expires=${expiredAt}&sig=${expiredSig}`
    if (verifyFileSignature(legacyFileId, String(expiredAt), expiredSig)) {
      fail('8m. 普通验签不得接受已过期 HMAC')
    }
    await prisma.printTask.update({ where: { id: legacyJob.taskId }, data: { fileUrl: expiredUrl } })
    const expiredTakeaway = await printJobs.issueTakeawayUrl(legacyJob.taskId, { paymentSessionToken: legacyToken })
    if (!expiredTakeaway.canRetry || parseSignedContentUrl(expiredTakeaway.signedUrl).fileId !== legacyFileId) {
      fail('8m. 合法但已过期的内部 HMAC 应由已授权任务恢复')
    }
    const hostExpires = Date.now() + 30 * 60 * 1000
    const hostUrl = `https://files.example/api/v1/files/${legacyFileId}/content?expires=${hostExpires}&sig=${fixtureFileSignature(legacyFileId, hostExpires)}`
    const hostCreated = await printJobs.create({ fileUrl: hostUrl, fileName: 'host-hmac.pdf' }, { terminalId })
    createdTaskIds.push(hostCreated.taskId)
    await prisma.printTask.update({ where: { id: hostCreated.taskId }, data: { status: 'cancelled' } })
    await prisma.order.updateMany({ where: { printTaskId: hostCreated.taskId }, data: { taskStatus: 'cancelled' } })
    await prisma.printTask.update({ where: { id: legacyJob.taskId }, data: { fileUrl: hostUrl } })
    const hostTakeaway = await printJobs.issueTakeawayUrl(legacyJob.taskId, { paymentSessionToken: legacyToken })
    if (parseSignedContentUrl(hostTakeaway.signedUrl).fileId !== legacyFileId) {
      fail('8m. 带 host 的合法 HMAC 应能恢复，建单端已接受这种 URL')
    }
    pass('8m. 伪签名拒绝；过期真签名与带 host 的真签名可恢复')
    const legacyBefore = await prisma.order.findUnique({
      where: { id: legacyJob.orderId },
      select: { amountCents: true },
    })
    const legacyRetried = await printJobs.retryPaidFailedJob(legacyJob.taskId, { paymentSessionToken: legacyToken })
    const legacyRow = await prisma.printTask.findUnique({ where: { id: legacyJob.taskId }, select: { status: true, fileId: true } })
    const legacyOrder = await prisma.order.findUnique({
      where: { id: legacyJob.orderId },
      select: { amountCents: true, payStatus: true, taskStatus: true },
    })
    if (
      legacyRetried.orderId !== legacyJob.orderId ||
      legacyRetried.amountCents !== legacyBefore?.amountCents ||
      legacyRow?.status !== 'pending' ||
      legacyRow.fileId !== null ||
      legacyOrder?.payStatus !== 'paid' ||
      legacyOrder.taskStatus !== 'pending' ||
      legacyOrder.amountCents !== legacyBefore?.amountCents
    ) {
      fail(`8m. 旧单重试后订单或任务异常: ${JSON.stringify({ legacyRetried, legacyRow, legacyOrder })}`)
    }
    pass('8m. 历史 fileId 为空、内部签名 URL 指向 active 文件时，可带走并按原订单重试')
    await prisma.printTask.update({ where: { id: legacyJob.taskId }, data: { status: 'failed', errorCode: 'PRINT_COMMAND_FAILED' } })
    await prisma.order.updateMany({ where: { printTaskId: legacyJob.taskId }, data: { taskStatus: 'failed' } })
    await prisma.fileObject.update({
      where: { id: legacyFileId },
      data: { status: 'deleted', deletedAt: new Date() },
    })
    await expectCode(
      () => printJobs.issueTakeawayUrl(legacyJob.taskId, { paymentSessionToken: legacyToken }),
      'PRINT_TAKEAWAY_FILE_UNAVAILABLE',
      '8m. 历史空 fileId 在文件删除后拒绝带走',
    )
    await expectCode(
      () => printJobs.retryPaidFailedJob(legacyJob.taskId, { paymentSessionToken: legacyToken }),
      'PRINT_RETRY_FILE_UNAVAILABLE',
      '8m. 历史空 fileId 在文件删除后拒绝重试',
    )
    await prisma.printTask.update({ where: { id: legacyJob.taskId }, data: { status: 'cancelled' } })
    await prisma.order.updateMany({ where: { printTaskId: legacyJob.taskId }, data: { taskStatus: 'cancelled' } })

    const misaligned = await printJobs.create({
      fileUrl: signFileUrl(fileId, 30 * 60 * 1000).url,
      fileName: 'order-task-mismatch.pdf',
    }, { terminalId })
    createdTaskIds.push(misaligned.taskId)
    await orderStatus.markPaid(misaligned.orderId, { paymentSource: 'offline' })
    await prisma.printTask.update({
      where: { id: misaligned.taskId },
      data: { status: 'failed', errorCode: 'PRINT_COMMAND_FAILED' },
    })
    await prisma.order.updateMany({
      where: { printTaskId: misaligned.taskId },
      data: { taskStatus: 'printing' },
    })
    const misalignedView = await printJobs.issueTakeawayUrl(misaligned.taskId, {
      paymentSessionToken: misaligned.paymentSessionToken,
    })
    if (misalignedView.canRetry) fail('8n. 订单任务状态不是 failed 时不得 canRetry')
    await expectCode(
      () => printJobs.retryPaidFailedJob(misaligned.taskId, { paymentSessionToken: misaligned.paymentSessionToken }),
      'PRINT_RETRY_INVALID_STATE',
      '8n. 订单任务状态不对齐时 retry 拒绝',
    )
    await prisma.printTask.update({ where: { id: misaligned.taskId }, data: { status: 'cancelled' } })
    await prisma.order.updateMany({ where: { printTaskId: misaligned.taskId }, data: { taskStatus: 'cancelled' } })

    const disabledRetry = await printJobs.create({
      fileUrl: signFileUrl(fileId, 30 * 60 * 1000).url,
      fileName: 'terminal-disabled.pdf',
    }, { terminalId })
    createdTaskIds.push(disabledRetry.taskId)
    await orderStatus.markPaid(disabledRetry.orderId, { paymentSource: 'offline' })
    await prisma.printTask.update({
      where: { id: disabledRetry.taskId },
      data: { status: 'failed', errorCode: 'PRINT_COMMAND_FAILED' },
    })
    await prisma.order.updateMany({
      where: { printTaskId: disabledRetry.taskId },
      data: { taskStatus: 'failed' },
    })
    await prisma.terminal.update({ where: { id: terminalId }, data: { enabled: false } })
    try {
      const disabledView = await printJobs.issueTakeawayUrl(disabledRetry.taskId, {
        paymentSessionToken: disabledRetry.paymentSessionToken,
      })
      if (disabledView.canRetry) fail('8o. 终端禁用时不得 canRetry')
      await expectCode(
        () => printJobs.retryPaidFailedJob(disabledRetry.taskId, { paymentSessionToken: disabledRetry.paymentSessionToken }),
        'PRINT_RETRY_TERMINAL_NOT_ACTIVE',
        '8o. 终端禁用时 retry 拒绝',
      )
    } finally {
      await prisma.terminal.update({ where: { id: terminalId }, data: { enabled: true, lifecycleStatus: 'active' } })
    }
    await prisma.printTask.update({ where: { id: disabledRetry.taskId }, data: { status: 'cancelled' } })
    await prisma.order.updateMany({ where: { printTaskId: disabledRetry.taskId }, data: { taskStatus: 'cancelled' } })

    // ── 9. 动态价格二次确认 ────────────────────────────────────────────
    // 夹具文件 1 页 × 2 份黑白 → 应付 = 单价 × 2。quotedAmountCents 只作一致性断言：
    // 不一致必须 409 PRICE_CHANGED、带回当前报价，且 Order / PrintTask / 支付尝试 / 建单审计全部零新增。
    const priceParams = {
      copies: 2, colorMode: 'black_white', duplex: 'simplex', paperSize: 'A4',
      orientation: 'auto', quality: 'standard', scale: 'fit', pagesPerSheet: 1,
    } as const
    const priceDto = (extra: Record<string, unknown> = {}) => ({
      fileUrl: signFileUrl(fileId, 30 * 60 * 1000).url,
      fileMd5: 'sha256-vpj-price',
      fileName: '价格确认.pdf',
      params: { ...priceParams },
      ...extra,
    })
    const setBwUnit = (unitCents: number) =>
      prisma.priceConfig.update({ where: { serviceKey: 'print_bw_page' }, data: { unitCents } })
    const sideEffects = async () => JSON.stringify({
      orders: await prisma.order.count({ where: { terminalId } }),
      tasks: await prisma.printTask.count({ where: { terminalId } }),
      attempts: await prisma.paymentAttempt.count({ where: { order: { terminalId } } }),
      createAudits: await prisma.auditLog.count({ where: { action: 'print_job.create' } }),
    })
    const priceChangedShape = (details: string[] | undefined, current: number) =>
      Boolean(details?.includes(`currentAmountCents=${current}`))
      && Boolean(details?.includes('billablePages=1'))
      && Boolean(details?.includes(`line=print_bw_page:${current / 2}:2:${current}`))

    async function expectPriceChanged(label: string, quotedAmountCents: unknown, current: number): Promise<void> {
      const before = await sideEffects()
      let thrown: unknown = null
      try {
        const created = await printJobs.create(priceDto({ quotedAmountCents }) as CreatePrintJobDto, { terminalId })
        createdTaskIds.push(created.taskId)
      } catch (e) {
        thrown = e
      }
      const ex = thrown as { getStatus?: () => number; getResponse?: () => unknown } | null
      const resp = ex?.getResponse?.() as { error?: { code?: string; details?: string[] } } | undefined
      if (ex?.getStatus?.() !== 409 || resp?.error?.code !== 'PRICE_CHANGED' || !priceChangedShape(resp.error.details, current)) {
        fail(`${label} — 期望 409 PRICE_CHANGED 且带回当前报价 ${current}，实际: ${thrown ? JSON.stringify(resp ?? String(thrown)) : '建单成功'}`)
      }
      const after = await sideEffects()
      if (after !== before) fail(`${label} — 409 后仍有建单副作用: before=${before} after=${after}`)
      pass(label)
    }

    await setBwUnit(30)
    await expectPriceChanged('9a. 0 → 付费：用户确认 0 元、现价 0.60 元 → 409 且带回 60 分，零建单副作用', 0, 60)
    await setBwUnit(45)
    await expectPriceChanged('9b. 涨价：用户确认 60 分、现价 90 分 → 409 且带回 90 分，零建单副作用', 60, 90)
    await setBwUnit(10)
    await expectPriceChanged('9c. 降价：用户确认 90 分、现价 20 分 → 409 且带回 20 分，零建单副作用', 90, 20)
    await setBwUnit(30)
    await expectPriceChanged('9d. 伪造低价：quotedAmountCents=1 → 409 带回真实 60 分，拿不到低价单', 1, 60)

    // 9e：按 409 带回的新价格二次确认 → 建单，金额取服务端重算值。
    const reconfirmed = await printJobs.create(priceDto({ quotedAmountCents: 60 }) as CreatePrintJobDto, { terminalId })
    createdTaskIds.push(reconfirmed.taskId)
    const reconfirmedOrder = await prisma.order.findUnique({ where: { id: reconfirmed.orderId } })
    if (
      reconfirmed.amountCents === 60 && reconfirmed.payStatus === 'unpaid' && Boolean(reconfirmed.paymentSessionToken)
      && reconfirmedOrder?.amountCents === 60 && reconfirmedOrder.payStatus === 'unpaid'
    ) {
      pass('9e. 按新价格二次确认（quoted=current=60）→ 建付费单 unpaid，金额 60 分')
    } else fail(`9e. 二次确认建单异常: ${JSON.stringify({ reconfirmed, reconfirmedOrder })}`)

    // 9f：已建订单价格冻结，后续改价不影响历史单。
    await setBwUnit(45)
    const frozen = await prisma.order.findUnique({ where: { id: reconfirmed.orderId } })
    const frozenLines = JSON.parse(frozen?.itemsJson ?? '[]') as Array<{ unitCents?: number }>
    if (frozen?.amountCents === 60 && frozenLines[0]?.unitCents === 30) pass('9f. 建单后改价 → 历史订单金额与明细快照不变')
    else fail(`9f. 历史订单价格被改价影响: ${JSON.stringify(frozen)}`)

    // 9g：旧客户端不带 quotedAmountCents → 兼容，照旧按服务端现价（90 分）建单。
    const legacy = await printJobs.create(priceDto() as CreatePrintJobDto, { terminalId })
    createdTaskIds.push(legacy.taskId)
    if (legacy.amountCents === 90 && legacy.payStatus === 'unpaid') pass('9g. 旧客户端缺省 quotedAmountCents → 兼容建单，按服务端现价 90 分')
    else fail(`9g. 旧客户端建单异常: ${JSON.stringify(legacy)}`)

    // 9h：免费路径保持：确认 0 元且现价 0 → 建单即 paid + free。
    await setBwUnit(0)
    const free = await printJobs.create(priceDto({ quotedAmountCents: 0 }) as CreatePrintJobDto, { terminalId })
    createdTaskIds.push(free.taskId)
    const freeOrder = await prisma.order.findUnique({ where: { id: free.orderId } })
    if (free.amountCents === 0 && free.payStatus === 'paid' && freeOrder?.payStatus === 'paid' && freeOrder.paymentSource === 'free') {
      pass('9h. 免费单确认 0 元且现价 0 → paid + free 路径不变')
    } else fail(`9h. 免费单路径异常: ${JSON.stringify({ free, freeOrder })}`)

    // 9-http：同一规则穿过真实 HTTP 管线（DTO 校验 + 全局过滤器），证明 409 体与 400 校验在线上形状下成立。
    await setBwUnit(30)
    const http = await startPrintJobsHttp(printJobs, prisma, terminalId, `vpj-http-session-${suffix}`)
    try {
      const beforeHttp = await sideEffects()
      const stale = await http.post(priceDto({ quotedAmountCents: 20 }))
      if (
        stale.status === 409 && stale.json['success'] === false && stale.json.error?.code === 'PRICE_CHANGED'
        && priceChangedShape(stale.json.error.details, 60)
        && !('orderId' in stale.json) && !('paymentSessionToken' in stale.json) && !('taskId' in stale.json)
      ) {
        pass('9-http-a. POST /api/v1/print/jobs 旧报价 → HTTP 409 PRICE_CHANGED，details 带 currentAmountCents=60 与计价行，无订单/支付会话字段')
      } else fail(`9-http-a. 409 形状异常: ${JSON.stringify(stale)}`)

      for (const bad of [-1, 1.5, '60', null, 100_000_001]) {
        const res = await http.post(priceDto({ quotedAmountCents: bad }))
        if (res.status !== 400 || res.json.error?.code !== 'VALIDATION_FAILED') {
          fail(`9-http-b. quotedAmountCents=${JSON.stringify(bad)} 应 400 VALIDATION_FAILED，实际 ${JSON.stringify(res)}`)
        }
      }
      pass('9-http-b. quotedAmountCents 为负数 / 小数 / 字符串 / null / 超上限 → 400 VALIDATION_FAILED')
      const afterRejects = await sideEffects()
      if (afterRejects === beforeHttp) pass('9-http-c. 409 与 400 全部零 Order / PrintTask / 支付尝试 / 建单审计')
      else fail(`9-http-c. HTTP 拒绝后仍有建单副作用: before=${beforeHttp} after=${afterRejects}`)

      const legacyHttp = await http.post(priceDto())
      const matchedHttp = await http.post(priceDto({ quotedAmountCents: 60 }))
      for (const res of [legacyHttp, matchedHttp]) {
        if (typeof res.json['taskId'] === 'string') createdTaskIds.push(res.json['taskId'])
      }
      if (
        legacyHttp.status === 201 && legacyHttp.json['amountCents'] === 60
        && matchedHttp.status === 201 && matchedHttp.json['amountCents'] === 60
        && typeof matchedHttp.json['paymentSessionToken'] === 'string'
      ) {
        pass('9-http-d. HTTP 缺省字段（旧客户端）与报价一致（新客户端）均 201 建单，金额取服务端 60 分')
      } else fail(`9-http-d. HTTP 建单异常: ${JSON.stringify({ legacyHttp, matchedHttp })}`)
    } finally {
      await http.close()
    }

    // 队头文件在排队后过期时，不得卡住后面仍可打印的已付款任务。
    // 查询层先排除已知不可用文件；事务内仍会再次读取 FileObject 做 fail-closed 检查，
    // 因此查询后才过期的文件仍不会被签发 URL。
    const queueProbeFileId = `file_vpj_queue_probe_${suffix}`
    const queueProbeStorageKey = `verify/print-jobs/${queueProbeFileId}.pdf`
    fixtureFileIds.push(queueProbeFileId)
    fixtureStorageKeys.push(queueProbeStorageKey)
    await storage.putObject(queueProbeStorageKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: queueProbeFileId,
        storageKey: queueProbeStorageKey,
        filename: 'queue-probe.pdf',
        mimeType: 'application/pdf',
        sizeBytes: pdfBytes.length,
        sha256: reportSha256,
        purpose: 'print_source',
        status: 'active',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        bucket: LOCAL_BUCKET_SENTINEL,
      },
    })
    const blockedProbe = await printJobs.create(
      { fileUrl: signFileUrl(fileId, 30 * 60 * 1000).url, fileName: 'blocked-queue-head.pdf' },
      { terminalId },
    )
    const activeProbe = await printJobs.create(
      { fileUrl: signFileUrl(queueProbeFileId, 30 * 60 * 1000).url, fileName: 'active-queue-follow-up.pdf' },
      { terminalId },
    )
    createdTaskIds.push(blockedProbe.taskId, activeProbe.taskId)
    await prisma.printTask.update({ where: { id: blockedProbe.taskId }, data: { createdAt: new Date('2020-01-01T00:00:00.000Z') } })
    await prisma.printTask.update({ where: { id: activeProbe.taskId }, data: { createdAt: new Date('2021-01-01T00:00:00.000Z') } })
    await orderStatus.markPaid(blockedProbe.orderId, { paymentSource: 'offline' })
    await orderStatus.markPaid(activeProbe.orderId, { paymentSource: 'offline' })
    await prisma.fileObject.update({ where: { id: fileId }, data: { expiresAt: new Date(Date.now() - 1_000) } })
    const queueProbeClaim = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
    if (queueProbeClaim.length !== 1 || queueProbeClaim[0]?.taskId !== activeProbe.taskId) {
      fail(`不可用队头不得阻塞后续 active 任务: ${JSON.stringify(queueProbeClaim.map((task) => task.taskId))}`)
    }
    pass('队头文件过期时不签发其 URL，后续 active 任务仍可被 Agent 领取')
    await terminals.patchTaskStatus(activeProbe.taskId, { status: 'failed', errorCode: 'FILE_NOT_FOUND' }, `Bearer ${agentToken}`, terminalId)
    await prisma.fileObject.update({ where: { id: fileId }, data: { expiresAt: fileExpiry } })

    // 检查后才软删除：独立事务在文件读取返回后、PrintTask CAS 前提交。
    // SQLite 的写锁不能在已打开的交互事务里让第二条连接确定性提交，故只在 PostgreSQL 执行。
    if (prisma.dbKind !== 'postgres') {
      console.log('  SKIP claim 文件状态交错：需要 PostgreSQL 上的独立提交事务；SQLite 不跑此夹具')
    } else {
      const staleFileId = `file_vpj_stale_${suffix}`
      const liveFileId = `file_vpj_live_${suffix}`
      const staleKey = `verify/print-jobs/${staleFileId}.pdf`
      const liveKey = `verify/print-jobs/${liveFileId}.pdf`
      fixtureFileIds.push(staleFileId, liveFileId)
      fixtureStorageKeys.push(staleKey, liveKey)
      await storage.putObject(staleKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
      await storage.putObject(liveKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
      await prisma.fileObject.createMany({
        data: [staleFileId, liveFileId].map((id, index) => ({
          id,
          storageKey: index === 0 ? staleKey : liveKey,
          filename: index === 0 ? 'stale-after-check.pdf' : 'live-active.pdf',
          mimeType: 'application/pdf',
          sizeBytes: pdfBytes.length,
          sha256: reportSha256,
          purpose: 'print_source' as const,
          status: 'active',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          bucket: LOCAL_BUCKET_SENTINEL,
        })),
      })
      const staleJob = await printJobs.create(
        { fileUrl: signFileUrl(staleFileId, 30 * 60 * 1000).url, fileName: 'stale-after-check.pdf' },
        { terminalId },
      )
      const liveJob = await printJobs.create(
        { fileUrl: signFileUrl(liveFileId, 30 * 60 * 1000).url, fileName: 'live-active.pdf' },
        { terminalId },
      )
      createdTaskIds.push(staleJob.taskId, liveJob.taskId)
      await prisma.printTask.update({ where: { id: staleJob.taskId }, data: { createdAt: new Date('2018-01-01T00:00:00.000Z') } })
      await prisma.printTask.update({ where: { id: liveJob.taskId }, data: { createdAt: new Date('2019-01-01T00:00:00.000Z') } })
      await orderStatus.markPaid(staleJob.orderId, { paymentSource: 'offline' })
      await orderStatus.markPaid(liveJob.orderId, { paymentSource: 'offline' })
      const files = new FilesService(prisma, audit, storage)
      const content = new FilesController(files, audit, {} as never, {} as never, prisma)
      let staleClaim: Awaited<ReturnType<typeof terminals.claimTasks>> = []
      await claimWhileSoftDeleteCommits(prisma, staleFileId, async () => {
        staleClaim = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
      })
      if (staleClaim.length !== 1 || staleClaim[0]?.taskId !== staleJob.taskId) {
        fail(`检查后软删除仍应领到旧任务，实际: ${JSON.stringify(staleClaim.map((task) => task.taskId))}`)
      }
      const staleUrl = parseSignedContentUrl(staleClaim[0]!.fileUrl)
      if (staleUrl.fileId !== staleFileId || !verifyFileSignature(staleUrl.fileId, staleUrl.expires, staleUrl.sig)) {
        fail('旧任务 claim 返回的 fileUrl 必须是该 fileId 的有效 HMAC content 路径')
      }
      const staleTask = await prisma.printTask.findUnique({ where: { id: staleJob.taskId }, select: { status: true, fileId: true } })
      const staleOrder = await prisma.order.findUnique({
        where: { id: staleJob.orderId },
        select: { payStatus: true, refundedAt: true, refundedAmountCents: true },
      })
      const staleFile = await prisma.fileObject.findUnique({ where: { id: staleFileId }, select: { status: true, deletedAt: true } })
      if (staleTask?.status !== 'claimed' || staleTask.fileId !== staleFileId) fail('旧任务应保持 claimed 且 fileId 不被外键清空')
      if (staleFile?.status !== 'deleted' || !staleFile.deletedAt) fail('屏障必须留下正常软删除，而不是悬空 fileId')
      if (staleOrder?.payStatus !== 'paid' || staleOrder.refundedAt || staleOrder.refundedAmountCents !== 0) {
        fail(`软删除不得改写支付状态: ${JSON.stringify(staleOrder)}`)
      }
      await expectCode(
        () => content.content(staleUrl.fileId, staleUrl.expires, staleUrl.sig, undefined, { setHeader() {}, send() {} } as never),
        'FILE_NOT_FOUND',
        '检查后软删除：claim 的 HMAC content 路径拒绝下载',
      )
      const liveClaim = await terminals.claimTasks(terminalId, { maxTasks: 1 }, `Bearer ${agentToken}`)
      if (liveClaim.length !== 1 || liveClaim[0]?.taskId !== liveJob.taskId) {
        fail(`下一条 active 任务被饿死: ${JSON.stringify(liveClaim.map((task) => task.taskId))}`)
      }
      const liveUrl = parseSignedContentUrl(liveClaim[0]!.fileUrl)
      if (liveUrl.fileId !== liveFileId || !verifyFileSignature(liveUrl.fileId, liveUrl.expires, liveUrl.sig)) {
        fail('active 对照 claim 返回的 fileUrl 必须是该 fileId 的有效 HMAC content 路径')
      }
      const liveResponse = { payload: undefined as Buffer | undefined, setHeader() {}, send(payload: Buffer) { this.payload = payload } }
      await content.content(liveUrl.fileId, liveUrl.expires, liveUrl.sig, undefined, liveResponse as never)
      if (!liveResponse.payload?.equals(pdfBytes)) fail('active 对照应经同一 content 路径读回本地存储字节')
      const liveOrder = await prisma.order.findUnique({ where: { id: liveJob.orderId }, select: { payStatus: true, refundedAmountCents: true } })
      if (liveOrder?.payStatus !== 'paid' || liveOrder.refundedAmountCents !== 0) fail('active 对照不得改写支付状态')
      pass('检查后软删除：旧任务仍被领取但 content 拒绝，下一条 active 可领取且读回字节（本地存储，非 COS / 非出纸）')
    }
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
