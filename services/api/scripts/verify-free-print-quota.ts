/**
 * 免费打印防刷：真实 Nest HTTP、真实终端会话守卫 / 管理员守卫 / 异常过滤器。
 * 临时 SQLite，不写共享库。时钟可注入，用来验证北京 0 点恢复。
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-free-print-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-free-print-terminal-action-secret-0123456789'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-free-print-file-signing-secret-0123456789abcd'
process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-free-print-quota-secret-key-0123456789'
process.env['PAYMENT_SESSION_SECRET'] ||= 'verify-free-print-quota-payment-secret-0123456789'
process.env['ADMIN_IP_ALLOWLIST'] = ''
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['PRINT_REQUIRE_PII_SCAN'] = 'false'
process.env['PRINT_REQUIRE_PRINTER_ONLINE'] = 'false'
process.env['PRINT_SCAN_CAPABILITY_MODE'] = 'managed'
process.env['FILE_STORAGE_DRIVER'] = 'local'

import { BadRequestException, Module, ValidationPipe, type ValidationError } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { AuditService } from '../src/audit/audit.service'
import { quotaResetsAt } from '../src/ai/quota/ai-quota.policy'
import { memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { hashPickupCode } from '../src/common/pickup-code'
import { encryptPhone, hashPhone } from '../src/common/crypto/phone-identity'
import { encryptSecret } from '../src/common/crypto/secret-cipher'
import { signFileUrl } from '../src/files/signing'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PricingService } from '../src/payment/pricing.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { collectDerivedAlerts, resolveDerivedAlert } from '../src/admin-ops/derived-alerts'
import { ALERT_TYPES } from '../src/admin-ops/derived-alert-identity'
import { AdminPrintScanController } from '../src/admin-print-scan/admin-print-scan.controller'
import { AdminPrintScanService } from '../src/admin-print-scan/admin-print-scan.service'
import { PrintJobsController } from '../src/print-jobs/print-jobs.controller'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PickupOrderService } from '../src/print-jobs/pickup-order.service'
import {
  PRINT_GUEST_ORDER_QUOTA_EXCEEDED,
  PRINT_MEMBER_DAILY_QUOTA_REACHED,
  PRINT_TERMINAL_DAILY_QUOTA_REACHED,
  guestOrderQuotaMessage,
  memberDailyQuotaMessage,
  setFreePrintQuotaClock,
} from '../src/print-jobs/free-print-quota.policy'
import { AdminPrintFreeQuotaController, KioskPrintQuotaController } from '../src/print-jobs/free-print-quota.controller'
import { FreePrintQuotaService } from '../src/print-jobs/free-print-quota.service'
import { StorageService } from '../src/storage/storage.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { AdminTerminalsController } from '../src/terminals/admin-terminals.controller'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { TERMINAL_TOKEN_VALIDATOR, TerminalSessionService } from '../src/terminals/terminal-session.service'
import { TerminalAdminService } from '../src/terminals/terminals-admin.service'
import { TerminalsService } from '../src/terminals/terminals.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { buildRealPdf } from './support/minimal-pdf'

const API_ROOT = resolve(__dirname, '..')
const REPO_ROOT = resolve(API_ROOT, '../..')
const SHIBEI = 'term-shibei-02'
const LICANG = 'term-licang-01'
const LAOSHAN = 'term-laoshan-03'
const JIMO = 'term-jimo-06'
const DISABLED = 'term-huangdao-04'
const PLANNED = 'term-chengyang-05'
const SHIBEI_NAME = '市北区人才服务中心 2 号机'
const LICANG_NAME = '李沧区公共就业服务中心 1 号机'
const LAOSHAN_NAME = '崂山区人力资源市场 3 号机'
const JIMO_NAME = '即墨区公共就业服务中心 6 号机'
const MEMBER = 'eu-liu-siyuan'
const OTHER = 'eu-zhou-ning'
const ADMIN = 'user-zhou-heng'
const PARTNER = 'user-lin-xiaozhou'
const PHONE = '13812348016'
const PARAMS = {
  colorMode: 'black_white' as const,
  duplex: 'simplex' as const,
  paperSize: 'A4' as const,
  orientation: 'auto' as const,
  quality: 'standard' as const,
  scale: 'fit' as const,
  pagesPerSheet: 1 as const,
}
const LEAK = [LICANG_NAME, '李沧', '周宁', 'QD-LC-01', LICANG, JIMO_NAME, '即墨']

function flatten(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const error of errors) {
    const label = parent ? `${parent}.${error.property}` : error.property
    if (error.constraints) out.push(...Object.values(error.constraints).map((item) => `${label}: ${item}`))
    if (error.children?.length) out.push(...flatten(error.children, label))
  }
  return out
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function assertStatic(): void {
  const policy = read(join(API_ROOT, 'src/print-jobs/free-print-quota.policy.ts'))
  const usage = read(join(API_ROOT, 'src/print-jobs/free-print-quota.usage.ts'))
  const decide = read(join(API_ROOT, 'src/print-jobs/free-print-quota.decide.ts'))
  const alerts = read(join(API_ROOT, 'src/admin-ops/derived-alerts.ts'))
  const planned = read(join(API_ROOT, 'prisma/migrations/20260724200000_guard_planned_terminal_updates/migration.sql'))
  const retired = read(join(API_ROOT, 'prisma/migrations/20260726003000_guard_retired_terminal/migration.sql'))
  const sqliteMigration = read(join(API_ROOT, 'prisma/migrations/20261006120000_add_terminal_daily_free_print_sides/migration.sql'))
  const pgMigration = read(join(API_ROOT, 'prisma/postgres/migrations/20261006120000_add_terminal_daily_free_print_sides/migration.sql'))
  const ci = read(join(REPO_ROOT, '.github/workflows/ci.yml'))
  const progress = read(join(REPO_ROOT, 'docs/progress/current-progress.md'))
  const schema = read(join(API_ROOT, 'prisma/schema.prisma'))
  assert.equal(policy.includes('工作人员'), false)
  assert.equal(policy.includes('我的文档'), false)
  assert.ok(policy.includes('今天这台机器的免费打印量已用完，明天 0 点恢复。'))
  assert.ok(policy.includes('屏幕上的服务电话'))
  assert.equal(ALERT_TYPES.filter((type) => type === 'print_terminal_quota_high').length, 1)
  assert.equal((alerts.match(/collectPrintQuotaAlerts\(/g) ?? []).length, 1)
  assert.ok(alerts.includes("alert.type === 'print_terminal_quota_high'"))
  assert.ok(alerts.includes("type === 'print_terminal_quota_high'"))
  assert.ok(planned.includes('BEFORE UPDATE OF "agentToken", "lifecycleStatus", "credentialGeneration"'))
  assert.equal(planned.includes('dailyFreePrintSides'), false)
  assert.equal(retired.includes('dailyFreePrintSides'), false)
  assert.ok(retired.includes('NEW."agentToken" <> OLD."agentToken"'))
  assert.ok(sqliteMigration.includes('ADD COLUMN "dailyFreePrintSides" INTEGER'))
  assert.ok(pgMigration.includes('ADD COLUMN "dailyFreePrintSides" INTEGER'))
  assert.ok(schema.includes('dailyFreePrintSides Int?'))
  assert.equal(ci.split('verify:free-print-quota').length - 1, 1)
  const sqliteJob = ci.slice(ci.indexOf('Prepare fresh SQLite db'), ci.indexOf('postgres-readiness'))
  assert.ok(sqliteJob.includes('verify:free-print-quota'))
  // 默认值 10/6 已定；只钉数值与「可配」，不钉「待确认 / 已确认」这类会随时间变的措辞。
  assert.ok(/每台每天 300 面/.test(progress) && /每天 50 面/.test(progress) && /每单 20 面/.test(progress) && /80%/.test(progress))
  assert.ok(progress.includes('全部可配'))
  assert.ok(usage.includes('terminalInFlight'))
  assert.ok(decide.includes('if (input.payableCents > 0) return'))
  console.log('PASS 静态契约：文案、触发器不拦新列、告警只加一处调用、CI 只在 SQLite 作业')
}

function pushSchema(url: string): void {
  execFileSync(process.execPath, [
    join(API_ROOT, 'node_modules/prisma/build/index.js'),
    'db', 'push', '--url', url, '--accept-data-loss',
  ], { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' })
}

interface ErrorBody {
  code?: string
  message?: string
  details?: { limit: number; used: number; remaining: number; requested: number; resetAt: string }
}

interface CallResult {
  status: number
  json: { success?: boolean; data?: Record<string, unknown>; error?: ErrorBody; [key: string]: unknown }
}

function quotaDetails(result: CallResult): NonNullable<ErrorBody['details']> {
  const details = result.json.error?.details
  assert.ok(details && !Array.isArray(details))
  assert.deepEqual(Object.keys(details).sort(), ['limit', 'remaining', 'requested', 'resetAt', 'used'])
  const text = JSON.stringify(details)
  for (const hidden of LEAK) assert.equal(text.includes(hidden), false, hidden)
  assert.equal(text.includes('工作人员'), false)
  assert.equal(result.json.error?.message?.includes('工作人员'), false)
  assert.equal(result.json.error?.message?.includes('我的文档'), false)
  return details
}

async function main(): Promise<void> {
  assertStatic()
  const dir = mkdtempSync(join(tmpdir(), 'free-print-quota-'))
  const databasePath = join(dir, 'verify-free-print-quota.db')
  const databaseUrl = `file:${databasePath}`
  process.env['DATABASE_URL'] = databaseUrl
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  process.env['FILE_STORAGE_DIR'] = join(dir, 'files')
  assertIsolatedVerificationDatabase()
  // Prisma 7 的 schema engine 要求文件已存在；独占新临时目录，wx 防止覆盖。
  closeSync(openSync(databasePath, 'wx'))
  pushSchema(databaseUrl)
  execFileSync('sqlite3', [join(dir, 'verify-free-print-quota.db')], {
    input: read(join(API_ROOT, 'prisma/migrations/20260724200000_guard_planned_terminal_updates/migration.sql')),
  })
  execFileSync('sqlite3', [join(dir, 'verify-free-print-quota.db')], {
    input: read(join(API_ROOT, 'prisma/migrations/20260726003000_guard_retired_terminal/migration.sql')),
  })

  const store = new Map<string, string>()
  const redis = {
    async get(key: string) { return store.get(key) ?? null },
    async setEx(key: string, _ttl: number, value: string) { store.set(key, value) },
    async getDel(key: string) {
      const value = store.get(key) ?? null
      store.delete(key)
      return value
    },
    async setJsonIfVersionNotOlder() { return 'ok' as const },
    async incrWithTtl() { return 1 },
    async decrementFloorKeepTtl() { return 0 },
  }
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const storage = new StorageService()
  const capabilities = new TerminalCapabilitiesService(prisma)
  const printJobs = new PrintJobsService(
    prisma,
    audit,
    new PrintPageCountService(prisma, storage),
    new PricingService(prisma),
    new OrderStatusService(prisma, audit),
    capabilities,
  )
  const pickup = new PickupOrderService(prisma, capabilities, audit, redis as never, storage)
  const quota = new FreePrintQuotaService(prisma, audit)
  const jwt = new JwtService({ secret: 'verify-free-print-quota-jwt-secret' })
  const sessions = new TerminalSessionService(redis as never, prisma, { async validateTerminalToken() {} })
  const adminTerminals = new TerminalAdminService(prisma, {} as never, {} as never, { toAdminObservation: () => null } as never)
  const terminals = new TerminalsService({} as never, adminTerminals)

  @Module({
    controllers: [
      PrintJobsController,
      KioskPrintQuotaController,
      AdminPrintFreeQuotaController,
      AdminTerminalsController,
      AdminPrintScanController,
    ],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: redis },
      { provide: JwtService, useValue: jwt },
      { provide: AuditService, useValue: audit },
      { provide: PrintJobsService, useValue: printJobs },
      { provide: PickupOrderService, useValue: pickup },
      { provide: FreePrintQuotaService, useValue: quota },
      { provide: TerminalSessionService, useValue: sessions },
      { provide: TERMINAL_TOKEN_VALIDATOR, useValue: { async validateTerminalToken() {} } },
      { provide: TerminalCapabilitiesService, useValue: capabilities },
      { provide: TerminalsService, useValue: terminals },
      { provide: AdminPrintScanService, useValue: new AdminPrintScanService(prisma, audit) },
      TerminalIdentityGuard,
      JwtAuthGuard,
      RolesGuard,
    ],
  })
  class FixtureModule {}
  Module({})(FixtureModule)

  const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false })
  try {
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const details = flatten(errors)
        return new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: details[0] ?? '请求参数校验失败', details } })
      },
    }))
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.listen(0, '127.0.0.1')
    const port = (app.getHttpServer().address() as AddressInfo).port
    const base = `http://127.0.0.1:${port}`
    const adminToken = jwt.sign({ sub: ADMIN, ver: 0 })
    const partnerToken = jwt.sign({ sub: PARTNER, ver: 0 })
    const memberToken = jwt.sign({ sub: MEMBER, jti: 'jti-liu-siyuan' }, { audience: 'enduser' })
    store.set(memberSessionKey('jti-liu-siyuan'), MEMBER)

    async function call(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<CallResult> {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...extra,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { status: response.status, json: await response.json() as CallResult['json'] }
    }

    function kioskHeaders(terminalId: string, authorization?: string): Record<string, string> {
      return {
        'x-terminal-id': terminalId,
        'x-terminal-session-token': `sess-${terminalId}`,
        ...(authorization ? { authorization: `Bearer ${authorization}` } : {}),
      }
    }

    const adminHeaders = { authorization: `Bearer ${adminToken}` }
    const pdf = buildRealPdf(1)
    const sha = createHash('sha256').update(pdf).digest('hex')
    await storage.putObject('print_source/2026-10-06/quota-kiosk.pdf', pdf, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await storage.putObject('print_doc/2026-10-06/quota-member.pdf', pdf, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await seedDevDefaultPriceConfig(prisma)
    await prisma.priceConfig.update({ where: { serviceKey: 'print_bw_page' }, data: { unitCents: 0 } })
    await prisma.organization.create({ data: { id: 'org-shibei', name: '市北区人才服务中心', type: 'public_service' } })
    await prisma.user.create({ data: { id: ADMIN, username: 'zhou-heng', passwordHash: 'not-used', name: '周衡', role: 'admin' } })
    await prisma.user.create({ data: { id: PARTNER, username: 'lin-xiaozhou', passwordHash: 'not-used', name: '林晓舟', role: 'partner', orgId: 'org-shibei' } })
    await prisma.endUser.create({ data: { id: MEMBER, phoneHash: hashPhone(PHONE), phoneEnc: encryptPhone(PHONE), nickname: '刘思远' } })
    await prisma.endUser.create({ data: { id: OTHER, phoneHash: hashPhone('13912348016'), phoneEnc: encryptPhone('13912348016'), nickname: '周宁' } })
    await prisma.fileObject.create({ data: { id: 'file-kiosk', storageKey: 'print_source/2026-10-06/quota-kiosk.pdf', filename: '求职登记表.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length, sha256: sha, purpose: 'print_source', bucket: LOCAL_BUCKET_SENTINEL } })
    await prisma.fileObject.create({ data: { id: 'file-member', storageKey: 'print_doc/2026-10-06/quota-member.pdf', filename: '刘思远的简历.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length, sha256: sha, purpose: 'print_doc', bucket: LOCAL_BUCKET_SENTINEL, endUserId: MEMBER } })

    async function terminal(id: string, code: string, name: string, extra: Record<string, unknown> = {}) {
      await prisma.terminal.create({
        data: {
          id,
          terminalCode: code,
          displayName: name,
          agentToken: `agent-${id}`,
          deviceFingerprint: `fp-${id}`,
          credentialGeneration: 0,
          ...extra,
        },
      })
      if (extra['enabled'] !== false && extra['lifecycleStatus'] !== 'planned') {
        store.set(`term:session:sess-${id}`, JSON.stringify({ terminalId: id, generation: 0, issuedAt: new Date().toISOString() }))
        await prisma.terminalHeartbeat.create({
          data: { terminalId: id, status: 'online', printerStatus: 'idle', localTaskDatabaseAvailable: true, agentVersion: '0.4.13', createdAt: new Date() },
        })
      }
    }

    await terminal(SHIBEI, 'QD-SB-02', SHIBEI_NAME, { orgId: 'org-shibei' })
    await terminal(LICANG, 'QD-LC-01', LICANG_NAME)
    await terminal(LAOSHAN, 'QD-LS-03', LAOSHAN_NAME)
    await terminal(JIMO, 'QD-JM-06', JIMO_NAME)
    await terminal(DISABLED, 'QD-HD-04', '黄岛区就业服务站 4 号机', { enabled: false })
    await terminal(PLANNED, 'QD-CY-05', '城阳区人才市场 5 号机', { lifecycleStatus: 'planned', agentToken: 'planned$chengyang', enabled: true })
    const plannedUpdated = await prisma.terminal.update({ where: { id: PLANNED }, data: { dailyFreePrintSides: 9 } })
    assert.equal(plannedUpdated.dailyFreePrintSides, 9)
    console.log('PASS 计划中终端改 dailyFreePrintSides 不被触发器拦住')

    async function clearTasks(terminalId: string) {
      const tasks = await prisma.printTask.findMany({ where: { terminalId }, select: { id: true } })
      const ids = tasks.map((task) => task.id)
      if (ids.length > 0) {
        await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: ids } } })
      }
      await prisma.orderItem.deleteMany({ where: { order: { terminalId } } })
      await prisma.order.deleteMany({ where: { terminalId } })
      await prisma.printTask.deleteMany({ where: { terminalId } })
    }

    let seq = 0
    async function seedPaper(input: {
      terminalId: string
      sides: number
      status?: string
      errorCode?: string | null
      endUserId?: string | null
      completedAt?: Date | null
      createdAt?: Date
      withOrder?: boolean
      amountCents?: number
      discountCents?: number
      fileId?: string | null
    }): Promise<string> {
      seq += 1
      const id = `ptask-seed-${seq}`
      const at = input.createdAt ?? input.completedAt ?? new Date(Date.now() - seq * 60_000)
      const fileId = input.fileId === undefined ? 'file-kiosk' : input.fileId
      await prisma.printTask.create({
        data: {
          id,
          terminalId: input.terminalId,
          endUserId: input.endUserId ?? null,
          fileUrl: fileId ? signFileUrl(fileId, 30 * 60_000).url : 'https://files.invalid/quota',
          fileId,
          fileMd5: sha,
          paramsJson: JSON.stringify({ copies: 1 }),
          status: input.status ?? 'completed',
          errorCode: input.errorCode ?? null,
          completedAt: input.completedAt === undefined ? at : input.completedAt,
          createdAt: at,
        },
      })
      if (input.withOrder !== false) {
        await prisma.order.create({
          data: {
            id: `order-seed-${seq}`,
            orderNo: `Q${String(seq).padStart(6, '0')}`,
            printTaskId: id,
            terminalId: input.terminalId,
            endUserId: input.endUserId ?? null,
            amountCents: input.amountCents ?? 0,
            discountCents: input.discountCents ?? 0,
            payStatus: 'paid',
            paymentSource: (input.amountCents ?? 0) - (input.discountCents ?? 0) > 0 ? 'offline' : 'free',
            billablePages: input.sides,
            printParamsJson: JSON.stringify({ copies: 1 }),
            taskStatus: input.status ?? 'completed',
            channel: 'kiosk',
            sourceFileId: fileId,
            sourceFileSha256: sha,
          },
        })
      }
      return id
    }

    async function createJob(terminalId: string, copies: number, authorization?: string) {
      const signed = signFileUrl('file-kiosk', 30 * 60_000)
      return call('POST', '/api/v1/print/jobs', {
        fileUrl: signed.url,
        fileName: '求职登记表.pdf',
        params: { ...PARAMS, copies },
      }, kioskHeaders(terminalId, authorization))
    }

    const missing = await call('GET', '/api/v1/kiosk/print-quota')
    assert.equal(missing.status, 401)
    const guestView = await call('GET', '/api/v1/kiosk/print-quota', undefined, kioskHeaders(SHIBEI))
    assert.equal(guestView.status, 200)
    const guestData = guestView.json.data as { terminal: { limit: number }; member: null; guestPerOrderLimit: number; resetAt: string }
    assert.equal(guestData.member, null)
    assert.equal(guestData.terminal.limit, 300)
    assert.equal(guestData.guestPerOrderLimit, 20)
    assert.equal(guestData.resetAt, quotaResetsAt(new Date()))
    console.log('PASS 游客余量：会员为 null，缺省 300/20，没会话 401')

    const invalidQuota = await call('PUT', '/api/v1/admin/print-free-quota', {
      terminalDailySides: 0, memberDailySides: 5, guestPerOrderSides: 3, alertPercent: 80,
    }, adminHeaders)
    assert.equal(invalidQuota.status, 400)
    const partnerQuota = await call('PUT', '/api/v1/admin/print-free-quota', {
      terminalDailySides: 10, memberDailySides: 5, guestPerOrderSides: 3, alertPercent: 80,
    }, { authorization: `Bearer ${partnerToken}` })
    assert.equal(partnerQuota.status, 403)
    const savedQuota = await call('PUT', '/api/v1/admin/print-free-quota', {
      terminalDailySides: 10, memberDailySides: 5, guestPerOrderSides: 3, alertPercent: 80,
    }, adminHeaders)
    assert.equal(savedQuota.status, 200)
    assert.equal(await prisma.auditLog.count({ where: { action: 'print_free_quota.update' } }), 1)
    console.log('PASS 全局配置：0 被拒，合作机构 403，管理员写入并审计')

    const badOverride = await call('PUT', `/api/v1/admin/terminals/${SHIBEI}/capabilities/document_print`, {
      status: 'available', dailyFreePrintSides: 0,
    }, adminHeaders)
    assert.equal(badOverride.status, 400)
    const override = await call('PUT', `/api/v1/admin/terminals/${SHIBEI}/capabilities/document_print`, {
      status: 'available', dailyFreePrintSides: 10,
    }, adminHeaders)
    assert.equal(override.status, 200)
    assert.equal((override.json.data as { dailyFreePrintSides: number }).dailyFreePrintSides, 10)
    assert.equal(await prisma.auditLog.count({ where: { action: 'terminal.daily_free_print_sides.update' } }), 1)
    const cleared = await call('PUT', `/api/v1/admin/terminals/${SHIBEI}/capabilities/document_print`, {
      status: 'available', dailyFreePrintSides: null,
    }, adminHeaders)
    assert.equal((cleared.json.data as { dailyFreePrintSides: number | null }).dailyFreePrintSides, null)
    console.log('PASS 单台覆盖：越界 400，10 与 null 都落审计')

    await seedPaper({ terminalId: JIMO, sides: 40, completedAt: new Date(Date.now() - 3 * 3600_000) })
    const isolated = await call('GET', '/api/v1/kiosk/print-quota', undefined, kioskHeaders(SHIBEI))
    assert.equal((isolated.json.data as { terminal: { used: number } }).terminal.used, 0)
    console.log('PASS 余量按本机过滤，不算即墨那 40 面')

    const guestDenied = await createJob(SHIBEI, 4)
    assert.equal(guestDenied.status, 429)
    assert.equal(guestDenied.json.error?.code, PRINT_GUEST_ORDER_QUOTA_EXCEEDED)
    assert.equal(guestDenied.json.error?.message, guestOrderQuotaMessage(3))
    const guestBits = quotaDetails(guestDenied)
    assert.deepEqual(
      { limit: guestBits.limit, used: guestBits.used, remaining: guestBits.remaining, requested: guestBits.requested },
      { limit: 3, used: 0, remaining: 3, requested: 4 },
    )
    console.log('PASS 免登录每单超限')

    await call('PUT', `/api/v1/admin/terminals/${SHIBEI}/capabilities/document_print`, {
      status: 'available', dailyFreePrintSides: 2,
    }, adminHeaders)
    const first = await createJob(SHIBEI, 1)
    const second = await createJob(SHIBEI, 1)
    assert.equal(first.status, 201, JSON.stringify(first.json))
    assert.equal(second.status, 201, JSON.stringify(second.json))
    const third = await createJob(SHIBEI, 1)
    assert.equal(third.status, 429)
    assert.equal(third.json.error?.code, PRINT_TERMINAL_DAILY_QUOTA_REACHED)
    assert.equal(third.json.error?.message, '今天这台机器的免费打印量已用完，明天 0 点恢复。')
    const terminalBits = quotaDetails(third)
    assert.equal(terminalBits.used, 0)
    assert.equal(terminalBits.remaining, 0)
    assert.equal(terminalBits.requested, 1)
    const whilePending = await call('GET', '/api/v1/kiosk/print-quota', undefined, kioskHeaders(SHIBEI))
    const pendingView = whilePending.json.data as { terminal: { used: number; remaining: number } }
    assert.equal(pendingView.terminal.used, 0)
    assert.equal(pendingView.terminal.remaining, 0)
    console.log('PASS 两单在途时第三单被拒，used 仍只算已出纸')

    await clearTasks(SHIBEI)
    await seedPaper({ terminalId: LICANG, sides: 5, endUserId: MEMBER, completedAt: new Date(Date.now() - 2 * 3600_000), fileId: 'file-member' })
    await seedPaper({ terminalId: LICANG, sides: 9, endUserId: OTHER, completedAt: new Date(Date.now() - 90 * 60_000) })
    await call('PUT', `/api/v1/admin/terminals/${SHIBEI}/capabilities/document_print`, {
      status: 'available', dailyFreePrintSides: null,
    }, adminHeaders)
    const memberView = await call('GET', '/api/v1/kiosk/print-quota', undefined, kioskHeaders(SHIBEI, memberToken))
    const memberData = memberView.json.data as { member: { used: number; limit: number; remaining: number } }
    assert.equal(memberData.member.used, 5)
    assert.equal(memberData.member.limit, 5)
    assert.equal(memberData.member.remaining, 0)
    const memberDenied = await createJob(SHIBEI, 1, memberToken)
    assert.equal(memberDenied.status, 429)
    assert.equal(memberDenied.json.error?.code, PRINT_MEMBER_DAILY_QUOTA_REACHED)
    assert.equal(memberDenied.json.error?.message, memberDailyQuotaMessage(5))
    const memberBits = quotaDetails(memberDenied)
    assert.equal(memberBits.used, 5)
    assert.equal(memberBits.limit, 5)
    console.log('PASS 会员跨机器累计，不含周宁的用量，响应不带别的网点')

    await clearTasks(SHIBEI)
    await seedPaper({ terminalId: SHIBEI, sides: 6, status: 'failed', errorCode: 'PRINT_SPOOL_FAILED', completedAt: new Date(Date.now() - 50 * 60_000) })
    await seedPaper({ terminalId: SHIBEI, sides: 4, status: 'completed', errorCode: 'PRINT_JOB_UNCONFIRMED', completedAt: new Date(Date.now() - 40 * 60_000) })
    await seedPaper({ terminalId: SHIBEI, sides: 8, status: 'completed', withOrder: false, completedAt: new Date(Date.now() - 35 * 60_000), fileId: null })
    const ignored = await call('GET', '/api/v1/kiosk/print-quota', undefined, kioskHeaders(SHIBEI))
    assert.equal((ignored.json.data as { terminal: { used: number } }).terminal.used, 0)
    console.log('PASS 失败、未确认、没有订单行的任务不计面数')

    await prisma.terminal.update({ where: { id: LAOSHAN }, data: { dailyFreePrintSides: 10 } })
    await seedPaper({ terminalId: LAOSHAN, sides: 8, completedAt: new Date(Date.now() - 4 * 3600_000) })
    await seedPaper({ terminalId: DISABLED, sides: 100, completedAt: new Date() })
    await seedPaper({ terminalId: PLANNED, sides: 100, completedAt: new Date(), fileId: null, withOrder: true })
    await clearTasks(JIMO)
    await seedPaper({ terminalId: JIMO, sides: 30, status: 'pending', completedAt: null, createdAt: new Date() })
    let collected = await collectDerivedAlerts(prisma, new Date())
    let laoshanAlert = collected.alerts.find((item) => item.type === 'print_terminal_quota_high' && item.subjectId === LAOSHAN)
    assert.equal(laoshanAlert?.severity, 'warning')
    assert.equal(laoshanAlert?.title, `终端 ${LAOSHAN_NAME} 今日免费打印量已达 8 / 10 面`)
    assert.equal(laoshanAlert?.episodeToken, new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10))
    assert.equal(collected.alerts.some((item) => item.type === 'print_terminal_quota_high' && (item.subjectId === DISABLED || item.subjectId === PLANNED || item.subjectId === JIMO)), false)
    assert.ok(collected.firingTotal >= collected.alerts.filter((item) => item.type === 'print_terminal_quota_high').length)
    await prisma.order.updateMany({ where: { terminalId: LAOSHAN }, data: { billablePages: 10 } })
    collected = await collectDerivedAlerts(prisma, new Date())
    laoshanAlert = collected.alerts.find((item) => item.type === 'print_terminal_quota_high' && item.subjectId === LAOSHAN)
    assert.equal(laoshanAlert?.severity, 'error')
    const resolved = await resolveDerivedAlert(prisma, 'print_terminal_quota_high', LAOSHAN, new Date())
    assert.equal(resolved?.severity, 'error')
    await prisma.order.updateMany({ where: { terminalId: LAOSHAN }, data: { billablePages: 7 } })
    collected = await collectDerivedAlerts(prisma, new Date())
    assert.equal(collected.alerts.some((item) => item.type === 'print_terminal_quota_high' && item.subjectId === LAOSHAN), false)
    assert.equal(await resolveDerivedAlert(prisma, 'print_terminal_quota_high', LAOSHAN, new Date()), null)
    console.log('PASS 告警：8/10 warning，10/10 error，7/10、停用、计划中、只在途都不报')

    const listed = await call('GET', '/api/v1/admin/terminals', undefined, adminHeaders)
    assert.equal(listed.status, 200)
    const rows = (listed.json.data as { terminals: Array<{ id: string; todayFreePrintSides: number }> }).terminals
    assert.equal(rows.find((row) => row.id === LAOSHAN)?.todayFreePrintSides, 7)
    assert.equal(rows.find((row) => row.id === SHIBEI)?.todayFreePrintSides, 0)
    console.log('PASS 终端列表带今天已出纸免费面数')

    await clearTasks(SHIBEI)
    await prisma.terminal.update({ where: { id: SHIBEI }, data: { dailyFreePrintSides: 2 } })
    await seedPaper({ terminalId: SHIBEI, sides: 2, completedAt: new Date(Date.now() - 20 * 60_000) })
    await prisma.priceConfig.update({ where: { serviceKey: 'print_bw_page' }, data: { unitCents: 20 } })
    const paid = await createJob(SHIBEI, 1)
    assert.equal(paid.status, 201, JSON.stringify(paid.json))
    assert.equal((paid.json as { amountCents?: number }).amountCents, 20)
    await prisma.priceConfig.update({ where: { serviceKey: 'print_bw_page' }, data: { unitCents: 0 } })
    console.log('PASS 实付大于 0 不受免费额度限制')

    async function claim(terminalId: string, code: string) {
      return call('POST', '/api/v1/print/jobs/claim-pickup', { code }, kioskHeaders(terminalId))
    }

    async function phoneOrder(input: {
      code: string
      sides: number
      amountCents: number
      discountCents: number
      endUserId?: string | null
      fileId?: string
      pickupStatus?: string
      taskStatus?: string
      taskId?: string
      taskState?: string
      errorCode?: string | null
    }) {
      seq += 1
      const fileId = input.fileId ?? (input.endUserId ? 'file-member' : 'file-kiosk')
      const taskId = input.taskId
      if (taskId) {
        await prisma.printTask.create({
          data: {
            id: taskId,
            terminalId: SHIBEI,
            endUserId: input.endUserId ?? null,
            fileUrl: signFileUrl(fileId, 30 * 60_000).url,
            fileId,
            fileMd5: sha,
            paramsJson: JSON.stringify({ copies: 1 }),
            status: input.taskState ?? 'failed',
            errorCode: input.errorCode ?? 'PRINT_SPOOL_FAILED',
            createdAt: new Date(),
          },
        })
      }
      await prisma.order.create({
        data: {
          id: `order-phone-${seq}`,
          orderNo: `P${String(seq).padStart(6, '0')}`,
          terminalId: SHIBEI,
          endUserId: input.endUserId ?? null,
          amountCents: input.amountCents,
          discountCents: input.discountCents,
          payStatus: 'paid',
          paymentSource: input.amountCents - input.discountCents > 0 ? 'offline' : 'free',
          paidAt: new Date(),
          billablePages: input.sides,
          printParamsJson: JSON.stringify({ copies: 1 }),
          taskStatus: input.taskStatus ?? 'pending',
          channel: 'miniapp_cloud',
          pickupStatus: input.pickupStatus ?? 'pending',
          pickupCodeHash: hashPickupCode(input.code),
          pickupCodeEnc: encryptSecret(input.code),
          pickupCodeCreatedAt: new Date(),
          pickupCodeExpiresAt: new Date(Date.now() + 24 * 3600_000),
          sourceFileId: fileId,
          sourceFileSha256: sha,
          sourceFileName: '求职登记表.pdf',
          printTaskId: taskId,
        },
      })
    }

    await phoneOrder({ code: '48291637', sides: 3, amountCents: 0, discountCents: 0 })
    const shared = await claim(SHIBEI, '48291637')
    assert.equal(shared.status, 429, JSON.stringify(shared.json))
    assert.equal(shared.json.error?.code, PRINT_TERMINAL_DAILY_QUOTA_REACHED, JSON.stringify(shared.json))
    // 额度拒绝必须发生在认领之前：订单仍是待领取、没挂任务，明天同一个码还能直接领。
    const sharedOrder = await prisma.order.findFirst({
      where: { pickupCodeHash: hashPickupCode('48291637') },
      select: { pickupStatus: true, pickupClaimedAt: true, printTaskId: true },
    })
    assert.equal(sharedOrder?.pickupStatus, 'pending', JSON.stringify(sharedOrder))
    assert.equal(sharedOrder?.pickupClaimedAt, null, JSON.stringify(sharedOrder))
    console.log('PASS 额度拒绝时到机码不被认领')
    await phoneOrder({ code: '59102846', sides: 2, amountCents: 100, discountCents: 100 })
    const discounted = await claim(SHIBEI, '59102846')
    assert.equal(discounted.status, 429, JSON.stringify(discounted.json))
    assert.equal(discounted.json.error?.code, PRINT_TERMINAL_DAILY_QUOTA_REACHED)
    await phoneOrder({ code: '60394815', sides: 3, amountCents: 60, discountCents: 0 })
    const paidClaim = await claim(SHIBEI, '60394815')
    assert.notEqual(paidClaim.status, 429, JSON.stringify(paidClaim.json))
    assert.equal(paidClaim.status, 200, JSON.stringify(paidClaim.json))
    console.log('PASS 手机免费单与现场共用本机额度；全额抵扣仍受限；实付大于 0 可以到机')

    const retryTask = 'ptask-member-retry'
    await phoneOrder({
      code: '71405926',
      sides: 1,
      amountCents: 0,
      discountCents: 0,
      endUserId: MEMBER,
      fileId: 'file-member',
      pickupStatus: 'used',
      taskStatus: 'failed',
      taskId: retryTask,
    })
    const retried = await call('POST', `/api/v1/print/jobs/${retryTask}/retry`, undefined, kioskHeaders(SHIBEI, memberToken))
    assert.equal(retried.status, 429, JSON.stringify(retried.json))
    assert.equal(retried.json.error?.code, PRINT_TERMINAL_DAILY_QUOTA_REACHED)
    const adminTask = 'ptask-admin-retry'
    await phoneOrder({
      code: '82516037',
      sides: 1,
      amountCents: 0,
      discountCents: 0,
      pickupStatus: 'used',
      taskStatus: 'failed',
      taskId: adminTask,
    })
    const adminRetry = await call('POST', `/api/v1/admin/print-scan/tasks/print/${adminTask}/actions`, { action: 'retry' }, adminHeaders)
    assert.notEqual(adminRetry.status, 429, JSON.stringify(adminRetry.json))
    assert.equal((adminRetry.json.data as { toStatus?: string })?.toStatus, 'pending')
    await phoneOrder({
      code: '93627148',
      sides: 1,
      amountCents: 0,
      discountCents: 0,
      pickupStatus: 'used',
      taskStatus: 'failed',
      taskId: 'ptask-resume',
    })
    const resumed = await claim(SHIBEI, '93627148')
    assert.equal(resumed.status, 429, JSON.stringify(resumed.json))
    assert.equal(resumed.json.error?.code, PRINT_TERMINAL_DAILY_QUOTA_REACHED)
    await phoneOrder({
      code: '14738259',
      sides: 1,
      amountCents: 0,
      discountCents: 0,
      pickupStatus: 'used',
      taskStatus: 'printing',
      taskId: 'ptask-printing',
      taskState: 'printing',
      errorCode: null,
    })
    const replay = await claim(SHIBEI, '14738259')
    assert.equal(replay.status, 200, JSON.stringify(replay.json))
    console.log('PASS 续打和 /retry 被拦，管理员重试不拦，出纸中的单仍回放')

    await clearTasks(SHIBEI)
    await seedPaper({
      terminalId: SHIBEI,
      sides: 9,
      completedAt: new Date('2026-10-06T06:00:00.000Z'),
      createdAt: new Date('2026-10-06T06:00:00.000Z'),
    })
    setFreePrintQuotaClock(() => new Date('2026-10-06T16:01:00.000Z'))
    const restored = await createJob(SHIBEI, 1)
    assert.equal(restored.status, 201, JSON.stringify(restored.json))
    setFreePrintQuotaClock(null)
    console.log('PASS 跨过北京 0 点后额度恢复')
    console.log('PASS verify:free-print-quota')
  } finally {
    setFreePrintQuotaClock(null)
    await app.close().catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
