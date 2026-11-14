/**
 * 一体机按次付款：生效价大于 0 才建单，开始前占用，没做成退款，子调用不扣每日次数。
 * 临时 SQLite，真实 Nest HTTP。断言按收费口径写，不按当前实现迁就。
 *
 * 密钥必须写在任何 import 之前。swc 会把 import 提前。
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-service-orders-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-service-orders-terminal-action-secret-0123456789'
process.env['ADMIN_IP_ALLOWLIST'] = ''
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['NODE_ENV'] = 'test'
process.env['PAYMENT_PROVIDER'] = 'sandbox'
process.env['SANDBOX_PAYMENT_SECRET'] = 'verify-service-orders-sandbox-secret'
process.env['JWT_SECRET'] = 'verify-service-orders-jwt-secret-0123456789'

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
import { SERVICE_ORDER_KEYS as SHARED_KEYS, SERVICE_ORDER_NAMES as SHARED_NAMES } from '@ai-job-print/shared'
import { AuditService } from '../src/audit/audit.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { RedisService } from '../src/common/redis/redis.service'
import { installBodyParsers } from '../src/config/body-parsers'
import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { TERMINAL_TOKEN_VALIDATOR, TerminalSessionService } from '../src/terminals/terminal-session.service'
import { RedisInflightLock } from '../src/ai/redis-inflight-lock'
import { setTerminalUserPrintPrices } from './support/terminal-charge-fixture'
import { executeServiceOrderRefund, settleServiceRefundNotify } from '../src/payment/service-order.payment'
import { SERVICE_SWEEP_BATCH } from '../src/payment/service-order.policy'
import { RefundService } from '../src/payment/refund.service'
import type { RefundNotifyEvent } from '../src/payment/payment-provider.types'
import { collectDerivedAlerts } from '../src/admin-ops/derived-alerts'
import { isServiceOrderOpenRefConflict } from '../src/payment/service-order.ref'
import { TripCoverService } from '../src/payment/trip-cover.service'
import { PERSONAL_CHARGE_SETTING_KEY } from '../src/payment/terminal-charge.contract'
import { saveTerminalChargeSettings, writePersonalChargeEnabled } from '../src/payment/terminal-charge-settings'
import { assignTerminalOrganization } from '../src/terminals/terminal-org-assignment'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PaymentController } from '../src/payment/payment.controller'
import { resolvePaymentProviders, type PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { buildPaymentCallbackPath, type RefundExecuteInput } from '../src/payment/payment-provider.types'
import { SandboxPaymentProvider } from '../src/payment/providers/sandbox-payment.provider'
import { PricingService } from '../src/payment/pricing.service'
import { RefundService } from '../src/payment/refund.service'
import { ServiceOrderAdminController } from '../src/payment/service-order-admin.controller'
import { ServiceOrderController } from '../src/payment/service-order.controller'
import {
  SERVICE_ORDER_KEYS,
  SERVICE_ORDER_NAMES,
  classifyServiceOutcome,
} from '../src/payment/service-order.policy'
import { ServiceOrderService } from '../src/payment/service-order.service'
import { AdminOrdersReadonlyController } from '../src/admin-orders-readonly/admin-orders-readonly.controller'
import { AdminOrdersReadonlyService } from '../src/admin-orders-readonly/admin-orders-readonly.service'
import { AiController } from '../src/ai/ai.controller'
import { AiLogService } from '../src/ai/ai-log.service'
import { AiService } from '../src/ai/ai.service'
import { AsrService } from '../src/asr/asr.service'
import { BenefitRedemptionService } from '../src/benefit-redemption/benefit-redemption.service'
import { AiPublicQuotaService } from '../src/ai/ai-public-quota.service'
import { executeResumeCharge } from '../src/ai/quota/ai-resume-charge'
import { chargeComputeResumeOptimize } from '../src/ai/quota/ai-resume-charge-steps'
import type { ResumeChargeBindings } from '../src/ai/quota/ai-resume-charge'
import { JobFitController } from '../src/ai/job-fit.controller'
import { ResumeLayoutAdjustController } from '../src/ai/resume-layout-adjust.controller'
import { JobFitService } from '../src/ai/resume/job-fit.service'
import { MemberPrivacyService } from '../src/member-privacy/member-privacy.service'
import { AssistantSummaryService } from '../src/advisor/assistant-summary.service'
import { ResumeDraftSourceService } from '../src/ai/resume/resume-draft-source.service'
import { GovernedJobFitService } from '../src/job-ai/governed-job-fit.service'
import { JobAiQuotaService } from '../src/job-ai/job-ai-quota.service'
import { JobContextService } from '../src/job-ai/job-context.service'
import { KioskJobBoardService } from '../src/terminals/kiosk-job-board.service'
import { KioskSessionController } from '../src/kiosk-session/kiosk-session.controller'
import { KioskSessionService } from '../src/kiosk-session/kiosk-session.service'
import { MockInterviewController } from '../src/mock-interview/mock-interview.controller'
import { MockInterviewService } from '../src/mock-interview/mock-interview.service'
import { InterviewTranscriptPrintService } from '../src/mock-interview/interview-transcript-print.service'
import { TtsService } from '../src/mock-interview/asr/tts.service'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const API_ROOT = resolve(__dirname, '..')
const ADMIN = 'svc-order-admin'
const MEMBER = 'svc-order-member'
const MEMBER_JTI = 'svc-order-member-jti-01'
const ORG_PUBLIC = 'org-svc-public'
const ORG_SCHOOL = 'org-svc-school'
const TERM_CHARGE = 'term-svc-charge'
const TERM_PUBLIC = 'term-svc-public'
const TERM_ORG = 'term-svc-org'
const TERM_FREE = 'term-svc-free'

const DEMO_PRICES = { resume_optimize: 100, mock_interview: 200, scan: 100, print_bw_page: 0, print_color_page: 0 }

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
function applyOpenRefIndex(databasePath: string): void {
  const sql = readFileSync(join(API_ROOT, 'prisma/migrations/20261114170000_service_order_open_ref/migration.sql'), 'utf8')
  const match = sql.match(/CREATE UNIQUE INDEX "ServiceOrder_open_consumed_ref_key"[\s\S]*?;/)
  if (!match) return
  execFileSync('sqlite3', [databasePath], { input: match[0], encoding: 'utf8' })
}

interface CallResult {
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

function pass(label: string): void {
  console.log(`PASS ${label}`)
}

async function main(): Promise<void> {
  assert.deepEqual([...SERVICE_ORDER_KEYS], [...SHARED_KEYS])
  assert.deepEqual(SERVICE_ORDER_NAMES, SHARED_NAMES)
  assert.equal(classifyServiceOutcome('resume_optimize', 'optimize_completed'), 'made')
  assert.equal(classifyServiceOutcome('resume_optimize', 'optimize_failed'), 'not_made')
  assert.equal(classifyServiceOutcome('mock_interview', 'interview_opened'), 'made')
  assert.equal(classifyServiceOutcome('mock_interview', 'interview_not_opened'), 'not_made')
  assert.equal(classifyServiceOutcome('mock_interview', 'interview_followup_failed'), 'made')
  assert.equal(classifyServiceOutcome('scan', 'scan_file_produced'), 'made')
  assert.equal(classifyServiceOutcome('scan', 'scan_no_file'), 'not_made')
  assert.equal(classifyServiceOutcome('resume_optimize', 'layout_failed'), 'layout_only')
  pass('服务单键名与「做没做成」判据和共享类型一致')

  let quotaReserves = 0
  const quota = {
    async reserve() {
      quotaReserves += 1
      throw new HttpException({
        error: { code: 'AI_QUOTA_EXHAUSTED', message: '今天的 AI 次数用完了，明天 0 点恢复' },
      }, HttpStatus.TOO_MANY_REQUESTS)
    },
    async release() {},
    async commit() {},
    async remaining() { return [] },
  }
  const skipped = await executeResumeCharge(quota as never, {
    skipDailyQuota: true,
    endUserId: MEMBER,
    operationKey: 'svc-order-skip',
    work: async () => 'done',
    saveResult: async () => 'ref',
  }, { bucket: 'ai_resume', runWithAiQuota: async () => { throw new Error('不应扣每日次数') } })
  assert.equal(skipped, 'done')
  assert.equal(quotaReserves, 0, '付过的这一趟不应预占每日次数')

  let beforeGenerateCalls = 0
  const cached = await chargeComputeResumeOptimize(
    { providerName: 'rules', load: async () => ({ taskId: 'cached', status: 'completed' }) } as unknown as ResumeChargeBindings,
    'cached',
    { endUserId: null, accessToken: null },
    undefined,
    async () => { throw new Error('缓存不应再生成') },
    undefined,
    async () => { beforeGenerateCalls += 1; return true },
  )
  assert.equal(cached.status, 'completed')
  assert.equal(beforeGenerateCalls, 0, '缓存命中不能占用付款单')
  const noReport = await chargeComputeResumeOptimize(
    {
      providerName: 'rules',
      load: async (_taskId: string, kind: string) => kind === 'parse'
        ? { taskId: 'noreport', status: 'failed', report: null }
        : null,
    } as unknown as ResumeChargeBindings,
    'noreport',
    { endUserId: null, accessToken: null },
    undefined,
    async () => { throw new Error('诊断失败不应再生成') },
    undefined,
    async () => { beforeGenerateCalls += 1; return true },
  )
  assert.equal(noReport.status, 'failed')
  assert.equal(beforeGenerateCalls, 0, '诊断没成功不能收这一次的钱')
  let n8Extracts = 0
  let n8Thrown = 0
  await assert.rejects(
    () => chargeComputeResumeOptimize(
      {
        providerName: 'llm',
        load: async (_taskId: string, kind: string) => kind === 'parse'
          ? { taskId: 'n8', status: 'completed', report: { score: 1 }, fileId: 'file-n8' }
          : null,
        extract: async () => { n8Extracts += 1; return { ok: true, text: '原文' } },
        log: { optimizeThrown() { n8Thrown += 1 } },
      } as unknown as ResumeChargeBindings,
      'n8',
      { endUserId: null, accessToken: null },
      undefined,
      async () => { throw new Error('不应生成') },
      undefined,
      async () => {
        throw new HttpException({ error: { code: 'SERVICE_PAYMENT_REQUIRED', message: '请先付款' } }, HttpStatus.PAYMENT_REQUIRED)
      },
    ),
    (error: unknown) => error instanceof HttpException && error.getStatus() === 402,
  )
  assert.equal(n8Extracts, 0, '要付款时不能先抽原文')
  assert.equal(n8Thrown, 0, '要付款不能记成一次 AI 失败')
  pass('缓存和诊断失败都不占用付款单；要付款不记 AI 失败')

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
  const { ScanTasksController } = await import('../src/scan-tasks/scan-tasks.controller')
  const { TerminalsService } = await import('../src/terminals/terminals.service')
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

    for (const [terminalId, token, kioskSessionId, label] of [
      [TERM_PUBLIC, publicToken, publicSession, '公共点位'],
      [TERM_ORG, orgToken, orgSession, '机构承担'],
      [TERM_FREE, freeToken, freeSession, '生效价 0'],
    ] as const) {
      const before = await prisma.serviceOrder.count({ where: { terminalId } })
      const denied = await call('POST', '/api/v1/kiosk/service-orders', {
        serviceKey: 'resume_optimize',
        kioskSessionId,
      }, termHeaders(terminalId, token))
      expectStatus(denied, 409, label)
      assert.equal(denied.json.error?.code, 'SERVICE_FREE_ON_THIS_TERMINAL')
      const after = await prisma.serviceOrder.count({ where: { terminalId } })
      assert.equal(after, before, `${label} 不能建单`)
    }
    pass('公共点位、机构承担、生效价 0 都不建单')

    const created = await call('POST', '/api/v1/kiosk/service-orders', {
      serviceKey: 'resume_optimize',
      kioskSessionId: chargeSession,
    }, termHeaders(TERM_CHARGE, chargeToken))
    expectStatus(created, 200, '收费机器建单')
    const createdView = created.json.data ?? {}
    assert.equal(createdView['amountCents'], 100)
    assert.equal(createdView['status'], 'pending')
    assert.equal(typeof createdView['qrCodeContent'], 'string')
    assert.ok(String(createdView['qrCodeContent']).startsWith('sandboxpay://'))
    const expiresAt = Date.parse(String(createdView['expiresAt']))
    assert.ok(expiresAt > Date.now() + 4 * 60_000 && expiresAt < Date.now() + 6 * 60_000, '二维码 5 分钟过期')
    const createdRow = await loadOrder(String(createdView['id']))
    assert.equal(createdRow.amountCents, 100)
    assert.equal(createdRow.provider, 'sandbox')
    await prisma.terminalServicePrice.update({
      where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
      data: { unitCents: 50 },
    })
    const mismatched = await callback({ ...createdRow, amountCents: 50 }, 'success', 'sbx_txn_mismatch')
    expectStatus(mismatched, 400, '改价后按新价通知')
    assert.equal(mismatched.json.error?.code, 'CALLBACK_AMOUNT_MISMATCH')
    const stillPending = await loadOrder(createdRow.id)
    assert.equal(stillPending.status, 'pending')
    assert.equal(stillPending.amountCents, 100, '建单金额不随后续改价变')
    await prisma.terminalServicePrice.update({
      where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
      data: { unitCents: 100 },
    })
    const failedNotice = await callback(createdRow, 'failed')
    expectStatus(failedNotice, 200, '支付失败通知')
    const failedRow = await loadOrder(createdRow.id)
    assert.equal(failedRow.status, 'pending')
    assert.equal(failedRow.paymentFailed, true)
    const checking = await call('GET', `/api/v1/kiosk/service-orders/${createdRow.id}?refresh=1`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
    expectStatus(checking, 200, '刷新核实')
    assert.equal(checking.json.data?.['checking'], true)
    assert.equal(checking.json.data?.['status'], 'pending')
    const paidPacked = packCallback(createdRow, 'success', 'sbx_txn_resume_1')
    const paid = await postCallback(paidPacked)
    expectStatus(paid, 200, '支付成功')
    assert.equal(paid.json['ok'], true)
    const paidAgain = await callback(createdRow, 'success', 'sbx_txn_resume_1')
    expectStatus(paidAgain, 200, '重复成功通知')
    assert.equal(paidAgain.json['idempotent'], true)
    const paidAudits = await prisma.auditLog.count({ where: { action: 'service_order.paid', targetId: createdRow.id } })
    assert.equal(paidAudits, 1, '重复通知不能重复记账')
    const replay = await postCallback(paidPacked)
    expectStatus(replay, 401, '同一 nonce 重放')
    assert.equal(replay.json.error?.code, 'CALLBACK_REPLAY')
    const paidView = await call('GET', `/api/v1/kiosk/service-orders/${createdRow.id}`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
    assert.equal(paidView.json.data?.['status'], 'paid')
    assert.equal(paidView.json.data?.['paymentFailed'], false)
    assert.equal(paidView.json.data?.['amountCents'], 100)
    const wrongSession = await call('GET', `/api/v1/kiosk/service-orders/${createdRow.id}`, undefined, termHeaders(TERM_CHARGE, chargeToken, randomUUID()))
    expectStatus(wrongSession, 404, '别的会话不能看')
    assert.equal(wrongSession.json.error?.code, 'SERVICE_ORDER_NOT_FOUND')
    pass('建单、验签、失败仍待付、重复通知不重复记账、金额按建单时锁定')

    const missing = await call('GET', `/api/v1/resume/records/task-missing/optimize`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
    expectStatus(missing, 402, '没付款不能开始改写')
    assert.equal(missing.json.error?.code, 'SERVICE_PAYMENT_REQUIRED')
    assert.equal(missing.json.error?.amountCents, 100)
    assert.equal(missing.json.error?.serviceName, 'AI 简历优化')
    const callsAfter402 = optimizeCalls
    const history = await call('GET', `/api/v1/resume/records/task-history/optimize?existingOnly=1`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
    expectStatus(history, 200, '回看历史')
    assert.equal(await prisma.serviceOrder.count({ where: { status: 'consumed' } }), 0, '回看不能占用')
    const started = await call('GET', `/api/v1/resume/records/task-ok/optimize`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession, createdRow.id))
    expectStatus(started, 200, '付完开始改写')
    assert.equal(started.json['status'], 'completed')
    const used = await loadOrder(createdRow.id)
    assert.equal(used.status, 'consumed')
    assert.equal(used.attemptsUsed, 1)
    assert.equal(used.consumedRef, 'task-ok')
    const again = await call('GET', `/api/v1/resume/records/task-ok-2/optimize`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession, createdRow.id))
    expectStatus(again, 409, '同一张单不能再用一次')
    assert.equal(again.json.error?.code, 'SERVICE_ORDER_IN_USE')
    assert.equal(again.json.error?.consumedRef, 'task-ok')
    const usedStill = await loadOrder(createdRow.id)
    assert.equal(usedStill.attemptsUsed, 1)
    assert.ok(optimizeCalls > callsAfter402)
    pass('没单 402，付完只用一次，回看不占用')

    const raceSession = await openKiosk(TERM_CHARGE, chargeToken)
    const raceCreated = await call('POST', '/api/v1/kiosk/service-orders', {
      serviceKey: 'resume_optimize', kioskSessionId: raceSession,
    }, termHeaders(TERM_CHARGE, chargeToken))
    const raceId = String(raceCreated.json.data?.['id'])
    const raceRow = await loadOrder(raceId)
    expectStatus(await callback(raceRow, 'success', 'sbx_txn_race'), 200, '并发单付款')
    const [left, right] = await Promise.all([
      call('GET', '/api/v1/resume/records/task-race-a/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, raceSession, raceId)),
      call('GET', '/api/v1/resume/records/task-race-b/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, raceSession, raceId)),
    ])
    const raceStatuses = [left.status, right.status].sort((a, b) => a - b)
    assert.deepEqual(raceStatuses, [200, 409], `并发两次应只有一次成功 ${JSON.stringify([left.json, right.json])}`)
    const loser = left.status === 409 ? left : right
    assert.equal(loser.json.error?.code, 'SERVICE_ORDER_IN_USE')
    const raced = await loadOrder(raceId)
    assert.equal(raced.attemptsUsed, 1)
    assert.equal(raced.status, 'consumed')
    pass('并发两次开始只占用一次')

    const fitWithout = await call('POST', '/api/v1/resume/job-fit', {
      taskId: 'task-fit-none',
      manualJob: { title: '仓库管理员' },
    }, { ...termHeaders(TERM_CHARGE, chargeToken, chargeSession), authorization: `Bearer ${memberToken}` })
    expectStatus(fitWithout, 429, '没有这一趟时岗位对照仍扣每日次数')
    assert.equal(fitWithout.json.error?.code, 'AI_QUOTA_EXHAUSTED')
    assert.equal(jobFitReserves, 1)
    const reservesBeforeCovered = jobFitReserves
    const fitCovered = await call('POST', '/api/v1/resume/job-fit', {
      taskId: 'task-fit-covered',
      manualJob: { title: '仓库管理员' },
    }, { ...termHeaders(TERM_CHARGE, chargeToken, chargeSession, createdRow.id), authorization: `Bearer ${memberToken}` })
    expectStatus(fitCovered, 201, '付过的这一趟岗位对照')
    assert.notEqual(fitCovered.json.error?.code, 'AI_QUOTA_EXHAUSTED')
    assert.equal(jobFitReserves, reservesBeforeCovered, '收费机器上这一趟的岗位对照不再扣每日次数')
    const follow = await call('POST', `/api/v1/mock-interviews/iv-follow/answer`, { answer: '我做过仓储' }, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
    expectStatus(follow, 201, '追问不再另收')
    pass('收费机器上这一趟的子调用不再扣每日次数，也不再付一次')

    const layout = await call('POST', '/api/v1/resume/records/task-ok/layout-adjust', {
      action: 'reformat',
      resume: {
        basic: { name: '王磊' },
        intention: {},
        summary: '',
        education: [],
        experience: [],
        projects: [],
        skills: [],
        certificates: [],
      },
    }, termHeaders(TERM_CHARGE, chargeToken, chargeSession, createdRow.id))
    expectStatus(layout, 400, '排版失败')
    const afterLayout = await loadOrder(createdRow.id)
    assert.equal(afterLayout.status, 'consumed')
    assert.equal(afterLayout.refundedAt, null)
    const layoutAudit = await prisma.auditLog.count({ where: { action: 'service_order.layout_only', targetId: createdRow.id } })
    assert.equal(layoutAudit, 1, '排版失败只记一笔，不退款')
    pass('排版失败不退款')

    async function paidOrder(kioskSessionId: string, serviceKey: 'resume_optimize' | 'mock_interview' | 'scan', txn: string) {
      const made = await call('POST', '/api/v1/kiosk/service-orders', { serviceKey, kioskSessionId }, termHeaders(TERM_CHARGE, chargeToken))
      expectStatus(made, 200, `建单 ${serviceKey}`)
      const id = String(made.json.data?.['id'])
      const row = await loadOrder(id)
      expectStatus(await callback(row, 'success', txn), 200, `付款 ${txn}`)
      return row
    }

    const retrySession = await openKiosk(TERM_CHARGE, chargeToken)
    const retryRow = await paidOrder(retrySession, 'resume_optimize', 'sbx_txn_retry')
    optimizeMode = 'fail'
    const firstFail = await call('GET', '/api/v1/resume/records/task-fail-1/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, retrySession, retryRow.id))
    expectStatus(firstFail, 200, '第一次没做成')
    assert.equal(firstFail.json['status'], 'failed')
    const retryable = await loadOrder(retryRow.id)
    assert.equal(retryable.status, 'paid')
    assert.equal(retryable.attemptsUsed, 1)
    assert.equal(retryable.failureReason, '优化稿没做出来')
    assert.ok(retryable.retryUntil && retryable.retryUntil.getTime() > Date.now() + 9 * 60_000)
    const secondFail = await call('GET', '/api/v1/resume/records/task-fail-2/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, retrySession, retryRow.id))
    expectStatus(secondFail, 200, '再试仍没做成')
    const refundedFail = await loadOrder(retryRow.id)
    assert.equal(refundedFail.status, 'refunded')
    assert.equal(refundedFail.refundReason, '优化稿没做出来')
    assert.equal(refundedFail.refundAttempts, 0, '渠道一次退成，失败次数仍是 0')
    assert.ok(refundedFail.refundedAt)
    const refundAudit = await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: retryRow.id } })
    assert.equal(refundAudit, 1)
    optimizeMode = 'ok'
    pass('没做成可以免费再试一次，再失败才退')

    const successRetrySession = await openKiosk(TERM_CHARGE, chargeToken)
    const successRetryRow = await paidOrder(successRetrySession, 'resume_optimize', 'sbx_txn_retry_ok')
    optimizeMode = 'fail'
    expectStatus(await call('GET', '/api/v1/resume/records/task-then-ok-1/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, successRetrySession, successRetryRow.id)), 200, '先失败')
    optimizeMode = 'ok'
    const retriedOk = await call('GET', '/api/v1/resume/records/task-then-ok-2/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, successRetrySession, successRetryRow.id))
    expectStatus(retriedOk, 200, '再试做成')
    assert.equal(retriedOk.json['status'], 'completed')
    const kept = await loadOrder(successRetryRow.id)
    assert.equal(kept.status, 'consumed')
    assert.equal(kept.attemptsUsed, 2)
    assert.equal(kept.refundedAt, null)
    pass('再试做成了不退')

    const leaveFailSession = await openKiosk(TERM_CHARGE, chargeToken)
    const leaveFailRow = await paidOrder(leaveFailSession, 'resume_optimize', 'sbx_txn_leave_fail')
    optimizeMode = 'end-then-fail'
    const originalGet = ai.getResumeOptimize
    ai.getResumeOptimize = async (taskId, requester, existingOnly, req, beforeGenerate) => {
      if (beforeGenerate) await beforeGenerate()
      expectStatus(await endKiosk(TERM_CHARGE, chargeToken, leaveFailSession), 200, '生成途中清场')
      return { taskId, status: 'failed' }
    }
    expectStatus(await call('GET', '/api/v1/resume/records/task-leave/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, leaveFailSession, leaveFailRow.id)), 200, '人走了这次没做成')
    ai.getResumeOptimize = originalGet
    optimizeMode = 'ok'
    const leftFailed = await loadOrder(leaveFailRow.id)
    assert.equal(leftFailed.status, 'refunded', '人已经离开就不再给免费再试')
    pass('清场之后没做成直接退')

    const interviewSession = await openKiosk(TERM_CHARGE, chargeToken, 'interview')
    const interviewRow = await paidOrder(interviewSession, 'mock_interview', 'sbx_txn_interview')
    const noInterviewPay = await call('POST', '/api/v1/mock-interviews/iv-missing/start', {}, termHeaders(TERM_CHARGE, chargeToken, interviewSession))
    expectStatus(noInterviewPay, 402, '面试没付款')
    assert.equal(noInterviewPay.json.error?.serviceName, 'AI 模拟面试')
    assert.equal(noInterviewPay.json.error?.amountCents, 200)
    const interviewStart = await call('POST', '/api/v1/mock-interviews/iv-open/start', {}, termHeaders(TERM_CHARGE, chargeToken, interviewSession, interviewRow.id))
    expectStatus(interviewStart, 201, '面试开始')
    const interviewUsed = await loadOrder(interviewRow.id)
    assert.equal(interviewUsed.status, 'consumed')
    assert.equal(interviewUsed.attemptsUsed, 1)
    const replayStart = await call('POST', '/api/v1/mock-interviews/iv-open/start', {}, termHeaders(TERM_CHARGE, chargeToken, interviewSession, interviewRow.id))
    expectStatus(replayStart, 201, '已开场的回放')
    assert.equal((await loadOrder(interviewRow.id)).attemptsUsed, 1, '回放不能再占用')
    interviewMode = 'throw'
    const interviewFailRow = await paidOrder(interviewSession, 'mock_interview', 'sbx_txn_interview_fail')
    expectStatus(await call('POST', '/api/v1/mock-interviews/iv-down-1/start', {}, termHeaders(TERM_CHARGE, chargeToken, interviewSession, interviewFailRow.id)), 500, '面试没开起来')
    const interviewRetry = await loadOrder(interviewFailRow.id)
    assert.equal(interviewRetry.status, 'paid')
    assert.equal(interviewRetry.failureReason, '面试没开起来')
    expectStatus(await call('POST', '/api/v1/mock-interviews/iv-down-2/start', {}, termHeaders(TERM_CHARGE, chargeToken, interviewSession, interviewFailRow.id)), 500, '面试再试仍失败')
    assert.equal((await loadOrder(interviewFailRow.id)).status, 'refunded')
    interviewMode = 'ok'
    pass('面试开始前收，开起来不退，没开起来再试一次仍失败才退')

    const scanSession = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    const scanMissing = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, scanSession))
    expectStatus(scanMissing, 402, '扫描没付款')
    assert.equal(scanMissing.json.error?.serviceName, '扫描')
    const scanFileId = 'scan-file-made'
    await prisma.scanTask.create({
      data: { id: scanFileId, terminalId: TERM_CHARGE, scanType: 'resume', status: 'completed', fileId: 'file-demo', expiresAt: new Date(Date.now() + 3600_000) },
    })
    scanReturnId = scanFileId
    const scanRow = await paidOrder(scanSession, 'scan', 'sbx_txn_scan_ok')
    const scanStart = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, scanSession, scanRow.id))
    expectStatus(scanStart, 201, '扫描开始')
    assert.equal((await loadOrder(scanRow.id)).consumedRef, scanFileId)
    await prisma.serviceOrder.update({ where: { id: scanRow.id }, data: { consumedAt: new Date(Date.now() - 20_000) } })
    await serviceOrders.sweep()
    assert.equal((await loadOrder(scanRow.id)).status, 'consumed', '出了文件不退')
    const scanAgeRow = await paidOrder(scanSession, 'scan', 'sbx_txn_scan_age')
    await prisma.serviceOrder.update({
      where: { id: scanAgeRow.id },
      data: { status: 'consumed', attemptsUsed: 1, consumedAt: new Date(Date.now() - 3 * 60_000), consumedRef: 'pending' },
    })
    await serviceOrders.sweep()
    const scanAged = await loadOrder(scanAgeRow.id)
    assert.equal(scanAged.status, 'paid')
    assert.equal(scanAged.failureReason, '扫描没出文件')
    await prisma.serviceOrder.update({ where: { id: scanAgeRow.id }, data: { retryUntil: new Date(Date.now() - 1000) } })
    await serviceOrders.sweep()
    const scanExpired = await loadOrder(scanAgeRow.id)
    assert.equal(scanExpired.status, 'refunded')
    assert.equal(scanExpired.refundReason, '免费再试已过期')
    scanMode = 'throw'
    const scanThrowRow = await paidOrder(scanSession, 'scan', 'sbx_txn_scan_throw')
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, scanSession, scanThrowRow.id)), 500, '扫描创建失败')
    assert.equal((await loadOrder(scanThrowRow.id)).status, 'paid')
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, scanSession, scanThrowRow.id)), 500, '扫描再试失败')
    assert.equal((await loadOrder(scanThrowRow.id)).status, 'refunded')
    assert.equal((await loadOrder(scanThrowRow.id)).refundReason, '扫描没出文件')
    scanMode = 'ok'
    pass('扫描没出文件可再试，窗口过了或再失败才退；出了文件不退')

    const cancelSession = await openKiosk(TERM_CHARGE, chargeToken)
    const cancelPending = await call('POST', '/api/v1/kiosk/service-orders', {
      serviceKey: 'resume_optimize', kioskSessionId: cancelSession,
    }, termHeaders(TERM_CHARGE, chargeToken))
    const cancelPendingId = String(cancelPending.json.data?.['id'])
    const closedByUser = await call('POST', `/api/v1/kiosk/service-orders/${cancelPendingId}/close`, undefined, termHeaders(TERM_CHARGE, chargeToken, cancelSession))
    expectStatus(closedByUser, 200, '取消未付')
    assert.equal((await loadOrder(cancelPendingId)).status, 'closed')
    assert.equal((await loadOrder(cancelPendingId)).closeReason, 'user_cancelled')
    const cancelPaid = await paidOrder(cancelSession, 'mock_interview', 'sbx_txn_cancel_paid')
    const closedPaid = await call('POST', `/api/v1/kiosk/service-orders/${cancelPaid.id}/close`, undefined, termHeaders(TERM_CHARGE, chargeToken, cancelSession))
    expectStatus(closedPaid, 200, '取消已付未用')
    assert.equal((await loadOrder(cancelPaid.id)).status, 'refunded')
    assert.equal((await loadOrder(cancelPaid.id)).refundReason, '用户取消，这一次还没用')
    const inUse = await call('POST', `/api/v1/kiosk/service-orders/${createdRow.id}/close`, undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
    expectStatus(inUse, 409, '已经开始不能取消')
    assert.equal(inUse.json.error?.code, 'SERVICE_ORDER_IN_USE')
    pass('用户取消：未付关闭，付了没用退款，已经开始不能取消')

    const expireSession = await openKiosk(TERM_CHARGE, chargeToken)
    const expireCreated = await call('POST', '/api/v1/kiosk/service-orders', {
      serviceKey: 'scan', kioskSessionId: expireSession,
    }, termHeaders(TERM_CHARGE, chargeToken))
    const expireId = String(expireCreated.json.data?.['id'])
    await prisma.serviceOrder.update({ where: { id: expireId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await serviceOrders.sweep()
    const expired = await loadOrder(expireId)
    assert.equal(expired.status, 'closed')
    assert.equal(expired.closeReason, 'expired')
    const late = await callback(expired, 'success', 'sbx_txn_late')
    expectStatus(late, 200, '关闭后才付')
    const lateRow = await loadOrder(expireId)
    assert.equal(lateRow.status, 'refunded')
    assert.equal(lateRow.refundReason, '付款时这一单已经关闭')
    pass('超时未付关闭；关掉之后才付到的钱按原路退回')

    const leaveSession = await openKiosk(TERM_CHARGE, chargeToken)
    const leavePending = await call('POST', '/api/v1/kiosk/service-orders', {
      serviceKey: 'scan', kioskSessionId: leaveSession,
    }, termHeaders(TERM_CHARGE, chargeToken))
    const leavePendingId = String(leavePending.json.data?.['id'])
    const leavePaid = await paidOrder(leaveSession, 'scan', 'sbx_txn_leave_paid')
    expectStatus(await endKiosk(TERM_CHARGE, chargeToken, leaveSession), 200, '清场')
    assert.equal((await loadOrder(leavePendingId)).status, 'closed')
    assert.equal((await loadOrder(leavePendingId)).closeReason, 'session_ended')
    assert.equal((await loadOrder(leavePaid.id)).status, 'refunded')
    assert.equal((await loadOrder(leavePaid.id)).refundReason, '人已离开，这一次还没用')
    pass('清场关掉未付的单，并退掉付了还没用的')

    const refundSession = await openKiosk(TERM_CHARGE, chargeToken)
    const refundRow = await paidOrder(refundSession, 'mock_interview', 'sbx_txn_refund_fail')
    refundMode = 'throw'
    const callsBefore = refundCalls
    expectStatus(await endKiosk(TERM_CHARGE, chargeToken, refundSession), 200, '清场触发退款失败')
    const refunding = await loadOrder(refundRow.id)
    assert.equal(refunding.status, 'refunding')
    assert.equal(refunding.refundAttempts, 1)
    assert.equal(refunding.refundNo, `svc-rfd-${refundRow.id}`)
    assert.equal(refundCalls, callsBefore + 1)
    await serviceOrders.sweep()
    assert.equal(refundCalls, callsBefore + 1, '没到间隔不能连着退')
    assert.equal((await loadOrder(refundRow.id)).refundAttempts, 1)
    await prisma.serviceOrder.update({ where: { id: refundRow.id }, data: { nextRefundAt: new Date(Date.now() - 1000) } })
    await serviceOrders.sweep()
    const retriedRefund = await loadOrder(refundRow.id)
    assert.equal(retriedRefund.status, 'refunding')
    assert.equal(retriedRefund.refundAttempts, 2)
    assert.equal(retriedRefund.refundNo, refunding.refundNo)
    refundMode = 'ok'
    await prisma.serviceOrder.update({ where: { id: refundRow.id }, data: { nextRefundAt: new Date(Date.now() - 1000) } })
    await serviceOrders.sweep()
    const refundedLater = await loadOrder(refundRow.id)
    assert.equal(refundedLater.status, 'refunded')
    assert.equal(refundedLater.refundAttempts, 2, '退成之后不再把失败次数清零，也不再加')
    const callsAfterSuccess = refundCalls
    await serviceOrders.sweep()
    assert.equal(refundCalls, callsAfterSuccess, '已经退成的单不能再打一次渠道')
    pass('退款失败留在退款中并重试，不会标成已退，也不会退两次')

    const manualSession = await openKiosk(TERM_CHARGE, chargeToken)
    const manualRow = await paidOrder(manualSession, 'scan', 'sbx_txn_manual_refund')
    refundMode = 'throw'
    expectStatus(await endKiosk(TERM_CHARGE, chargeToken, manualSession), 200, '手动重试前先失败一次')
    const adminHeaders = { authorization: `Bearer ${adminToken}` }
    const listed = await call('GET', '/api/v1/admin/orders?recordKind=service&type=scan&serviceStatus=refunding', undefined, adminHeaders)
    expectStatus(listed, 200, '后台筛服务单')
    const listedItem = (listed.json.items ?? []).find((item) => item['id'] === manualRow.id)
    assert.ok(listedItem, '退款中的扫描单要出现在后台')
    assert.equal(listedItem?.['serviceKey'], 'scan')
    assert.equal(listedItem?.['serviceName'], '扫描')
    assert.equal(listedItem?.['amountCents'], 100)
    assert.equal(listedItem?.['serviceStatus'], 'refunding')
    assert.equal(listedItem?.['terminalCode'], 'ZYD-SN-01')
    assert.equal(listedItem?.['locationLabel'], '市南 · 香港中路')
    assert.equal(listedItem?.['refundReason'], '人已离开，这一次还没用')
    const emptyStatus = await call('GET', '/api/v1/admin/orders?recordKind=service&serviceStatus=paying', undefined, adminHeaders)
    expectStatus(emptyStatus, 200, '不认识的服务单状态')
    assert.equal(emptyStatus.json.pagination?.total, 0)
    const manualTry = await call('POST', `/api/v1/admin/orders/${manualRow.id}/retry-service-refund`, {}, adminHeaders)
    expectStatus(manualTry, 200, '退款中再试一次')
    assert.equal(manualTry.json['serviceStatus'], 'refunding')
    assert.equal((await loadOrder(manualRow.id)).refundAttempts, 2)
    const retryAudit = await prisma.auditLog.count({ where: { action: 'service_order.refund_retry', targetId: manualRow.id, actorId: ADMIN } })
    assert.equal(retryAudit, 1)
    refundMode = 'ok'
    const manualDone = await call('POST', `/api/v1/admin/orders/${manualRow.id}/retry-service-refund`, {}, adminHeaders)
    expectStatus(manualDone, 200, '手动重试退成')
    assert.equal(manualDone.json['serviceStatus'], 'refunded')
    assert.equal(typeof manualDone.json['refundedAt'], 'string')
    const notRefunding = await call('POST', `/api/v1/admin/orders/${manualRow.id}/retry-service-refund`, {}, adminHeaders)
    expectStatus(notRefunding, 409, '已退的不能再试')
    assert.equal(notRefunding.json.error?.code, 'SERVICE_REFUND_NOT_RETRYABLE')
    pass('后台能筛服务单，退款中可以再试一次')

    const freeCallsBefore = optimizeCalls
    const freeRun = await call('GET', '/api/v1/resume/records/task-free/optimize', undefined, termHeaders(TERM_FREE, freeToken, freeSession, createdRow.id))
    expectStatus(freeRun, 200, '不收费机器开始改写')
    assert.equal(freeRun.json['status'], 'completed')
    assert.equal(await prisma.serviceOrder.count({ where: { terminalId: TERM_FREE } }), 0)
    assert.equal((await loadOrder(createdRow.id)).attemptsUsed, 1, '不收费机器忽略别人的单号')
    assert.ok(optimizeCalls > freeCallsBefore)
    const publicInterview = await call('POST', '/api/v1/mock-interviews/iv-public/start', {}, termHeaders(TERM_PUBLIC, publicToken))
    expectStatus(publicInterview, 201, '公共点位面试不拦付款')
    const orgScan = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_ORG }, termHeaders(TERM_ORG, orgToken))
    expectStatus(orgScan, 201, '机构承担扫描不拦付款')
    pass('不收费的机器行为与加收费之前一样')

    const realGetResumeOptimize = AiService.prototype.getResumeOptimize
    const m6Self = Object.create(AiService.prototype) as {
      optimizeLock: RedisInflightLock
      loadAuthorizedResult: () => Promise<null>
      computeResumeOptimize: (taskId: string, requester: unknown, identity: unknown, req: unknown, beforeGenerate?: () => Promise<boolean>) => Promise<{ taskId: string; status: string }>
    }
    m6Self.optimizeLock = new RedisInflightLock(undefined)
    m6Self.loadAuthorizedResult = async () => null
    m6Self.computeResumeOptimize = async (taskId, _requester, _identity, _req, beforeGenerate) => {
      await beforeGenerate?.()
      return { taskId, status: 'completed' }
    }
    const stubOptimize = ai.getResumeOptimize
    ai.getResumeOptimize = function m6Get(...args: unknown[]) {
      return realGetResumeOptimize.apply(m6Self, args as never)
    }
    const m6Missing = await call('GET', '/api/v1/resume/records/m6-missing/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, chargeSession))
    expectStatus(m6Missing, 402, 'M6 没单')
    assert.equal(m6Missing.json.error?.code, 'SERVICE_PAYMENT_REQUIRED')
    const m6Session = await openKiosk(TERM_CHARGE, chargeToken)
    const m6Row = await paidOrder(m6Session, 'resume_optimize', 'sbx_txn_m6')
    const m6Run = await call('GET', '/api/v1/resume/records/m6-ok/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, m6Session, m6Row.id))
    expectStatus(m6Run, 200, 'M6 有单')
    const m6Used = await loadOrder(m6Row.id)
    assert.equal(m6Used.status, 'consumed')
    assert.equal(m6Used.consumedRef, 'm6-ok')
    ai.getResumeOptimize = stubOptimize
    pass('M6 真实改写入口：没单 402，有单后占用')

    const m7Session = await openKiosk(TERM_CHARGE, chargeToken)
    const m7Row = await paidOrder(m7Session, 'scan', 'sbx_txn_m7')
    const m7Before = await loadOrder(m7Row.id)
    const m7Run = await call('GET', '/api/v1/resume/records/m7-cross/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, m7Session, m7Row.id))
    expectStatus(m7Run, 402, 'M7 扫描单不能改写')
    assert.equal(m7Run.json.error?.code, 'SERVICE_PAYMENT_REQUIRED')
    const m7After = await loadOrder(m7Row.id)
    assert.equal(m7After.status, m7Before.status)
    assert.equal(m7After.attemptsUsed, m7Before.attemptsUsed)
    assert.equal(m7After.serviceKey, 'scan')
    assert.equal(m7After.consumedAt, m7Before.consumedAt)
    pass('M7 扫描单拿去改写仍要付款，扫描单不变')

    const idleSession = await openKiosk(TERM_CHARGE, chargeToken)
    const idleRow = await paidOrder(idleSession, 'resume_optimize', 'sbx_txn_c1_idle')
    await prisma.kioskSession.update({
      where: { terminalId_clientSessionId: { terminalId: TERM_CHARGE, clientSessionId: idleSession } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    await serviceOrders.sweep()
    const idleRefunded = await loadOrder(idleRow.id)
    assert.equal(idleRefunded.status, 'refunded')
    assert.equal(idleRefunded.refundReason, '人已离开，这一次还没用')
    const replaySession = await openKiosk(TERM_CHARGE, chargeToken)
    const replayPaid = await paidOrder(replaySession, 'scan', 'sbx_txn_c1_replay')
    await prisma.kioskSession.update({
      where: { terminalId_clientSessionId: { terminalId: TERM_CHARGE, clientSessionId: replaySession } },
      data: { endedAt: new Date() },
    })
    expectStatus(await endKiosk(TERM_CHARGE, chargeToken, replaySession), 200, '清场钩子失败后重发')
    assert.equal((await loadOrder(replayPaid.id)).status, 'refunded')
    assert.equal((await loadOrder(replayPaid.id)).refundReason, '人已离开，这一次还没用')
    pass('C-1 会话过期和清场重发都会退掉付了没用的单')

    const c2ResumeSession = await openKiosk(TERM_CHARGE, chargeToken)
    const c2Resume = await paidOrder(c2ResumeSession, 'resume_optimize', 'sbx_txn_c2_resume')
    await prisma.serviceOrder.update({
      where: { id: c2Resume.id },
      data: { status: 'consumed', attemptsUsed: 1, consumedAt: new Date(Date.now() - 8 * 60_000), consumedRef: 'c2-no-result', settledAt: null },
    })
    await prisma.kioskSession.update({
      where: { terminalId_clientSessionId: { terminalId: TERM_CHARGE, clientSessionId: c2ResumeSession } },
      data: { endedAt: new Date() },
    })
    await serviceOrders.sweep()
    assert.equal((await loadOrder(c2Resume.id)).status, 'refunded', 'C-2 简历中断且人已离开要退')
    const c2InterviewSession = await openKiosk(TERM_CHARGE, chargeToken, 'interview')
    const c2Interview = await paidOrder(c2InterviewSession, 'mock_interview', 'sbx_txn_c2_interview')
    await prisma.serviceOrder.update({
      where: { id: c2Interview.id },
      data: { status: 'consumed', attemptsUsed: 1, consumedAt: new Date(Date.now() - 8 * 60_000), consumedRef: 'c2-iv-open', settledAt: null },
    })
    await serviceOrders.sweep()
    const c2InterviewAfter = await loadOrder(c2Interview.id)
    assert.equal(c2InterviewAfter.status, 'paid', 'C-2 面试没开起来、人还在，回到可再试')
    assert.notEqual(c2InterviewAfter.status, 'consumed')
    const c2MadeSession = await openKiosk(TERM_CHARGE, chargeToken)
    const c2Made = await paidOrder(c2MadeSession, 'resume_optimize', 'sbx_txn_c2_made')
    await prisma.aiResumeResult.create({
      data: { taskId: 'c2-opt-made', kind: 'optimize', status: 'completed', provider: 'rules' },
    })
    await prisma.serviceOrder.update({
      where: { id: c2Made.id },
      data: { status: 'consumed', attemptsUsed: 1, consumedAt: new Date(Date.now() - 8 * 60_000), consumedRef: 'c2-opt-made', settledAt: null },
    })
    await serviceOrders.sweep()
    const c2MadeAfter = await loadOrder(c2Made.id)
    assert.equal(c2MadeAfter.status, 'consumed')
    assert.ok(c2MadeAfter.settledAt, '有优化稿要记成做成')
    await prisma.mockInterviewSession.create({
      data: {
        id: 'c2-stuck',
        status: 'in_progress',
        interviewerType: 'hr',
        industry: '仓储',
        position: '管理员',
        experience: 'y1_3',
        difficulty: 'standard',
        startedAt: new Date(Date.now() - 8 * 60_000),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    await serviceOrders.sweep()
    const stuck = await prisma.mockInterviewSession.findUnique({ where: { id: 'c2-stuck' } })
    assert.equal(stuck?.status, 'configured')
    assert.equal(stuck?.startedAt, null)
    interviewMode = 'already'
    const alreadySession = await openKiosk(TERM_CHARGE, chargeToken, 'interview')
    const alreadyRow = await paidOrder(alreadySession, 'mock_interview', 'sbx_txn_c2_already')
    expectStatus(await call('POST', '/api/v1/mock-interviews/c2-already/start', {}, termHeaders(TERM_CHARGE, chargeToken, alreadySession, alreadyRow.id)), 400, '面试号称已开始但没有首题')
    const alreadyAfter = await loadOrder(alreadyRow.id)
    assert.equal(alreadyAfter.status, 'paid')
    assert.equal(alreadyAfter.attemptsUsed, 1)
    interviewMode = 'ok'
    pass('C-2 简历和面试中断后能判定，没有首题不算做成')

    const c3Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    const c3Base = Date.now() - 180_000
    const c3Made: string[] = []
    for (let i = 0; i < 35; i += 1) {
      const taskId = `c3-made-${i}`
      await prisma.scanTask.create({
        data: { id: taskId, terminalId: TERM_CHARGE, scanType: 'document', status: 'completed', fileId: `c3-file-${i}`, expiresAt: new Date(Date.now() + 3600_000) },
      })
      const id = randomUUID()
      await prisma.serviceOrder.create({
        data: {
          id,
          terminalId: TERM_CHARGE,
          serviceKey: 'scan',
          amountCents: 100,
          status: 'consumed',
          attemptsUsed: 1,
          kioskSessionId: c3Session,
          provider: 'sandbox',
          providerOrderNo: `c3-made-${id}`,
          consumedAt: new Date(c3Base + i * 1000),
          consumedRef: taskId,
          expiresAt: new Date(Date.now() + 60_000),
          paidAt: new Date(),
          channelTxnNo: `c3-txn-${id}`,
        },
      })
      c3Made.push(id)
    }
    const c3Victim = randomUUID()
    await prisma.serviceOrder.create({
      data: {
        id: c3Victim,
        terminalId: TERM_CHARGE,
        serviceKey: 'scan',
        amountCents: 100,
        status: 'consumed',
        attemptsUsed: 2,
        kioskSessionId: c3Session,
        provider: 'sandbox',
        providerOrderNo: `c3-victim-${c3Victim}`,
        consumedAt: new Date(c3Base + 35 * 1000),
        consumedRef: 'c3-missing-task',
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: new Date(),
        channelTxnNo: `c3-txn-${c3Victim}`,
      },
    })
    await serviceOrders.sweep()
    await serviceOrders.sweep()
    assert.equal((await loadOrder(c3Victim)).status, 'refunded', 'C-3 排在做成的后面，两拍内也要退')
    const c3Settled = await prisma.serviceOrder.count({ where: { id: { in: c3Made }, settledAt: { not: null } } })
    assert.equal(c3Settled, c3Made.length, '做成的都结案')
    pass('C-3 做成的扫描让出名额，没出文件的能退')

    const n1Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    await prisma.scanTask.create({
      data: { id: 'b2-child', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    scanReturnId = 'b2-child'
    const n1 = await paidOrder(n1Session, 'scan', 'sbx_txn_n1')
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, n1Session, n1.id)), 201, 'N1 第一次扫描')
    assert.equal((await loadOrder(n1.id)).attemptsUsed, 1)
    assert.equal((await loadOrder(n1.id)).consumedRef, 'b2-child')
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, n1Session, n1.id)), 201, 'N1 重放')
    assert.equal((await loadOrder(n1.id)).attemptsUsed, 1, '重放不能再占一次')
    const n2Pay = await paidOrder(n1Session, 'scan', 'sbx_txn_n1_o2')
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, n1Session, n2Pay.id)), 201, 'N1 第二张单重扫')
    assert.equal((await loadOrder(n2Pay.id)).status, 'paid', '挂不上同一任务的新单要退回已付')
    const lineage = await prisma.serviceOrder.count({ where: { consumedRef: 'b2-child', status: { not: 'closed' } } })
    assert.equal(lineage, 1, '同一扫描任务只能挂一张单')
    pass('N1 重放只收一笔')

    await prisma.scanTask.create({
      data: { id: 'n4-dead', terminalId: TERM_CHARGE, scanType: 'resume', status: 'failed', expiresAt: new Date(Date.now() + 3600_000) },
    })
    await prisma.scanTask.create({
      data: { id: 'n4-new', terminalId: TERM_CHARGE, scanType: 'resume', status: 'completed', expiresAt: new Date(Date.now() + 3600_000) },
    })
    const n4Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    const n4Row = await paidOrder(n4Session, 'scan', 'sbx_txn_n4')
    await prisma.serviceOrder.update({
      where: { id: n4Row.id },
      data: { status: 'consumed', attemptsUsed: 1, consumedAt: new Date(), consumedRef: 'n4-dead' },
    })
    scanReturnId = 'n4-new'
    const n4Retry = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, n4Session, n4Row.id))
    expectStatus(n4Retry, 201, 'N4 失败后马上重扫')
    const n4After = await loadOrder(n4Row.id)
    assert.equal(n4After.status, 'consumed')
    assert.equal(n4After.consumedRef, 'n4-new')
    assert.notEqual(n4Retry.status, 402)
    pass('N4 扫描没出文件后马上重扫不用再付')

    const n2Session = await openKiosk(TERM_CHARGE, chargeToken)
    const n2Created = await call('POST', '/api/v1/kiosk/service-orders', {
      serviceKey: 'scan', kioskSessionId: n2Session,
    }, termHeaders(TERM_CHARGE, chargeToken))
    const n2Id = String(n2Created.json.data?.['id'])
    const n2Row = await loadOrder(n2Id)
    const findUnique = prisma.serviceOrder.findUnique.bind(prisma.serviceOrder)
    let n2Armed = true
    prisma.serviceOrder.findUnique = (async (args: unknown) => {
      const row = await findUnique(args as never)
      if (n2Armed && row?.id === n2Id && row.status === 'pending') {
        n2Armed = false
        await prisma.serviceOrder.update({
          where: { id: n2Id },
          data: { status: 'closed', channelTxnNo: null, closeReason: 'user_cancelled' },
        })
        return row
      }
      return row
    }) as typeof prisma.serviceOrder.findUnique
    try {
      const n2Notice = await callback(n2Row, 'success', 'sbx_txn_n2_race')
      expectStatus(n2Notice, 200, 'N2 关掉之后通知才到')
    } finally {
      prisma.serviceOrder.findUnique = findUnique
    }
    const n2After = await loadOrder(n2Id)
    assert.notEqual(n2After.status, 'closed', '关掉后付到的钱不能停在已关闭')
    assert.equal(n2After.status, 'refunded')
    assert.ok(n2After.channelTxnNo)
    assert.equal(n2After.refundReason, '付款时这一单已经关闭')
    pass('N2 付款通知和关单抢在一起时按原路退')

    const switchBefore = await prisma.platformSetting.findUnique({ where: { key: PERSONAL_CHARGE_SETTING_KEY } })
    await prisma.platformSetting.update({ where: { key: PERSONAL_CHARGE_SETTING_KEY }, data: { value: 'false' } })
    const switchSession = await openKiosk(TERM_CHARGE, chargeToken)
    const beforeSwitch = await prisma.serviceOrder.count()
    const switchCreate = await call('POST', '/api/v1/kiosk/service-orders', {
      serviceKey: 'resume_optimize', kioskSessionId: switchSession,
    }, termHeaders(TERM_CHARGE, chargeToken))
    expectStatus(switchCreate, 409, '总开关关着不能建单')
    assert.equal(switchCreate.json.error?.code, 'SERVICE_FREE_ON_THIS_TERMINAL')
    const switchStart = await call('GET', '/api/v1/resume/records/switch-off/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, switchSession))
    expectStatus(switchStart, 200, '总开关关着开始不拦')
    assert.equal(await prisma.serviceOrder.count(), beforeSwitch, '总开关关着不落新单')
    await prisma.platformSetting.update({ where: { key: PERSONAL_CHARGE_SETTING_KEY }, data: { value: switchBefore?.value ?? 'true' } })
    pass('总开关关时建单 409，开始不拦，不落单')

    const procSession = await openKiosk(TERM_CHARGE, chargeToken)
    const procRow = await paidOrder(procSession, 'scan', 'sbx_txn_processing')
    refundMode = 'processing'
    queryMode = 'processing'
    const procQueriesBefore = queryRefundCalls
    await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, procRow.id, '人已离开，这一次还没用')
    const processing = await loadOrder(procRow.id)
    assert.equal(processing.status, 'refunding')
    assert.equal(processing.refundAttempts, 0, '受理中不计失败次数')
    assert.equal(processing.refundChannelState, 'processing')
    assert.equal(processing.refundProcessingTries, 1)
    assert.ok(processing.nextRefundAt && processing.nextRefundAt.getTime() > Date.now() + 90_000)
    assert.equal(queryRefundCalls, procQueriesBefore, '第一次受理中还不查单')
    queryMode = 'success'
    await prisma.serviceOrder.update({ where: { id: procRow.id }, data: { nextRefundAt: new Date(Date.now() - 1000) } })
    await serviceOrders.sweep()
    const procDone = await loadOrder(procRow.id)
    assert.equal(procDone.status, 'refunded')
    assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: procRow.id } }), 1)
    assert.ok(queryRefundCalls > procQueriesBefore, '下一拍要先查单')
    refundMode = 'ok'
    pass('退款受理中先查单，查到成功才记已退')

    const abnormalSession = await openKiosk(TERM_CHARGE, chargeToken)
    const abnormalRow = await paidOrder(abnormalSession, 'mock_interview', 'sbx_txn_abnormal')
    await prisma.serviceOrder.update({
      where: { id: abnormalRow.id },
      data: {
        status: 'refunding',
        refundAttempts: 7,
        refundChannelState: 'processing',
        refundNo: `svc-rfd-${abnormalRow.id}`,
        refundReason: '人已离开，这一次还没用',
        nextRefundAt: new Date(Date.now() - 1000),
        refundLeaseUntil: null,
      },
    })
    queryMode = 'failed'
    await serviceOrders.sweep()
    const abnormalAfter = await loadOrder(abnormalRow.id)
    assert.equal(abnormalAfter.status, 'refund_failed')
    assert.equal(abnormalAfter.refundAttempts, 8)
    queryMode = 'processing'
    pass('ABNORMAL 到最大次数停在退款失败')

    const dualSession = await openKiosk(TERM_CHARGE, chargeToken)
    const dualRow = await paidOrder(dualSession, 'resume_optimize', 'sbx_txn_d2')
    await Promise.all([
      executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, dualRow.id, '并发退款'),
      executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, dualRow.id, '并发退款'),
    ])
    assert.equal((await loadOrder(dualRow.id)).status, 'refunded')
    assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: dualRow.id } }), 1, '并发退款只记一条已退')
    // 已付认领靠状态本身互斥。租约要挡的是两路同时看到「退款中」后再打渠道。
    const leaseSession = await openKiosk(TERM_CHARGE, chargeToken)
    const leaseRow = await paidOrder(leaseSession, 'scan', 'sbx_txn_d2_lease')
    await prisma.serviceOrder.update({
      where: { id: leaseRow.id },
      data: {
        status: 'refunding',
        refundNo: `svc-rfd-${leaseRow.id}`,
        refundReason: '并发退款',
        nextRefundAt: new Date(Date.now() - 1000),
        refundLeaseUntil: null,
        refundAttempts: 0,
        refundChannelState: null,
      },
    })
    const leaseCalls = refundCalls
    // 手动重试不看 nextRefundAt，只有租约能挡住第二路再打渠道。
    await Promise.all([
      executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, leaseRow.id, '并发退款', { manual: true }),
      executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, leaseRow.id, '并发退款', { manual: true }),
    ])
    assert.equal(refundCalls, leaseCalls + 1, '并发退款只打一次渠道')
    assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: leaseRow.id } }), 1, '退款中并发也只记一条已退')
    pass('D-2 自动退款并发只写一条审计')

    const nowFreeSession = await openKiosk(TERM_CHARGE, chargeToken)
    const nowFreeRow = await paidOrder(nowFreeSession, 'resume_optimize', 'sbx_txn_now_free')
    await setTerminalUserPrintPrices(prisma, TERM_CHARGE, { resume_optimize: 0 })
    const nowFreeRun = await call('GET', '/api/v1/resume/records/now-free/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, nowFreeSession, nowFreeRow.id))
    expectStatus(nowFreeRun, 200, 'A-1 改成免费后放行')
    const nowFreeAfter = await loadOrder(nowFreeRow.id)
    assert.equal(nowFreeAfter.status, 'refunded')
    assert.equal(nowFreeAfter.refundReason, '这台机器已改为免费')
    await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES)
    pass('A-1 机器改成免费后当场原路退，然后按免费放行')

    const forged = await call('GET', '/api/v1/resume/records/e2-forged/optimize', undefined, { 'x-terminal-id': TERM_PUBLIC })
    expectStatus(forged, 401, 'E-2 冒充公共点位')
    assert.equal(forged.json.error?.code, 'TERMINAL_SESSION_INVALID')
    const publicStill = await call('POST', '/api/v1/mock-interviews/iv-public-still/start', {}, termHeaders(TERM_PUBLIC, publicToken))
    expectStatus(publicStill, 201, '带着令牌的公共点位仍不收费')
    pass('E-2 带了终端头但不带令牌不能按免费放行')

    await setTerminalUserPrintPrices(prisma, TERM_CHARGE, { resume_optimize: 100_001 })
    const invalidPrice = await call('POST', '/api/v1/kiosk/service-orders', {
      serviceKey: 'resume_optimize', kioskSessionId: chargeSession,
    }, termHeaders(TERM_CHARGE, chargeToken))
    expectStatus(invalidPrice, 400, '价目不合法')
    assert.equal(invalidPrice.json.error?.code, 'PRICE_CONFIG_INVALID')
    await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES)
    pass('建单价目不合法时拒绝，不按 0 放行')

    const adminRefundSession = await openKiosk(TERM_CHARGE, chargeToken)
    const adminRefundRow = await paidOrder(adminRefundSession, 'scan', 'sbx_txn_admin_refund')
    const missingConfirm = await call('POST', `/api/v1/admin/orders/${adminRefundRow.id}/refund-service`, {}, adminHeaders)
    expectStatus(missingConfirm, 400, '没确认不能退')
    const confirmed = await call('POST', `/api/v1/admin/orders/${adminRefundRow.id}/refund-service`, { confirm: true }, adminHeaders)
    expectStatus(confirmed, 200, '后台原路退款')
    assert.equal((await loadOrder(adminRefundRow.id)).status, 'refunded')
    assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.admin_refund', targetId: adminRefundRow.id, actorId: ADMIN } }), 1)
    const settled = await call('POST', `/api/v1/admin/orders/${createdRow.id}/refund-service`, { confirm: true }, adminHeaders)
    expectStatus(settled, 409, '做成的单不能从后台退')
    pass('后台对卡住的已付单可以原路退，做成的不行')

    function stillCharged(row: { status: string }): boolean {
      return row.status === 'paid' || row.status === 'consumed' || row.status === 'refunding' || row.status === 'refund_failed'
    }

    const uniqRef = `open-ref-${randomUUID()}`
    const uniqSession = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    const uniqFirst = randomUUID()
    const uniqSecond = randomUUID()
    await prisma.serviceOrder.create({
      data: {
        id: uniqFirst,
        terminalId: TERM_CHARGE,
        serviceKey: 'scan',
        amountCents: 100,
        status: 'consumed',
        attemptsUsed: 1,
        kioskSessionId: uniqSession,
        provider: 'sandbox',
        providerOrderNo: `uniq-a-${uniqFirst}`,
        consumedRef: uniqRef,
        consumedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: new Date(),
        channelTxnNo: `uniq-txn-a-${uniqFirst}`,
      },
    })
    await prisma.serviceOrder.create({
      data: {
        id: uniqSecond,
        terminalId: TERM_CHARGE,
        serviceKey: 'scan',
        amountCents: 100,
        status: 'consumed',
        attemptsUsed: 1,
        kioskSessionId: uniqSession,
        provider: 'sandbox',
        providerOrderNo: `uniq-b-${uniqSecond}`,
        consumedRef: `other-${uniqSecond}`,
        consumedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: new Date(),
        channelTxnNo: `uniq-txn-b-${uniqSecond}`,
      },
    })
    let uniqRejected = false
    try {
      await prisma.$transaction((tx) => tx.$executeRaw`UPDATE "ServiceOrder" SET "consumedRef" = ${uniqRef} WHERE "id" = ${uniqSecond}`)
    } catch (error) {
      uniqRejected = isServiceOrderOpenRefConflict(error)
      if (!uniqRejected) throw error
    }
    assert.equal(uniqRejected, true, '同一没结案任务的第二张单必须被唯一索引拒绝')
    assert.equal(await prisma.serviceOrder.count({
      where: { consumedRef: uniqRef, status: { in: ['pending', 'paid', 'consumed'] } },
    }), 1, '唯一索引拒绝后只剩一张')
    pass('a 同一任务的第二张没结案单写不进去')

    const r16Releases: Array<() => void> = []
    const r16Session = await openKiosk(TERM_CHARGE, chargeToken)
    const r16O1 = await paidOrder(r16Session, 'resume_optimize', 'sbx_txn_r16_1')
    const r16Original = ai.getResumeOptimize.bind(ai)
    ai.getResumeOptimize = async (taskId, _requester, _existingOnly, _req, beforeGenerate) => {
      if (beforeGenerate) await beforeGenerate()
      await new Promise<void>((resolve) => { r16Releases.push(resolve) })
      return { taskId, status: 'failed' }
    }
    const r16Abort = new AbortController()
    const r16Hung = fetch(`${base}/api/v1/resume/records/r16-task/optimize`, {
      headers: termHeaders(TERM_CHARGE, chargeToken, r16Session, r16O1.id),
      signal: r16Abort.signal,
    }).catch(() => null)
    for (let i = 0; i < 100; i += 1) {
      if ((await loadOrder(r16O1.id)).status === 'consumed') break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal((await loadOrder(r16O1.id)).status, 'consumed', 'R16 第一张单已经占上任务')
    r16Abort.abort()
    await r16Hung
    ai.getResumeOptimize = async (taskId, _requester, existingOnly, _req, beforeGenerate) => {
      if (existingOnly) return { taskId, status: 'completed' }
      if (beforeGenerate) await beforeGenerate()
      await prisma.aiResumeResult.upsert({
        where: { taskId_kind: { taskId, kind: 'optimize' } },
        create: { taskId, kind: 'optimize', status: 'completed', provider: 'rules' },
        update: { status: 'completed' },
      })
      return { taskId, status: 'completed' }
    }
    const r16NoOrder = await call('GET', '/api/v1/resume/records/r16-task/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, r16Session))
    expectStatus(r16NoOrder, 402, 'R16 丢了单号要再付')
    const r16O2 = await paidOrder(r16Session, 'resume_optimize', 'sbx_txn_r16_2')
    expectStatus(await call('GET', '/api/v1/resume/records/r16-task/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, r16Session, r16O2.id)), 200, 'R16 第二张单做出稿')
    ai.getResumeOptimize = r16Original
    await serviceOrders.sweep(new Date(Date.now() + 8 * 60_000))
    await endKiosk(TERM_CHARGE, chargeToken, r16Session)
    await serviceOrders.sweep(new Date(Date.now() + 24 * 60 * 60_000))
    const r16A = await loadOrder(r16O1.id)
    const r16B = await loadOrder(r16O2.id)
    assert.equal([r16A, r16B].filter(stillCharged).length, 1, 'R16 同一份优化稿只收一笔')
    assert.equal([r16A, r16B].filter((row) => row.status === 'refunded').length, 1, 'R16 另一张要退')
    // 认领拦截还在时，上面那两张到不了复核。这里直接摆两张已占用、同一任务、稿已做成的单，复核必须退一张。
    await prisma.$transaction((tx) => tx.$executeRaw`DROP INDEX IF EXISTS "ServiceOrder_open_consumed_ref_key"`)
    const reviewRef = 'r16-review-only'
    await prisma.aiResumeResult.upsert({
      where: { taskId_kind: { taskId: reviewRef, kind: 'optimize' } },
      create: { taskId: reviewRef, kind: 'optimize', status: 'completed', provider: 'rules' },
      update: { status: 'completed' },
    })
    const reviewBase = {
      terminalId: TERM_CHARGE,
      serviceKey: 'resume_optimize',
      amountCents: 100,
      status: 'consumed',
      attemptsUsed: 1,
      kioskSessionId: r16Session,
      provider: 'sandbox',
      consumedRef: reviewRef,
      consumedAt: new Date(Date.now() - 10 * 60_000),
      expiresAt: new Date(Date.now() + 60_000),
      paidAt: new Date(),
    }
    const reviewOld = await prisma.serviceOrder.create({
      data: { ...reviewBase, id: 'r16-review-old', providerOrderNo: 'r16-review-old-no', channelTxnNo: 'r16-review-old-txn' },
    })
    const reviewNew = await prisma.serviceOrder.create({
      data: { ...reviewBase, id: 'r16-review-new', providerOrderNo: 'r16-review-new-no', channelTxnNo: 'r16-review-new-txn' },
    })
    await serviceOrders.sweep(new Date())
    const reviewRows = [await loadOrder(reviewOld.id), await loadOrder(reviewNew.id)]
    assert.equal(reviewRows.filter(stillCharged).length, 1, 'R16 复核看到别的单占着同一任务时只留一笔')
    assert.equal(reviewRows.filter((row) => row.status === 'refunded').length, 1, 'R16 复核要把另一张退掉')
    applyOpenRefIndex(databasePath)
    for (const release of r16Releases) release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    pass('R16 简历中断后再付，只收做出稿的那一笔')

    const r17Releases: Array<() => void> = []
    const r17Session = await openKiosk(TERM_CHARGE, chargeToken, 'interview')
    await prisma.mockInterviewSession.create({
      data: {
        id: 'r17-iv',
        status: 'configured',
        interviewerType: 'hr',
        industry: '仓储',
        position: '管理员',
        experience: 'y1_3',
        difficulty: 'standard',
        expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    const r17O1 = await paidOrder(r17Session, 'mock_interview', 'sbx_txn_r17_1')
    const r17Original = interview.start.bind(interview)
    interview.start = async (id: string) => {
      await prisma.mockInterviewSession.update({ where: { id }, data: { status: 'in_progress', startedAt: new Date() } })
      await new Promise<void>((resolve) => { r17Releases.push(resolve) })
      return { id, status: 'started' }
    }
    const r17Abort = new AbortController()
    const r17Hung = fetch(`${base}/api/v1/mock-interviews/r17-iv/start`, {
      method: 'POST',
      headers: { ...termHeaders(TERM_CHARGE, chargeToken, r17Session, r17O1.id), 'content-type': 'application/json' },
      body: '{}',
      signal: r17Abort.signal,
    }).catch(() => null)
    for (let i = 0; i < 100; i += 1) {
      if ((await loadOrder(r17O1.id)).status === 'consumed') break
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal((await loadOrder(r17O1.id)).status, 'consumed', 'R17 第一张单已经占上场次')
    r17Abort.abort()
    await r17Hung
    interview.start = async (id: string) => {
      const current = await prisma.mockInterviewSession.findUnique({ where: { id } })
      if (current?.status === 'in_progress') {
        throw new BadRequestException({ error: { code: 'INTERVIEW_ALREADY_STARTED', message: '本场练习已开始或已结束' } })
      }
      await prisma.mockInterviewSession.update({ where: { id }, data: { status: 'in_progress', startedAt: new Date() } })
      await prisma.mockInterviewTurn.create({
        data: { sessionId: id, idx: 0, role: 'interviewer', content: '请先做个自我介绍' },
      })
      openedInterviews.add(id)
      return { id, status: 'started' }
    }
    const r17O2 = await paidOrder(r17Session, 'mock_interview', 'sbx_txn_r17_2')
    const r17Try1 = await call('POST', '/api/v1/mock-interviews/r17-iv/start', {}, termHeaders(TERM_CHARGE, chargeToken, r17Session, r17O2.id))
    expectStatus(r17Try1, 201, 'R17 新单第一次就要开起来')
    assert.equal((await loadOrder(r17O2.id)).attemptsUsed, 1, 'R17 第一次就要占上')
    interview.start = r17Original
    await serviceOrders.sweep(new Date(Date.now() + 8 * 60_000))
    await endKiosk(TERM_CHARGE, chargeToken, r17Session)
    await serviceOrders.sweep(new Date(Date.now() + 24 * 60 * 60_000))
    const r17A = await loadOrder(r17O1.id)
    const r17B = await loadOrder(r17O2.id)
    assert.equal([r17A, r17B].filter(stillCharged).length, 1, 'R17 同一场面试只收一笔')
    assert.equal([r17A, r17B].filter((row) => row.status === 'refunded').length, 1, 'R17 另一张要退')
    for (const release of r17Releases) release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    pass('R17 面试中断后再付，只收开起来的那一笔')

    async function pendingChargeOrder() {
      const sessionId = await openKiosk(TERM_CHARGE, chargeToken)
      const made = await call('POST', '/api/v1/kiosk/service-orders', {
        serviceKey: 'resume_optimize', kioskSessionId: sessionId,
      }, termHeaders(TERM_CHARGE, chargeToken))
      expectStatus(made, 200, '待付建单')
      const row = await loadOrder(String(made.json.data?.['id']))
      assert.equal(row.status, 'pending')
      return { sessionId, row }
    }

    async function payOldCode(
      row: { id: string; providerOrderNo: string; prepayId: string | null; amountCents: number },
      txn: string,
      reason: string,
    ): Promise<void> {
      const before = refundCalls
      expectStatus(await callback(row, 'success', txn), 200, txn)
      const after = await loadOrder(row.id)
      assert.equal(after.status, 'refunded', `${txn} 当场退`)
      assert.equal(after.refundReason, reason)
      assert.equal(after.consumedAt, null, `${txn} 退了就不能用`)
      assert.equal(refundCalls, before + 1, `${txn} 只退一次`)
      expectStatus(await callback(row, 'success', txn), 200, `${txn} 再通知`)
      assert.equal(refundCalls, before + 1, `${txn} 不能退第二次`)
      assert.equal((await loadOrder(row.id)).status, 'refunded')
    }

    const recheck = await pendingChargeOrder()
    await prisma.terminalServicePrice.update({
      where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
      data: { unitCents: 180 },
    })
    const recheckBeforePay = await loadOrder(recheck.row.id)
    assert.equal(recheckBeforePay.status, 'pending', '直接改价不关单，通知前仍是待付')
    await payOldCode(recheck.row, 'sbx_txn_price_recheck', '这一项的价格已经变了')
    await prisma.terminalServicePrice.update({
      where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
      data: { unitCents: 100 },
    })
    pass('生效价变了，原码付款当场退，只退一次')

    const repriced = await pendingChargeOrder()
    await saveTerminalChargeSettings(prisma, TERM_CHARGE, {
      userChargeMode: 'user_pays',
      prices: { ...DEMO_PRICES, resume_optimize: 180 },
    }, ADMIN)
    const repricedClosed = await loadOrder(repriced.row.id)
    assert.equal(repricedClosed.status, 'closed', '改价成功后、付款通知前必须已经关掉')
    assert.equal(repricedClosed.closeReason, 'price_changed')
    await payOldCode(repriced.row, 'sbx_txn_price_change', '付款时这一单已经关闭')
    await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES)
    pass('改价后旧付款码不能按旧价收')

    const switched = await pendingChargeOrder()
    await writePersonalChargeEnabled(prisma, false, undefined, ADMIN)
    const switchedClosed = await loadOrder(switched.row.id)
    assert.equal(switchedClosed.status, 'closed', '关掉总开关后、付款通知前必须已经关掉')
    assert.equal(switchedClosed.closeReason, 'personal_charge_changed')
    await payOldCode(switched.row, 'sbx_txn_r18', '付款时这一单已经关闭')
    await writePersonalChargeEnabled(prisma, true, true, ADMIN)
    pass('R18 关掉总开关后旧付款码不能收')

    const rebound = await pendingChargeOrder()
    await assignTerminalOrganization(prisma, TERM_CHARGE, ORG_SCHOOL, new Date(), async () => undefined)
    const reboundClosed = await loadOrder(rebound.row.id)
    assert.equal(reboundClosed.status, 'closed', '改绑成功后、付款通知前必须已经关掉')
    assert.equal(reboundClosed.closeReason, 'org_rebound')
    await payOldCode(rebound.row, 'sbx_txn_r19', '付款时这一单已经关闭')
    await assignTerminalOrganization(prisma, TERM_CHARGE, null, new Date(), async () => undefined)
    await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES)
    pass('R19 改绑后旧付款码不能收')

    const r20Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    await prisma.scanTask.create({
      data: { id: 'r20-dup', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    scanReturnId = 'r20-dup'
    const r20Holder = await paidOrder(r20Session, 'scan', 'sbx_txn_r20_x')
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r20Session, r20Holder.id)), 201, 'R20 先占上这一次扫描')
    const r20Order = await paidOrder(r20Session, 'scan', 'sbx_txn_r20_o')
    await prisma.serviceOrder.update({
      where: { id: r20Order.id },
      data: { attemptsUsed: 1, failureReason: '扫描没出文件', retryUntil: new Date(Date.now() + 10 * 60_000) },
    })
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r20Session, r20Order.id)), 201, 'R20 挂不上就退回')
    const r20Released = await loadOrder(r20Order.id)
    assert.equal(r20Released.status, 'paid', 'R20 退回后仍是已付')
    assert.ok(r20Released.attemptsUsed >= 1, 'R20 用过的次数还在')
    assert.ok(r20Released.retryUntil, 'R20 退回后必须还在可重用期内')
    await serviceOrders.sweep()
    assert.equal((await loadOrder(r20Order.id)).status, 'paid', 'R20 还在可重用期内不能退')
    await prisma.serviceOrder.update({ where: { id: r20Order.id }, data: { retryUntil: null } })
    await serviceOrders.sweep()
    const r20Final = await loadOrder(r20Order.id)
    assert.equal(r20Final.status, 'refunded', 'R20 没了再试期限必须由清扫退')
    assert.equal(r20Final.refundReason, '免费再试已过期')
    pass('R20 再试被退回后，要么还能再试，要么清扫退款')

    const r21Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    const r21Order = await paidOrder(r21Session, 'scan', 'sbx_txn_r21')
    await prisma.serviceOrder.update({
      where: { id: r21Order.id },
      data: {
        status: 'refunding',
        refundAttempts: 7,
        refundNo: `svc-rfd-${r21Order.id}`,
        refundReason: '人已离开，这一次还没用',
        refundChannelState: 'failed',
        nextRefundAt: new Date(Date.now() - 1000),
        refundLeaseUntil: null,
      },
    })
    refundMode = 'throw'
    const r21Manual = await call('POST', `/api/v1/admin/orders/${r21Order.id}/retry-service-refund`, {}, adminHeaders)
    expectStatus(r21Manual, 200, 'R21 手动再试')
    const r21After = await loadOrder(r21Order.id)
    assert.equal(r21After.status, 'refund_failed', 'R21 到上限后进入退款待人工处理')
    assert.equal(r21After.refundAttempts, 8)
    assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refund_retry', targetId: r21Order.id, actorId: ADMIN } }), 1, 'R21 手动失败要记审计')
    const r21Listed = await call('GET', '/api/v1/admin/orders?recordKind=service&serviceStatus=refund_failed', undefined, adminHeaders)
    expectStatus(r21Listed, 200, 'R21 后台能筛退款待人工处理')
    assert.ok((r21Listed.json.items ?? []).some((item) => item['id'] === r21Order.id), 'R21 这张单要出现在筛选里')
    await serviceOrders.sweep()
    await serviceOrders.sweep()
    await serviceOrders.sweep()
    const r21Held = await loadOrder(r21Order.id)
    assert.equal(r21Held.status, 'refund_failed', 'R21 清扫不能把它留在退款中，也不能当成已退')
    assert.equal(r21Held.refundAttempts, 8, 'R21 到上限后清扫不再打渠道')
    const r21Leak = randomUUID()
    await prisma.serviceOrder.create({
      data: {
        id: r21Leak,
        terminalId: TERM_CHARGE,
        serviceKey: 'scan',
        amountCents: 100,
        status: 'refunding',
        attemptsUsed: 1,
        refundAttempts: 8,
        refundNo: `svc-rfd-${r21Leak}`,
        refundReason: '人已离开，这一次还没用',
        kioskSessionId: r21Session,
        provider: 'sandbox',
        providerOrderNo: `r21-leak-${r21Leak}`,
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: new Date(),
        channelTxnNo: `r21-txn-${r21Leak}`,
        nextRefundAt: null,
        refundLeaseUntil: null,
      },
    })
    await serviceOrders.sweep()
    const r21LeakAfter = await loadOrder(r21Leak)
    assert.equal(r21LeakAfter.status, 'refund_failed', 'R21 漏在退款中的到顶单要交给人工')
    assert.equal(r21LeakAfter.refundAttempts, 8, 'R21 交给人工时不再打渠道')
    const r21Alerts = await collectDerivedAlerts(prisma, new Date())
    assert.ok(r21Alerts.alerts.some((alert) => alert.type === 'service_return_manual' && alert.subjectId === r21Order.id), 'R21 告警中心要有这一张')
    assert.equal(r21Alerts.firingTotal, r21Alerts.alerts.length + r21Alerts.omitted)
    refundMode = 'ok'
    const r21Again = await call('POST', `/api/v1/admin/orders/${r21Order.id}/retry-service-refund`, {}, adminHeaders)
    expectStatus(r21Again, 200, 'R21 人工再试一次可以退成')
    assert.equal((await loadOrder(r21Order.id)).status, 'refunded')
    const r21AlertsAfter = await collectDerivedAlerts(prisma, new Date())
    assert.equal(r21AlertsAfter.alerts.some((alert) => alert.subjectId === r21Order.id), false, 'R21 退成后告警消失')
    pass('R21 退款到上限后待人工处理，失败也留在那里')

    const r22Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    await prisma.scanTask.create({
      data: { id: 'r22-1', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    scanReturnId = 'r22-1'
    const r22Order = await paidOrder(r22Session, 'scan', 'sbx_txn_r22')
    const r22Creates = scanCreates
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r22Session, r22Order.id)), 201, 'R22 第一次扫描')
    assert.equal(scanCreates, r22Creates + 1)
    await prisma.scanTask.update({ where: { id: 'r22-1' }, data: { status: 'completed', fileId: 'file-r22-1' } })
    await prisma.scanTask.create({
      data: { id: 'r22-2', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    scanReturnId = 'r22-2'
    const r22BeforeSecond = scanCreates
    const r22Second = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r22Session, r22Order.id))
    expectStatus(r22Second, 409, 'R22 已经有文件不能再开新扫描')
    assert.equal(r22Second.json.error?.code, 'SERVICE_ORDER_IN_USE')
    assert.equal(scanCreates, r22BeforeSecond, 'R22 有文件时不能再创建扫描任务')
    assert.equal((await loadOrder(r22Order.id)).consumedRef, 'r22-1')
    const r22LiveSession = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    await prisma.scanTask.create({
      data: { id: 'r22-live', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    scanReturnId = 'r22-live'
    const r22Live = await paidOrder(r22LiveSession, 'scan', 'sbx_txn_r22_live')
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r22LiveSession, r22Live.id)), 201, 'R22 活着的扫描')
    await prisma.scanTask.create({
      data: { id: 'r22-other', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    scanReturnId = 'r22-other'
    const r22Attach = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r22LiveSession, r22Live.id))
    expectStatus(r22Attach, 409, 'R22 换一个任务挂上来要拒绝')
    assert.equal(r22Attach.json.error?.code, 'SERVICE_ORDER_IN_USE')
    assert.equal((await loadOrder(r22Live.id)).consumedRef, 'r22-live', 'R22 拒绝后原任务还在这张单上')
    await prisma.serviceOrder.update({ where: { id: r22Order.id }, data: { consumedAt: new Date(Date.now() - 20_000) } })
    await serviceOrders.sweep()
    assert.ok((await loadOrder(r22Order.id)).settledAt, 'R22 出了文件要结案')
    await prisma.scanTask.create({
      data: { id: 'r22-3', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    scanReturnId = 'r22-3'
    const r22Third = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r22Session, r22Order.id))
    expectStatus(r22Third, 409, 'R22 结案后不能再开')
    const r22View = await call('GET', `/api/v1/kiosk/service-orders/${r22Order.id}`, undefined, termHeaders(TERM_CHARGE, chargeToken, r22Session))
    expectStatus(r22View, 200, 'R22 读单')
    assert.equal(Object.prototype.hasOwnProperty.call(r22View.json.data ?? {}, 'settledAt'), true, 'R22 读单要带结案时间')
    assert.equal(typeof r22View.json.data?.['settledAt'], 'string')
    pass('R22 一张单用过之后不能再开新扫描，读单能看到结案时间')

    const r23Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    await prisma.scanTask.create({
      data: { id: 'r23-slow', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 10 * 60_000) },
    })
    scanReturnId = 'r23-slow'
    const r23Order = await paidOrder(r23Session, 'scan', 'sbx_txn_r23')
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, r23Session, r23Order.id)), 201, 'R23 扫描开始')
    await prisma.serviceOrder.update({ where: { id: r23Order.id }, data: { consumedAt: new Date(Date.now() - 30 * 60_000) } })
    await serviceOrders.sweep()
    const r23Live = await loadOrder(r23Order.id)
    assert.equal(r23Live.status, 'consumed', 'R23 会话还活着不能判没做成')
    assert.equal(r23Live.refundedAt, null)
    await prisma.serviceOrder.update({ where: { id: r23Order.id }, data: { attemptsUsed: 2 } })
    await prisma.scanTask.update({ where: { id: 'r23-slow' }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await serviceOrders.sweep()
    const r23Expired = await loadOrder(r23Order.id)
    assert.equal(r23Expired.status, 'refunded', 'R23 过了有效期还没文件才退')
    await prisma.scanTask.update({ where: { id: 'r23-slow' }, data: { status: 'completed', fileId: 'file-r23' } })
    await serviceOrders.sweep()
    const r23Later = await loadOrder(r23Order.id)
    assert.equal(r23Later.status, 'refunded', 'R23 退了之后文件出来也不再收')
    assert.equal(r23Later.amountCents, 100)
    pass('R23 活着的扫描不判，过期才退，之后出文件不再收')

    const r24Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    const r24Ok = await paidOrder(r24Session, 'scan', 'sbx_txn_r24')
    refundMode = 'processing'
    await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, r24Ok.id, '人已离开，这一次还没用')
    refundMode = 'ok'
    const r24Success = { refundNo: `svc-rfd-${r24Ok.id}`, channelRefundNo: 'wx-rfd-r24', refundAmountCents: 100, status: 'success' as const }
    const r24First = await settleServiceRefundNotify(prisma, audit, null, r24Success)
    const r24Second = await settleServiceRefundNotify(prisma, audit, null, r24Success)
    assert.equal((await loadOrder(r24Ok.id)).status, 'refunded', 'R24 成功通知记已退')
    assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: r24Ok.id } }), 1, 'R24 成功通知只记一次')
    assert.equal(r24Second.idempotent, true)
    assert.equal(r24First.handled, true)
    const r24Fail = await paidOrder(r24Session, 'scan', 'sbx_txn_r24b')
    refundMode = 'processing'
    await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, r24Fail.id, '人已离开，这一次还没用')
    refundMode = 'ok'
    const r24FailNotice = { refundNo: `svc-rfd-${r24Fail.id}`, channelRefundNo: null, refundAmountCents: null, status: 'failed' as const }
    await settleServiceRefundNotify(prisma, audit, null, r24FailNotice)
    const r24FailOnce = await loadOrder(r24Fail.id)
    await settleServiceRefundNotify(prisma, audit, null, r24FailNotice)
    const r24FailTwice = await loadOrder(r24Fail.id)
    assert.equal(r24FailTwice.refundAttempts, r24FailOnce.refundAttempts, 'R24 同一条失败通知不能记两次')
    assert.equal(r24FailTwice.refundAttempts, 1)
    const r24ThenOk = await settleServiceRefundNotify(prisma, audit, null, {
      refundNo: `svc-rfd-${r24Fail.id}`, channelRefundNo: 'wx-rfd-r24-ok', refundAmountCents: 100, status: 'success',
    })
    assert.equal(r24ThenOk.handled, true)
    assert.equal((await loadOrder(r24Fail.id)).status, 'refunded', 'R24 失败之后换一条成功通知要收下')
    const r24Mismatch = await paidOrder(r24Session, 'scan', 'sbx_txn_r24c')
    refundMode = 'processing'
    await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, r24Mismatch.id, '人已离开，这一次还没用')
    refundMode = 'ok'
    const r24Bad = await settleServiceRefundNotify(prisma, audit, null, {
      refundNo: `svc-rfd-${r24Mismatch.id}`, channelRefundNo: 'wx-rfd-bad', refundAmountCents: 1, status: 'success',
    })
    assert.equal(r24Bad.handled, true, 'R24 金额不符也要回已处理')
    const r24BadRow = await loadOrder(r24Mismatch.id)
    assert.notEqual(r24BadRow.status, 'refunded', 'R24 金额不符不能记成已退')
    assert.ok(r24BadRow.refundAnomaly, 'R24 金额不符要记下来')
    const r24Alerts = await collectDerivedAlerts(prisma, new Date())
    assert.ok(r24Alerts.alerts.some((alert) => alert.type === 'service_return_manual' && alert.subjectId === r24Mismatch.id), 'R24 金额不符要进告警中心')
    const r24Unknown = await settleServiceRefundNotify(prisma, audit, null, {
      refundNo: 'svc-rfd-missing-order', channelRefundNo: 'wx-rfd-missing', refundAmountCents: 100, status: 'success',
    })
    assert.equal(r24Unknown.handled, true, 'R24 对不上的服务单退款通知也不再让渠道重发')
    pass('R24 退款通知只处理一次，对不上也回成功')

    const originalCloseQr = SandboxPaymentProvider.prototype.closeExpiredQrPayment
    const closeQr = SandboxPaymentProvider.prototype as unknown as {
      closeExpiredQrPayment: (input: { attemptId: string; orderId: string }) => Promise<{ status: string; channelTxnNo: string | null; amountCents: number | null }>
    }
    try {
      const g1 = await pendingChargeOrder()
      await prisma.terminalServicePrice.update({
        where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
        data: { unitCents: 180 },
      })
      await prisma.serviceOrder.update({
        where: { id: g1.row.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      closeQr.closeExpiredQrPayment = async (input) => {
        if (input.orderId !== g1.row.id) return originalCloseQr.call(SandboxPaymentProvider.prototype, input)
        return { status: 'paid', channelTxnNo: 'sbx_txn_g1_expire', amountCents: g1.row.amountCents }
      }
      const g1Refunds = refundCalls
      await serviceOrders.sweep(new Date())
      const g1After = await loadOrder(g1.row.id)
      assert.equal(g1After.status, 'refunded', 'G1 到期关码发现已付且价已变，必须当场退')
      assert.equal(g1After.refundReason, '这一项的价格已经变了')
      assert.equal(g1After.consumedAt, null, 'G1 退了就不能按旧价用掉')
      assert.equal(refundCalls, g1Refunds + 1, 'G1 只退一次')
      const g1Use = await call('GET', '/api/v1/resume/records/g1-task/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, g1.sessionId, g1.row.id))
      expectStatus(g1Use, 402, 'G1 退掉的单不能再优化')
      assert.equal((await loadOrder(g1.row.id)).status, 'refunded')
      pass('G1 到期关码查到已付且价已变，当场退')
    } finally {
      closeQr.closeExpiredQrPayment = originalCloseQr
      await prisma.terminalServicePrice.update({
        where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
        data: { unitCents: 100 },
      }).catch(() => undefined)
    }

    const g10Session = await openKiosk(TERM_CHARGE, chargeToken)
    const g10When = new Date(Date.now() - 2 * 60 * 60_000)
    await prisma.serviceOrder.create({
      data: {
        id: 'g10-old',
        terminalId: TERM_CHARGE,
        serviceKey: 'resume_optimize',
        amountCents: 100,
        status: 'consumed',
        attemptsUsed: 1,
        consumedRef: 'g10-task',
        consumedAt: g10When,
        settledAt: g10When,
        kioskSessionId: g10Session,
        provider: 'sandbox',
        providerOrderNo: 'g10-old-no',
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: g10When,
        channelTxnNo: 'g10-old-txn',
      },
    })
    const g10New = await paidOrder(g10Session, 'resume_optimize', 'sbx_txn_g10')
    const g10Res = await call('GET', '/api/v1/resume/records/g10-task/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, g10Session, g10New.id))
    expectStatus(g10Res, 409, 'G10 结案的旧单不能让新单接手')
    assert.equal(g10Res.json.error?.code, 'SERVICE_ORDER_REF_OCCUPIED')
    assert.equal(g10Res.json.error?.existingOrderId, 'g10-old')
    const g10OldAfter = await loadOrder('g10-old')
    assert.equal(g10OldAfter.status, 'consumed', 'G10 旧单保持已占用')
    assert.ok(g10OldAfter.settledAt, 'G10 旧单仍然结案')
    assert.equal(g10OldAfter.refundReason, null, 'G10 不能把做成的旧单退掉')
    const g10NewAfter = await loadOrder(g10New.id)
    assert.equal(g10NewAfter.status, 'paid')
    assert.equal(g10NewAfter.attemptsUsed, 0)
    pass('G10 已经结案的旧单不许退，新单进不去')

    const g2Session = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    await prisma.scanTask.create({
      data: { id: 'g2-live', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    scanReturnId = 'g2-live'
    const g2 = await paidOrder(g2Session, 'scan', 'sbx_txn_g2')
    expectStatus(await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, g2Session, g2.id)), 201, 'G2 第一次扫描')
    assert.equal((await loadOrder(g2.id)).consumedRef, 'g2-live')
    await prisma.scanTask.create({
      data: { id: 'g2-other', terminalId: TERM_CHARGE, scanType: 'resume', status: 'waiting', expiresAt: new Date(Date.now() + 3600_000) },
    })
    scanReturnId = 'g2-other'
    const g2Before = scanCreates
    const g2Replay = await call('POST', '/api/v1/scan/sessions', { scanType: 'resume', terminalId: TERM_CHARGE }, termHeaders(TERM_CHARGE, chargeToken, g2Session, g2.id))
    expectStatus(g2Replay, 409, 'G2 换任务号要拒绝')
    assert.equal(g2Replay.json.error?.code, 'SERVICE_ORDER_IN_USE')
    assert.equal(g2Replay.json.error?.consumedRef, 'g2-live', 'G2 拒绝时要带这张单正在占的任务')
    assert.equal(scanCreates, g2Before, 'G2 拒绝前不能再建扫描任务')
    assert.equal((await loadOrder(g2.id)).consumedRef, 'g2-live')
    pass('G2 重放换成另一个任务时，不建新任务，409 带原来的任务号')

    const g9Session = await openKiosk(TERM_CHARGE, chargeToken)
    await prisma.aiResumeResult.upsert({
      where: { taskId_kind: { taskId: 'g9-task', kind: 'optimize' } },
      create: { taskId: 'g9-task', kind: 'optimize', status: 'completed', provider: 'rules' },
      update: { status: 'completed' },
    })
    const g9Old = await prisma.serviceOrder.create({
      data: {
        id: 'g9-old',
        terminalId: TERM_CHARGE,
        serviceKey: 'resume_optimize',
        amountCents: 100,
        status: 'consumed',
        attemptsUsed: 1,
        consumedRef: 'g9-task',
        consumedAt: new Date(),
        kioskSessionId: g9Session,
        provider: 'sandbox',
        providerOrderNo: 'g9-old-no',
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: new Date(),
        channelTxnNo: 'g9-old-txn',
      },
    })
    const g9New = await paidOrder(g9Session, 'resume_optimize', 'sbx_txn_g9')
    const g9Res = await call('GET', '/api/v1/resume/records/g9-task/optimize', undefined, termHeaders(TERM_CHARGE, chargeToken, g9Session, g9New.id))
    expectStatus(g9Res, 409, 'G9 判不了的旧单要拦住新单')
    assert.equal(g9Res.json.error?.code, 'SERVICE_ORDER_REF_OCCUPIED')
    assert.equal(g9Res.json.error?.existingOrderId, g9Old.id, 'G9 要告诉是哪张旧单占着')
    const g9NewHeld = await loadOrder(g9New.id)
    assert.equal(g9NewHeld.status, 'paid', 'G9 新单仍是已付')
    assert.equal(g9NewHeld.attemptsUsed, 0, 'G9 新单一次都没用')
    expectStatus(await endKiosk(TERM_CHARGE, chargeToken, g9Session), 200, 'G9 人离开')
    const g9NewLeft = await loadOrder(g9New.id)
    assert.equal(g9NewLeft.status, 'refunded', 'G9 会话结束要把没用的新单退掉')
    assert.equal(g9NewLeft.refundReason, '人已离开，这一次还没用')
    assert.equal((await loadOrder(g9Old.id)).status, 'consumed', 'G9 旧单不动')
    pass('G9 任务还被旧单占着时，新单保持已付，人走了再退')

    let nextRefundEvent: RefundNotifyEvent | null = null
    const serviceRefunds = new RefundService(prisma, audit, {
      get(channel: string) {
        if (channel !== 'wechat') return undefined
        return {
          async verifyRefundNotify() {
            if (!nextRefundEvent) return { ok: false as const, code: 'CALLBACK_SIGNATURE_INVALID' }
            return { ok: true as const, event: nextRefundEvent }
          },
        }
      },
    } as unknown as PaymentProviderRegistry, redis as unknown as RedisService)
    async function notifyServiceRefund(event: Omit<RefundNotifyEvent, 'channel' | 'outTradeNo' | 'nonce' | 'timestampMs'>): Promise<void> {
      nextRefundEvent = {
        channel: 'wechat',
        outTradeNo: 'svc-out',
        nonce: randomUUID().replace(/-/g, ''),
        timestampMs: Date.now(),
        ...event,
      }
      const notified = await serviceRefunds.processWechatRefundNotify(Buffer.from('{}'), {})
      assert.equal(notified.ok, true)
    }
    const rfdSession = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    const rfdOk = await paidOrder(rfdSession, 'scan', 'sbx_txn_rfd_ok')
    refundMode = 'processing'
    await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, rfdOk.id, '人已离开，这一次还没用')
    refundMode = 'ok'
    await notifyServiceRefund({ refundNo: `svc-rfd-${rfdOk.id}`, channelRefundNo: 'wx-rfd-svc-ok', refundAmountCents: 100, status: 'success' })
    assert.equal((await loadOrder(rfdOk.id)).status, 'refunded', '成功通知要记成已退')
    assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: rfdOk.id } }), 1)
    await notifyServiceRefund({ refundNo: `svc-rfd-${rfdOk.id}`, channelRefundNo: 'wx-rfd-svc-ok', refundAmountCents: 100, status: 'success' })
    assert.equal((await loadOrder(rfdOk.id)).status, 'refunded')
    assert.equal(await prisma.auditLog.count({ where: { action: 'service_order.refunded', targetId: rfdOk.id } }), 1, '同一条成功通知不能再记一次')
    const rfdFail = await paidOrder(rfdSession, 'scan', 'sbx_txn_rfd_fail')
    refundMode = 'processing'
    await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, rfdFail.id, '人已离开，这一次还没用')
    refundMode = 'ok'
    await notifyServiceRefund({ refundNo: `svc-rfd-${rfdFail.id}`, channelRefundNo: null, refundAmountCents: null, status: 'failed' })
    const rfdFailOnce = await loadOrder(rfdFail.id)
    await notifyServiceRefund({ refundNo: `svc-rfd-${rfdFail.id}`, channelRefundNo: null, refundAmountCents: null, status: 'failed' })
    const rfdFailTwice = await loadOrder(rfdFail.id)
    assert.equal(rfdFailTwice.refundAttempts, rfdFailOnce.refundAttempts, '同一条失败通知不能记两次')
    assert.equal(rfdFailTwice.refundAttempts, 1)
    assert.notEqual(rfdFailTwice.status, 'refunded')
    const rfdBad = await paidOrder(rfdSession, 'scan', 'sbx_txn_rfd_bad')
    refundMode = 'processing'
    await executeServiceOrderRefund(prisma, registry, audit, redis as unknown as RedisService, rfdBad.id, '人已离开，这一次还没用')
    refundMode = 'ok'
    await notifyServiceRefund({ refundNo: `svc-rfd-${rfdBad.id}`, channelRefundNo: 'wx-rfd-svc-bad', refundAmountCents: 1, status: 'success' })
    const rfdBadRow = await loadOrder(rfdBad.id)
    assert.notEqual(rfdBadRow.status, 'refunded', '金额不符不能记成已退')
    assert.ok(rfdBadRow.refundAnomaly, '金额不符要记下来')
    pass('服务单退款通知经退款服务分派：成功、失败、重复、金额不符')

    try {
      const g5 = await pendingChargeOrder()
      closeQr.closeExpiredQrPayment = async (input) => {
        if (input.orderId === g5.row.id) throw new Error('channel close down')
        return { status: 'closed', channelTxnNo: null, amountCents: null }
      }
      await saveTerminalChargeSettings(prisma, TERM_CHARGE, {
        userChargeMode: 'user_pays',
        prices: { ...DEMO_PRICES, resume_optimize: 180 },
      }, ADMIN)
      const g5Closed = await loadOrder(g5.row.id)
      assert.equal(g5Closed.status, 'closed', '关单失败也要先把这一单关掉')
      assert.equal(g5Closed.closeReason, 'price_changed')
      assert.equal(g5Closed.channelClosePending, true, '渠道没关上，要留下重试')
      const g5Price = await prisma.terminalServicePrice.findUnique({
        where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
      })
      assert.equal(g5Price?.unitCents, 180, '关单失败不能把改价滚回去')
      assert.equal(await prisma.auditLog.count({
        where: { action: 'service_order.channel_close_failed', targetId: g5.row.id },
      }), 1, '关单失败要记一笔')
      closeQr.closeExpiredQrPayment = async (input) => {
        if (input.orderId === g5.row.id) {
          return { status: 'paid', channelTxnNo: 'sbx_txn_g5', amountCents: g5.row.amountCents }
        }
        return { status: 'closed', channelTxnNo: null, amountCents: null }
      }
      const g5Refunds = refundCalls
      await serviceOrders.sweep()
      const g5Paid = await loadOrder(g5.row.id)
      assert.equal(g5Paid.status, 'refunded', '清扫重试发现已付必须退')
      assert.equal(g5Paid.refundReason, '付款时这一单已经关闭')
      assert.equal(refundCalls, g5Refunds + 1, '这一张只退一次')
      await serviceOrders.sweep()
      assert.equal(refundCalls, g5Refunds + 1, '下一拍不能再退')
      assert.equal((await loadOrder(g5.row.id)).status, 'refunded')
      pass('改价时渠道关单失败，清扫重试发现已付就退一次')

      await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES)
      const g5Bind = await pendingChargeOrder()
      closeQr.closeExpiredQrPayment = async (input) => {
        if (input.orderId === g5Bind.row.id) {
          return { status: 'paid', channelTxnNo: 'sbx_txn_g5_bind', amountCents: g5Bind.row.amountCents }
        }
        return { status: 'closed', channelTxnNo: null, amountCents: null }
      }
      await assignTerminalOrganization(prisma, TERM_CHARGE, ORG_SCHOOL, new Date(), async () => undefined)
      const g5BindAfter = await loadOrder(g5Bind.row.id)
      assert.equal(g5BindAfter.status, 'refunded', '改绑时渠道说已付必须退')
      assert.equal(g5BindAfter.refundReason, '这台机器已改为免费')
      assert.equal(await prisma.auditLog.count({
        where: { action: 'service_order.refunded', targetId: g5Bind.row.id },
      }), 1, '改绑这一张只退一次')
      assert.equal((await prisma.terminal.findUnique({ where: { id: TERM_CHARGE } }))?.orgId, ORG_SCHOOL, '退款不能把改绑滚回去')
      await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES)
      const g5Retry = await pendingChargeOrder()
      closeQr.closeExpiredQrPayment = async (input) => {
        if (input.orderId === g5Retry.row.id) throw new Error('channel close down')
        return { status: 'closed', channelTxnNo: null, amountCents: null }
      }
      await assignTerminalOrganization(prisma, TERM_CHARGE, null, new Date(), async () => undefined)
      const g5RetryClosed = await loadOrder(g5Retry.row.id)
      assert.equal(g5RetryClosed.status, 'closed')
      assert.equal(g5RetryClosed.closeReason, 'org_rebound')
      assert.equal(g5RetryClosed.channelClosePending, true)
      closeQr.closeExpiredQrPayment = async () => ({ status: 'closed', channelTxnNo: null, amountCents: null })
      const g5RetryRefunds = refundCalls
      await serviceOrders.sweep()
      const g5RetryAfter = await loadOrder(g5Retry.row.id)
      assert.equal(g5RetryAfter.status, 'closed', '渠道确认没付就保持关闭')
      assert.equal(g5RetryAfter.channelClosePending, false, '重试关上之后不再挂着')
      assert.equal(g5RetryAfter.refundedAt, null)
      assert.equal(refundCalls, g5RetryRefunds, '没付不能退')
      assert.equal((await prisma.terminal.findUnique({ where: { id: TERM_CHARGE } }))?.orgId, null)
      pass('改绑时渠道说已付要退；关不上就清扫重试')
    } finally {
      closeQr.closeExpiredQrPayment = originalCloseQr
      await assignTerminalOrganization(prisma, TERM_CHARGE, null, new Date(), async () => undefined).catch(() => undefined)
      await setTerminalUserPrintPrices(prisma, TERM_CHARGE, DEMO_PRICES).catch(() => undefined)
    }

    await prisma.$transaction((tx) => tx.$executeRaw`DROP INDEX IF EXISTS "ServiceOrder_open_consumed_ref_key"`)
    try {
      const reviewSession = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
      const reviewWhen = new Date('2019-06-01T00:00:00.000Z')
      await prisma.scanTask.create({
        data: {
          id: 'p2a4-scan-ref',
          terminalId: TERM_CHARGE,
          scanType: 'resume',
          status: 'completed',
          fileId: 'file-p2a4-scan',
          expiresAt: new Date(Date.now() + 3600_000),
        },
      })
      const scanReviewBase = {
        terminalId: TERM_CHARGE,
        serviceKey: 'scan',
        amountCents: 100,
        status: 'consumed',
        attemptsUsed: 1,
        consumedRef: 'p2a4-scan-ref',
        consumedAt: reviewWhen,
        kioskSessionId: reviewSession,
        provider: 'sandbox',
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: reviewWhen,
      }
      await prisma.serviceOrder.create({
        data: { ...scanReviewBase, id: 'p2a4-scan-a', providerOrderNo: 'p2a4-scan-a-no', channelTxnNo: 'p2a4-scan-a-txn' },
      })
      await prisma.serviceOrder.create({
        data: { ...scanReviewBase, id: 'p2a4-scan-b', providerOrderNo: 'p2a4-scan-b-no', channelTxnNo: 'p2a4-scan-b-txn' },
      })
      await serviceOrders.sweep(new Date())
      const scanA = await loadOrder('p2a4-scan-a')
      const scanB = await loadOrder('p2a4-scan-b')
      assert.equal(scanA.status, 'refunded', '扫描复核先看到的那张要退')
      assert.equal(scanA.refundReason, '这一趟已经算在另一张单上')
      assert.equal(scanB.status, 'consumed', '扫描复核留下做成的那张')
      assert.ok(scanB.settledAt, '留下的扫描要结案')
      pass('扫描复核看到同一任务两张单时只留一笔')

      await prisma.mockInterviewSession.create({
        data: {
          id: 'p2a4-iv-ref',
          status: 'in_progress',
          interviewerType: 'hr',
          industry: '仓储',
          position: '管理员',
          experience: 'y1_3',
          difficulty: 'standard',
          expiresAt: new Date(Date.now() + 3600_000),
        },
      })
      await prisma.mockInterviewTurn.create({
        data: { sessionId: 'p2a4-iv-ref', idx: 0, role: 'interviewer', content: '请先做个自我介绍' },
      })
      const interviewReviewBase = {
        terminalId: TERM_CHARGE,
        serviceKey: 'mock_interview',
        amountCents: 200,
        status: 'consumed',
        attemptsUsed: 1,
        consumedRef: 'p2a4-iv-ref',
        consumedAt: reviewWhen,
        kioskSessionId: reviewSession,
        provider: 'sandbox',
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: reviewWhen,
      }
      await prisma.serviceOrder.create({
        data: { ...interviewReviewBase, id: 'p2a4-iv-a', providerOrderNo: 'p2a4-iv-a-no', channelTxnNo: 'p2a4-iv-a-txn' },
      })
      await prisma.serviceOrder.create({
        data: { ...interviewReviewBase, id: 'p2a4-iv-b', providerOrderNo: 'p2a4-iv-b-no', channelTxnNo: 'p2a4-iv-b-txn' },
      })
      await serviceOrders.sweep(new Date())
      const ivA = await loadOrder('p2a4-iv-a')
      const ivB = await loadOrder('p2a4-iv-b')
      assert.equal(ivA.status, 'refunded', '面试复核先看到的那张要退')
      assert.equal(ivA.refundReason, '这一趟已经算在另一张单上')
      assert.equal(ivB.status, 'consumed', '面试复核留下开过的那张')
      assert.ok(ivB.settledAt, '留下的面试要结案')
      pass('模拟面试复核看到同一场两张单时只留一笔')
    } finally {
      applyOpenRefIndex(databasePath)
    }

    const sweepSession = await openKiosk(TERM_CHARGE, chargeToken, 'scan')
    const sweepOldest = new Date('2020-01-01T00:00:00.000Z')
    await prisma.scanTask.create({
      data: {
        id: 'p2a4-sweep-old',
        terminalId: TERM_CHARGE,
        scanType: 'resume',
        status: 'failed',
        expiresAt: new Date(Date.now() - 1000),
      },
    })
    await prisma.serviceOrder.create({
      data: {
        id: 'p2a4-sweep-old',
        terminalId: TERM_CHARGE,
        serviceKey: 'scan',
        amountCents: 100,
        status: 'consumed',
        attemptsUsed: 2,
        consumedRef: 'p2a4-sweep-old',
        consumedAt: sweepOldest,
        kioskSessionId: sweepSession,
        provider: 'sandbox',
        providerOrderNo: 'p2a4-sweep-old-no',
        expiresAt: new Date(Date.now() + 60_000),
        paidAt: sweepOldest,
        channelTxnNo: 'p2a4-sweep-old-txn',
      },
    })
    for (let i = 0; i < SERVICE_SWEEP_BATCH; i += 1) {
      const taskId = `p2a4-sweep-live-${i}`
      await prisma.scanTask.create({
        data: {
          id: taskId,
          terminalId: TERM_CHARGE,
          scanType: 'resume',
          status: 'waiting',
          expiresAt: new Date(Date.now() + 3600_000),
        },
      })
      await prisma.serviceOrder.create({
        data: {
          id: taskId,
          terminalId: TERM_CHARGE,
          serviceKey: 'scan',
          amountCents: 100,
          status: 'consumed',
          attemptsUsed: 1,
          consumedRef: taskId,
          consumedAt: new Date(sweepOldest.getTime() + (i + 1) * 1000),
          kioskSessionId: sweepSession,
          provider: 'sandbox',
          providerOrderNo: `${taskId}-no`,
          expiresAt: new Date(Date.now() + 60_000),
          paidAt: sweepOldest,
          channelTxnNo: `${taskId}-txn`,
        },
      })
    }
    await serviceOrders.sweep(new Date())
    const sweepVictim = await loadOrder('p2a4-sweep-old')
    const sweepNewest = await loadOrder(`p2a4-sweep-live-${SERVICE_SWEEP_BATCH - 1}`)
    assert.equal(sweepVictim.status, 'refunded', '最早那张没出文件的扫描这一拍就要退')
    assert.equal(sweepNewest.status, 'consumed', '还活着的新扫描不能被这一拍退掉')
    assert.equal(sweepNewest.settledAt, null, '还活着的新扫描不能被这一拍结案')
    pass('扫描清扫先看占用更早的，活着的新扫描留到后面')
  } catch (error) {
    failed = true
    console.error(error)
    throw error
  } finally {
    await app.close().catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
    rmSync(dir, { recursive: true, force: true })
    if (!failed) pass('服务单收钱、占用、退款和后台查看')
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
