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
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs'
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
import { setTerminalUserPrintPrices } from '../src/payment/effective-user-prices'
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

interface CallResult {
  status: number
  json: {
    success?: boolean
    data?: Record<string, unknown>
    error?: { code?: string; message?: string; amountCents?: number; serviceKey?: string; serviceName?: string }
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
  pass('缓存和诊断失败都不占用付款单')

  const dir = mkdtempSync(join(tmpdir(), 'service-orders-'))
  const databasePath = join(dir, 'verify-service-orders.db')
  const databaseUrl = `file:${databasePath}`
  process.env['DATABASE_URL'] = databaseUrl
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  assertIsolatedVerificationDatabase()
  closeSync(openSync(databasePath, 'wx'))
  pushSchema(databaseUrl)

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
  let refundMode: 'ok' | 'throw' = 'ok'
  let refundCalls = 0
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
            return target.refund(input)
          }
        }
        const value = Reflect.get(target, prop, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }) as PaymentProviderRegistry['get']

  const serviceOrders = new ServiceOrderService(prisma, audit, sessions, registry, redis as unknown as RedisService)
  const kioskSessions = new KioskSessionService(prisma, serviceOrders)
  const online = new OnlinePaymentService(prisma, audit, {} as OrderStatusService, registry)
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
  let interviewMode: 'ok' | 'throw' = 'ok'
  const interview = {
    async hasInterviewerTurn(id: string) { return openedInterviews.has(id) },
    async start(id: string) {
      if (interviewMode === 'throw') throw new Error('interview down')
      openedInterviews.add(id)
      return { id, status: 'started' }
    },
    async answer() { return { ok: true } },
    async createSession() { return { id: 'unused' } },
  }
  let scanMode: 'ok' | 'throw' = 'ok'
  let scanReturnId = 'scan-return'
  const scans = {
    async create() {
      if (scanMode === 'throw') throw new Error('scan down')
      return { scanTaskId: scanReturnId }
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
    await prisma.terminalServicePrice.update({
      where: { terminalId_serviceKey: { terminalId: TERM_CHARGE, serviceKey: 'resume_optimize' } },
      data: { unitCents: 100 },
    })
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
    expectStatus(again, 402, '同一张单不能再用一次')
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
    assert.deepEqual(raceStatuses, [200, 402], `并发两次应只有一次成功 ${JSON.stringify([left.json, right.json])}`)
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
