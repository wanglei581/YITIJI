/**
 * verify:service-orders 与 verify:service-orders-concurrency 共用的临时库和 Nest 夹具。
 * 用例不在这里。两个入口各自设好环境变量后再 import。
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { BadRequestException, HttpException, HttpStatus, Module, NotFoundException, ValidationPipe, type ValidationError } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { AuditService } from '../../src/audit/audit.service'
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter'
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../../src/common/guards/roles.guard'
import { RedisService } from '../../src/common/redis/redis.service'
import { installBodyParsers } from '../../src/config/body-parsers'
import { PrismaService } from '../../src/prisma/prisma.service'
import { TerminalIdentityGuard } from '../../src/terminals/terminal-identity.guard'
import { TERMINAL_TOKEN_VALIDATOR, TerminalSessionService } from '../../src/terminals/terminal-session.service'
import { setTerminalUserPrintPrices } from './terminal-charge-fixture'
import { TripCoverService } from '../../src/payment/trip-cover.service'
import { OnlinePaymentService } from '../../src/payment/online-payment.service'
import { OrderStatusService } from '../../src/payment/order-status.service'
import { PaymentController } from '../../src/payment/payment.controller'
import { resolvePaymentProviders, type PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import { buildPaymentCallbackPath, type RefundExecuteInput } from '../../src/payment/payment-provider.types'
import { SandboxPaymentProvider } from '../../src/payment/providers/sandbox-payment.provider'
import { PricingService } from '../../src/payment/pricing.service'
import { RefundService } from '../../src/payment/refund.service'
import { ServiceOrderAdminController } from '../../src/payment/service-order-admin.controller'
import { ServiceOrderController } from '../../src/payment/service-order.controller'
import { ServiceOrderService } from '../../src/payment/service-order.service'
import { AdminOrdersReadonlyController } from '../../src/admin-orders-readonly/admin-orders-readonly.controller'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
import { AiController } from '../../src/ai/ai.controller'
import { AiLogService } from '../../src/ai/ai-log.service'
import { AiService } from '../../src/ai/ai.service'
import { AsrService } from '../../src/asr/asr.service'
import { BenefitRedemptionService } from '../../src/benefit-redemption/benefit-redemption.service'
import { AiPublicQuotaService } from '../../src/ai/ai-public-quota.service'
import { JobFitController } from '../../src/ai/job-fit.controller'
import { ResumeLayoutAdjustController } from '../../src/ai/resume-layout-adjust.controller'
import { JobFitService } from '../../src/ai/resume/job-fit.service'
import { MemberPrivacyService } from '../../src/member-privacy/member-privacy.service'
import { AssistantSummaryService } from '../../src/advisor/assistant-summary.service'
import { ResumeDraftSourceService } from '../../src/ai/resume/resume-draft-source.service'
import { GovernedJobFitService } from '../../src/job-ai/governed-job-fit.service'
import { JobAiQuotaService } from '../../src/job-ai/job-ai-quota.service'
import { JobContextService } from '../../src/job-ai/job-context.service'
import { KioskJobBoardService } from '../../src/terminals/kiosk-job-board.service'
import { KioskSessionController } from '../../src/kiosk-session/kiosk-session.controller'
import { KioskSessionService } from '../../src/kiosk-session/kiosk-session.service'
import { MockInterviewController } from '../../src/mock-interview/mock-interview.controller'
import { MockInterviewService } from '../../src/mock-interview/mock-interview.service'
import { InterviewTranscriptPrintService } from '../../src/mock-interview/interview-transcript-print.service'
import { TtsService } from '../../src/mock-interview/asr/tts.service'
import { ScanTasksService } from '../../src/scan-tasks/scan-tasks.service'
import { assertIsolatedVerificationDatabase } from './isolated-verification-database'

const API_ROOT = resolve(__dirname, '../..')
export const ADMIN = 'svc-order-admin'
export const MEMBER = 'svc-order-member'
const MEMBER_JTI = 'svc-order-member-jti-01'
export const ORG_PUBLIC = 'org-svc-public'
export const ORG_SCHOOL = 'org-svc-school'
export const TERM_CHARGE = 'term-svc-charge'
export const TERM_PUBLIC = 'term-svc-public'
export const TERM_ORG = 'term-svc-org'
export const TERM_FREE = 'term-svc-free'

export const DEMO_PRICES = { resume_optimize: 100, mock_interview: 200, scan: 100, print_bw_page: 0, print_color_page: 0 }

function flatten(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const error of errors) {
    const label = parent ? `${parent}.${error.property}` : error.property
    if (error.constraints) out.push(...Object.values(error.constraints).map((item) => `${label}: ${item}`))
    if (error.children?.length) out.push(...flatten(error.children, label))
  }
  return out
}

function pushSchema(url: string): void {
  execFileSync(process.execPath, [
    join(API_ROOT, 'node_modules/prisma/build/index.js'),
    'db', 'push', '--url', url, '--accept-data-loss',
  ], { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' })
}

/** db push 不会建 schema 表达不了的部分唯一索引。索引只从迁移里取，迁移删了这里就不再建。 */
export function applyOpenRefIndex(databasePath: string): void {
  const sql = readFileSync(join(API_ROOT, 'prisma/migrations/20261114170000_service_order_open_ref/migration.sql'), 'utf8')
  const match = sql.match(/CREATE UNIQUE INDEX "ServiceOrder_open_consumed_ref_key"[\s\S]*?;/)
  if (!match) return
  execFileSync('sqlite3', [databasePath], { input: match[0], encoding: 'utf8' })
}

export interface CallResult {
  status: number
  json: {
    success?: boolean
    data?: Record<string, unknown>
    error?: { code?: string; message?: string; amountCents?: number; serviceKey?: string; serviceName?: string; consumedRef?: string; existingOrderId?: string }
    items?: Array<Record<string, unknown>>
    pagination?: { total?: number }
    ok?: boolean
    idempotent?: boolean
    [key: string]: unknown
  }
}

export function pass(label: string): void {
  console.log(`PASS ${label}`)
}

export interface ServiceOrderFixture {
  prisma: PrismaService
  audit: AuditService
  registry: PaymentProviderRegistry
  redis: object
  serviceOrders: ServiceOrderService
  base: string
  adminToken: string
  memberToken: string
  adminHeaders: { authorization: string }
  chargeToken: string
  publicToken: string
  orgToken: string
  freeToken: string
  chargeSession: string
  publicSession: string
  orgSession: string
  freeSession: string
  databasePath: string
  ai: {
    getResumeOptimize: (...args: never[]) => Promise<{ taskId: string; status: string }>
    adjustResumeLayout: () => Promise<never>
    getProviderName: () => string
  }
  interview: {
    hasInterviewerTurn: (id: string) => Promise<boolean>
    start: (id: string) => Promise<{ id: string; status: string }>
    answer: () => Promise<{ ok: boolean }>
    createSession: () => Promise<{ id: string }>
  }
  scans: {
    previewCreate: () => Promise<{ scanTaskId: string; controlToken: string; expiresAt: string; instructions: string[] }>
    create: () => Promise<{ scanTaskId: string; controlToken: string; expiresAt: string; instructions: string[] }>
  }
  openedInterviews: Set<string>
  sandbox: SandboxPaymentProvider
  call: (method: string, path: string, body?: unknown, extra?: Record<string, string>) => Promise<CallResult>
  expectStatus: (result: CallResult, status: number, label: string) => void
  termHeaders: (terminalId: string, token: string, kioskSessionId?: string, orderId?: string) => Record<string, string>
  openKiosk: (terminalId: string, token: string, category?: string) => Promise<string>
  endKiosk: (terminalId: string, token: string, clientSessionId: string) => Promise<CallResult>
  postCallback: (packed: { rawBody: Buffer; headers: Record<string, string> }) => Promise<CallResult>
  packCallback: (
    row: { id: string; providerOrderNo: string; prepayId: string | null; amountCents: number },
    result: 'success' | 'failed',
    channelTxnNo?: string,
  ) => { rawBody: Buffer; headers: Record<string, string> }
  callback: (
    row: { id: string; providerOrderNo: string; prepayId: string | null; amountCents: number },
    result: 'success' | 'failed',
    channelTxnNo?: string,
  ) => Promise<CallResult>
  loadOrder: (id: string) => Promise<{
    id: string
    status: string
    amountCents: number
    providerOrderNo: string
    prepayId: string | null
    attemptsUsed: number
    consumedRef: string | null
    consumedAt: Date | null
    refundedAt: Date | null
    refundReason: string | null
    refundAttempts: number
    refundNo: string | null
    refundAnomaly: string | null
    settledAt: Date | null
    closeReason: string | null
    channelClosePending: boolean
    channelTxnNo: string | null
    failureReason: string | null
    retryUntil: Date | null
    paymentFailed: boolean
  }>
  paidOrder: (
    kioskSessionId: string,
    serviceKey: 'resume_optimize' | 'mock_interview' | 'scan',
    txn: string,
  ) => Promise<{ id: string; providerOrderNo: string; prepayId: string | null; amountCents: number }>
  applyOpenRefIndex: (databasePath: string) => void
  refundMode: 'ok' | 'throw' | 'processing'
  queryMode: 'success' | 'failed' | 'processing'
  refundCalls: number
  queryRefundCalls: number
  optimizeMode: 'ok' | 'fail' | 'end-then-fail'
  optimizeCalls: number
  interviewMode: 'ok' | 'throw' | 'already'
  scanMode: 'ok' | 'throw'
  scanReturnId: string
  scanCreates: number
  jobFitReserves: number
}

export async function withServiceOrderFixture(run: (fx: ServiceOrderFixture) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'service-orders-'))
  const databasePath = join(dir, 'verify-service-orders.db')
  const databaseUrl = `file:${databasePath}`
  process.env['DATABASE_URL'] = databaseUrl
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  assertIsolatedVerificationDatabase()
  closeSync(openSync(databasePath, 'wx'))
  pushSchema(databaseUrl)
  applyOpenRefIndex(databasePath)

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
    async setIfAbsent(key: string, value: string) {
      if (store.has(key)) return false
      store.set(key, value)
      return true
    },
    async del(key: string) {
      const had = store.delete(key)
      return had ? 1 : 0
    },
  }
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const sessions = new TerminalSessionService(redis as never, prisma, { async validateTerminalToken() {} })
  let refundMode: 'ok' | 'throw' | 'processing' = 'ok'
  let queryMode: 'success' | 'failed' | 'processing' = 'processing'
  let refundCalls = 0
  let queryRefundCalls = 0
  const registry = resolvePaymentProviders(process.env)
  const sandbox = registry.get('sandbox')
  assert.ok(sandbox instanceof SandboxPaymentProvider)
  const realGet = registry.get.bind(registry)
  registry.get = ((channel: string) => {
    const provider = realGet(channel)
    if (!provider) return provider
    return new Proxy(provider, {
      get(target, prop, receiver) {
        if (prop === 'refund') {
          return async (input: RefundExecuteInput) => {
            refundCalls += 1
            if (refundMode === 'throw') throw new Error('refund channel down')
            if (refundMode === 'processing') return { status: 'processing' as const, channelRefundNo: null }
            return target.refund(input)
          }
        }
        if (prop === 'queryRefund') {
          return async () => {
            queryRefundCalls += 1
            if (queryMode === 'success') return { status: 'success' as const, channelRefundNo: 'qry-ok', refundAmountCents: null }
            if (queryMode === 'failed') return { status: 'failed' as const, channelRefundNo: null }
            return { status: 'processing' as const, channelRefundNo: null }
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }) as PaymentProviderRegistry['get']

  const serviceOrders = new ServiceOrderService(prisma, audit, sessions, registry, redis as unknown as RedisService)
  const kioskSessions = new KioskSessionService(prisma, serviceOrders)
  const online = new OnlinePaymentService(prisma, audit, {} as OrderStatusService, registry, redis as unknown as RedisService)
  const jwt = new JwtService({ secret: 'verify-service-orders-jwt-secret' })

  let optimizeMode: 'ok' | 'fail' | 'end-then-fail' = 'ok'
  let optimizeCalls = 0
  const ai = {
    async getResumeOptimize(taskId: string, _requester: unknown, existingOnly?: boolean, _req?: unknown, beforeGenerate?: () => Promise<boolean>) {
      optimizeCalls += 1
      if (existingOnly) return { taskId, status: 'completed' }
      if (optimizeMode === 'end-then-fail' && beforeGenerate) {
        await beforeGenerate()
        return { taskId, status: 'failed' }
      }
      if (beforeGenerate) await beforeGenerate()
      if (optimizeMode === 'fail') return { taskId, status: 'failed' }
      return { taskId, status: 'completed' }
    },
    async adjustResumeLayout() {
      throw new BadRequestException({ error: { code: 'LAYOUT_FAILED', message: '排版失败' } })
    },
    getProviderName() { return 'rules' },
  }
  const privacy = { async requireActiveConsent() {} }
  const draftSource = { async tagOptimizeTerminal() {} }
  const openedInterviews = new Set<string>()
  let interviewMode: 'ok' | 'throw' | 'already' = 'ok'
  const interview = {
    async hasInterviewerTurn(id: string) { return openedInterviews.has(id) },
    async start(id: string) {
      if (interviewMode === 'throw') throw new Error('interview down')
      if (interviewMode === 'already') {
        throw new BadRequestException({ error: { code: 'INTERVIEW_ALREADY_STARTED', message: '本场练习已开始或已结束' } })
      }
      openedInterviews.add(id)
      return { id, status: 'started' }
    },
    async answer() { return { ok: true } },
    async createSession() { return { id: 'unused' } },
  }
  let scanMode: 'ok' | 'throw' = 'ok'
  let scanReturnId = 'scan-return'
  let scanCreates = 0
  const scans = {
    async previewCreate() {
      return { scanTaskId: scanReturnId, controlToken: '', expiresAt: '', instructions: [] as string[] }
    },
    async create() {
      if (scanMode === 'throw') throw new Error('scan down')
      scanCreates += 1
      return { scanTaskId: scanReturnId, controlToken: '', expiresAt: '', instructions: [] as string[] }
    },
  }
  let jobFitReserves = 0
  const memberQuota = {
    async reserve() {
      jobFitReserves += 1
      throw new HttpException({
        error: { code: 'AI_QUOTA_EXHAUSTED', message: '今天的 AI 次数用完了，明天 0 点恢复' },
      }, HttpStatus.TOO_MANY_REQUESTS)
    },
    async release() {},
    async commit() {},
  }
  const jobFit = {
    async authorizeParseForJobFit(taskId: string) {
      return { taskId, endUserId: MEMBER, accessTokenHash: null, expiresAt: new Date(Date.now() + 3600_000) }
    },
    async analyzeWithUsage(input: { taskId: string }) {
      return { provider: 'stub', response: { taskId: input.taskId, status: 'completed' as const, summary: '对照已生成' } }
    },
    async matchingStored() { return null },
    requireActiveAnonymousJobFitConsent() {},
  }
  const { ScanTasksController } = await import('../../src/scan-tasks/scan-tasks.controller')
  const { TerminalsService } = await import('../../src/terminals/terminals.service')
  const governed = new GovernedJobFitService(
    prisma,
    jobFit as unknown as JobFitService,
    {} as JobContextService,
    { record() {} } as unknown as AiLogService,
    privacy as unknown as MemberPrivacyService,
    { async consume() { return null }, async rollback() {} } as unknown as JobAiQuotaService,
    memberQuota as never,
  )

  @Module({
    controllers: [
      ServiceOrderController,
      ServiceOrderAdminController,
      PaymentController,
      KioskSessionController,
      AiController,
      MockInterviewController,
      ScanTasksController,
      JobFitController,
      ResumeLayoutAdjustController,
      AdminOrdersReadonlyController,
    ],
    providers: [
      { provide: PrismaService, useValue: prisma },
      { provide: RedisService, useValue: redis },
      { provide: JwtService, useValue: jwt },
      { provide: AuditService, useValue: audit },
      { provide: TerminalSessionService, useValue: sessions },
      { provide: TERMINAL_TOKEN_VALIDATOR, useValue: { async validateTerminalToken() {} } },
      { provide: ServiceOrderService, useValue: serviceOrders },
      { provide: TripCoverService, useValue: new TripCoverService(serviceOrders) },
      { provide: KioskSessionService, useValue: kioskSessions },
      { provide: OnlinePaymentService, useValue: online },
      { provide: PricingService, useValue: {} },
      { provide: RefundService, useValue: {} },
      { provide: AiService, useValue: ai },
      { provide: AiLogService, useValue: { record() {} } },
      { provide: AsrService, useValue: {} },
      { provide: TtsService, useValue: {} },
      { provide: BenefitRedemptionService, useValue: {} },
      { provide: AiPublicQuotaService, useValue: {} },
      { provide: MemberPrivacyService, useValue: privacy },
      { provide: AssistantSummaryService, useValue: {} },
      { provide: ResumeDraftSourceService, useValue: draftSource },
      { provide: MockInterviewService, useValue: interview },
      { provide: InterviewTranscriptPrintService, useValue: {} },
      { provide: ScanTasksService, useValue: scans },
      { provide: TerminalsService, useValue: {} },
      { provide: JobFitService, useValue: jobFit },
      { provide: GovernedJobFitService, useValue: governed },
      { provide: KioskJobBoardService, useValue: {} },
      { provide: AdminOrdersReadonlyService, useValue: {
        async list() { return { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 } } },
        async getById() { throw new NotFoundException({ error: { code: 'ORDER_NOT_FOUND', message: '没有这张订单' } }) },
      } },
      TerminalIdentityGuard,
      JwtAuthGuard,
      RolesGuard,
    ],
  })
  class FixtureModule {}
  Module({})(FixtureModule)

  const app = await NestFactory.create(FixtureModule, { logger: false, abortOnError: false, bodyParser: false })
  let failed = false
  try {
    installBodyParsers(app)
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
    const memberToken = jwt.sign({ sub: MEMBER, jti: MEMBER_JTI }, { audience: 'enduser', expiresIn: '1h' })
    store.set(`member:session:${MEMBER_JTI}`, MEMBER)
    const adminHeaders = { authorization: `Bearer ${adminToken}` }

    async function call(method: string, path: string, body?: unknown, extra?: Record<string, string>): Promise<CallResult> {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const json = await response.json() as CallResult['json']
      return { status: response.status, json }
    }

    function expectStatus(result: CallResult, status: number, label: string): void {
      assert.equal(result.status, status, `${label} → ${result.status} ${JSON.stringify(result.json)}`)
    }

    function termHeaders(terminalId: string, token: string, kioskSessionId?: string, orderId?: string): Record<string, string> {
      return {
        'x-terminal-id': terminalId,
        'x-terminal-session-token': token,
        ...(kioskSessionId ? { 'x-kiosk-session-id': kioskSessionId } : {}),
        ...(orderId ? { 'x-service-order-id': orderId } : {}),
      }
    }

    async function seedTerminal(id: string, code: string, orgId: string | null, locationLabel: string | null): Promise<string> {
      await prisma.terminal.create({
        data: { id, terminalCode: code, agentToken: `agent-${id}`, deviceFingerprint: `fp-${id}`, orgId, locationLabel },
      })
      const token = `tok-${id}`
      store.set(`term:session:${token}`, JSON.stringify({ terminalId: id, generation: 0, issuedAt: new Date().toISOString() }))
      return token
    }

    async function openKiosk(terminalId: string, token: string, category = 'resume'): Promise<string> {
      const clientSessionId = randomUUID()
      const started = await call('POST', '/api/v1/kiosk/session/start', {
        clientSessionId,
        wokeAt: new Date().toISOString(),
        category,
      }, termHeaders(terminalId, token))
      expectStatus(started, 200, '开会话')
      return clientSessionId
    }

    async function endKiosk(terminalId: string, token: string, clientSessionId: string): Promise<CallResult> {
      return call('POST', '/api/v1/kiosk/session/end', {
        clientSessionId,
        endedAt: new Date().toISOString(),
        endReason: 'user_exit',
      }, termHeaders(terminalId, token))
    }

    const callbackPath = buildPaymentCallbackPath('sandbox')
    async function postCallback(packed: { rawBody: Buffer; headers: Record<string, string> }): Promise<CallResult> {
      const response = await fetch(`${base}${callbackPath}`, { method: 'POST', headers: packed.headers, body: new Uint8Array(packed.rawBody) })
      const json = await response.json() as CallResult['json']
      return { status: response.status, json }
    }
    function packCallback(row: { id: string; providerOrderNo: string; prepayId: string | null; amountCents: number }, result: 'success' | 'failed', channelTxnNo?: string) {
      return sandbox.buildSimulatedCallback({
        path: callbackPath,
        attemptId: row.providerOrderNo,
        prepayId: row.prepayId ?? 'missing-prepay',
        orderId: row.id,
        amountCents: row.amountCents,
        result,
        ...(channelTxnNo ? { channelTxnNo } : {}),
      })
    }
    async function callback(row: { id: string; providerOrderNo: string; prepayId: string | null; amountCents: number }, result: 'success' | 'failed', channelTxnNo?: string): Promise<CallResult> {
      return postCallback(packCallback(row, result, channelTxnNo))
    }

    async function loadOrder(id: string) {
      const row = await prisma.serviceOrder.findUnique({ where: { id } })
      assert.ok(row, `找不到服务单 ${id}`)
      return row
    }

    await prisma.organization.create({ data: { id: ORG_PUBLIC, name: '市南区公共就业服务中心', type: 'public_employment_service' } })
    await prisma.organization.create({ data: { id: ORG_SCHOOL, name: '青岛大学', type: 'school' } })
    await prisma.user.create({ data: { id: ADMIN, username: 'svc-order-admin', passwordHash: 'not-used', name: '管理员', role: 'admin' } })
    await prisma.endUser.create({ data: { id: MEMBER, phoneHash: 'hash-svc-order-member', phoneEnc: 'enc', enabled: true, status: 'active' } })
    const chargeToken = await seedTerminal(TERM_CHARGE, 'ZYD-SN-01', null, '市南 · 香港中路')
    const publicToken = await seedTerminal(TERM_PUBLIC, 'ZYD-SB-02', ORG_PUBLIC, '市北 · 辽宁路')
    const orgToken = await seedTerminal(TERM_ORG, 'ZYD-LC-03', ORG_SCHOOL, '李沧 · 九水路')
    const freeToken = await seedTerminal(TERM_FREE, 'ZYD-HD-04', null, '黄岛 · 长江路')
    await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES)
    await setTerminalUserPrintPrices(prisma, TERM_PUBLIC, DEMO_PRICES)
    await setTerminalUserPrintPrices(prisma, TERM_FREE, { resume_optimize: 0, mock_interview: 0, scan: 0, print_bw_page: 0, print_color_page: 0 })
    await prisma.terminalServicePrice.create({ data: { terminalId: TERM_ORG, serviceKey: 'resume_optimize', unitCents: 100 } })

    const chargeSession = await openKiosk(TERM_CHARGE, chargeToken)
    const publicSession = await openKiosk(TERM_PUBLIC, publicToken)
    const orgSession = await openKiosk(TERM_ORG, orgToken)
    const freeSession = await openKiosk(TERM_FREE, freeToken)

    async function paidOrder(kioskSessionId: string, serviceKey: 'resume_optimize' | 'mock_interview' | 'scan', txn: string) {
      const made = await call('POST', '/api/v1/kiosk/service-orders', { serviceKey, kioskSessionId }, termHeaders(TERM_CHARGE, chargeToken))
      expectStatus(made, 200, `建单 ${serviceKey}`)
      const id = String(made.json.data?.['id'])
      const row = await loadOrder(id)
      expectStatus(await callback(row, 'success', txn), 200, `付款 ${txn}`)
      return row
    }

    const fx = {
      prisma,
      audit,
      registry,
      redis,
      serviceOrders,
      base,
      adminToken,
      memberToken,
      adminHeaders,
      chargeToken,
      publicToken,
      orgToken,
      freeToken,
      chargeSession,
      publicSession,
      orgSession,
      freeSession,
      databasePath,
      ai,
      interview,
      scans,
      openedInterviews,
      sandbox,
      call,
      expectStatus,
      termHeaders,
      openKiosk,
      endKiosk,
      postCallback,
      packCallback,
      callback,
      loadOrder,
      paidOrder,
      applyOpenRefIndex,
      get refundMode() { return refundMode },
      set refundMode(value: ServiceOrderFixture['refundMode']) { refundMode = value },
      get queryMode() { return queryMode },
      set queryMode(value: ServiceOrderFixture['queryMode']) { queryMode = value },
      get refundCalls() { return refundCalls },
      set refundCalls(value: number) { refundCalls = value },
      get queryRefundCalls() { return queryRefundCalls },
      set queryRefundCalls(value: number) { queryRefundCalls = value },
      get optimizeMode() { return optimizeMode },
      set optimizeMode(value: ServiceOrderFixture['optimizeMode']) { optimizeMode = value },
      get optimizeCalls() { return optimizeCalls },
      set optimizeCalls(value: number) { optimizeCalls = value },
      get interviewMode() { return interviewMode },
      set interviewMode(value: ServiceOrderFixture['interviewMode']) { interviewMode = value },
      get scanMode() { return scanMode },
      set scanMode(value: ServiceOrderFixture['scanMode']) { scanMode = value },
      get scanReturnId() { return scanReturnId },
      set scanReturnId(value: string) { scanReturnId = value },
      get scanCreates() { return scanCreates },
      set scanCreates(value: number) { scanCreates = value },
      get jobFitReserves() { return jobFitReserves },
      set jobFitReserves(value: number) { jobFitReserves = value },
    } as ServiceOrderFixture
    await run(fx)
  } catch (error) {
    failed = true
    console.error(error)
    throw error
  } finally {
    await app.close().catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true })
  }
}
