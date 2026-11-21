/**
 * 模拟面试「报告没生成算这一趟没做成」全链路与并发门禁（SQLite 与 PostgreSQL 两边同跑）。
 *
 * 覆盖：
 *   1. 判据都在 service-order.policy.ts（事件分类、失败/退款原因、状态决定）。
 *   2. 开场后出报告成功 → 不退（随后结束会话与清扫也不退）。
 *   3. 首次出报告失败（模型失败 / 落库失败）→ 进 10 分钟免费再试，单留在 consumed、不可被新开场认领、不可被新单顶替。
 *   4. 无回答（INTERVIEW_NO_ANSWERS）等用户侧前置失败 → 不进再试、不退。
 *   5. 窗口内再试出报告成功 → 做成不退、清失败原因与窗口。
 *   6. 再试仍失败 → 自动原路退一次且只一次；退后再出报告也不倒回做成。
 *   7. 窗口过期清扫 → 自动退；会话结束（onSessionEnded）→ 自动退。
 *   8. 开场后从不出报告就离开 → 不退（开场即做成照旧）；开场重试过（attemptsUsed=2）后首次报告失败仍给免费再试。
 *   9. 并发：同实例首次并发 end 合并只进 retry；双路并发 end 失败 + sweep 同时跑只退一次；做成后再失败/清扫绝不退。
 *  10. 免费机器（无服务单）→ 完全不碰。
 */
process.env['TERMINAL_ADMIN_SECRET'] ||= 'verify-interview-report-terminal-admin-secret-0123456789'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'verify-interview-report-terminal-action-secret-0123456789'
process.env['ADMIN_IP_ALLOWLIST'] = ''
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
process.env['NODE_ENV'] = 'test'
process.env['PAYMENT_PROVIDER'] = 'sandbox'
process.env['SANDBOX_PAYMENT_SECRET'] = 'verify-interview-report-sandbox-secret'
process.env['JWT_SECRET'] = 'verify-interview-report-jwt-secret-0123456789'

import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { BadRequestException, Module, ServiceUnavailableException, ValidationPipe, type ValidationError } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { AuditService } from '../src/audit/audit.service'
import { AiLogService } from '../src/ai/ai-log.service'
import { ResumeExtractionService } from '../src/ai/resume/resume-extraction.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { RedisService } from '../src/common/redis/redis.service'
import { installBodyParsers } from '../src/config/body-parsers'
import { FilesService } from '../src/files/files.service'
import { KioskSessionController } from '../src/kiosk-session/kiosk-session.controller'
import { KioskSessionService } from '../src/kiosk-session/kiosk-session.service'
import { MemberPrivacyService } from '../src/member-privacy/member-privacy.service'
import { AsrService } from '../src/mock-interview/asr/asr.service'
import { TtsService } from '../src/mock-interview/asr/tts.service'
import { InterviewPracticeSheetPdfService } from '../src/mock-interview/interview-practice-sheet-pdf.service'
import { InterviewReportPdfService } from '../src/mock-interview/interview-report-pdf.service'
import { InterviewTranscriptPrintService } from '../src/mock-interview/interview-transcript-print.service'
import { MockInterviewLlmService, type InterviewReportPayload } from '../src/mock-interview/mock-interview-llm.service'
import { MockInterviewController } from '../src/mock-interview/mock-interview.controller'
import { MockInterviewService } from '../src/mock-interview/mock-interview.service'
import { OnlinePaymentService } from '../src/payment/online-payment.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { PaymentController } from '../src/payment/payment.controller'
import { PAYMENT_PROVIDER_TOKEN, resolvePaymentProviders, type PaymentProviderRegistry } from '../src/payment/payment-provider.factory'
import { buildPaymentCallbackPath, type RefundExecuteInput } from '../src/payment/payment-provider.types'
import { SandboxPaymentProvider } from '../src/payment/providers/sandbox-payment.provider'
import { PricingService } from '../src/payment/pricing.service'
import { RefundService } from '../src/payment/refund.service'
import { ServiceOrderController } from '../src/payment/service-order.controller'
import {
  SERVICE_REFUND_REASON_REPORT_FAILED,
  SERVICE_REFUND_REASON_REPORT_LEFT,
  SERVICE_REFUND_REASON_RETRY_EXPIRED,
  SERVICE_RETRY_WINDOW_MS,
  classifyServiceOutcome,
  decideInterviewReportFailure,
  failureReasonFor,
} from '../src/payment/service-order.policy'
import { executeServiceOrderRefund } from '../src/payment/service-order.payment'
import { ServiceOrderService } from '../src/payment/service-order.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { TerminalIdentityGuard } from '../src/terminals/terminal-identity.guard'
import { TERMINAL_TOKEN_VALIDATOR, TerminalSessionService } from '../src/terminals/terminal-session.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { createRaceBarrier } from './support/serializable-race-barrier'
import { setTerminalUserPrintPrices } from './support/terminal-charge-fixture'

const API_ROOT = resolve(__dirname, '..')

function isPostgresUrl(url: string): boolean {
  return url.startsWith('postgresql://') || url.startsWith('postgres://')
}

function flatten(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = []
  for (const error of errors) {
    const label = parent ? `${parent}.${error.property}` : error.property
    if (error.constraints) out.push(...Object.values(error.constraints).map((item) => `${label}: ${item}`))
    if (error.children?.length) out.push(...flatten(error.children, label))
  }
  return out
}

function pass(label: string): void {
  console.log(`PASS ${label}`)
}

function sampleReport(): InterviewReportPayload {
  return {
    overall: { level: 'good', summary: '整体表达清晰，结合岗位要点展开，建议补充量化结果。' },
    expression: ['语言表达流畅，条理清楚。'],
    positionFit: ['对目标岗位核心职责理解准确。'],
    credibility: ['经历细节前后一致。'],
    professional: ['能结合场景给出基础排查思路。'],
    adaptability: ['面对追问能保持冷静作答。'],
    risks: ['项目成果缺少量化指标支撑。'],
    predictedQuestions: [{ question: '能举一个你解决突发问题的例子吗？', why: '考察实战复盘能力', approach: '按背景-任务-行动-结果拆解' }],
    starAdvice: { s: '交待业务背景', t: '明确个人目标', a: '聚焦关键动作', r: '补充可验证结果', reminder: '控制每题在 90 秒内' },
    checklist: ['准备 2 个量化项目案例', '梳理离职或转岗动机', '提前准备反问面试官的问题'],
  }
}

function pushSqlite(databaseUrl: string, databasePath: string): void {
  execFileSync(process.execPath, [
    join(API_ROOT, 'node_modules/prisma/build/index.js'),
    'db', 'push', '--url', databaseUrl, '--accept-data-loss',
  ], { cwd: API_ROOT, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' })
  const sql = readFileSync(join(API_ROOT, 'prisma/migrations/20261114170000_service_order_open_ref/migration.sql'), 'utf8')
  const match = sql.match(/CREATE UNIQUE INDEX "ServiceOrder_open_consumed_ref_key"[\s\S]*?;/)
  if (match) execFileSync('sqlite3', [databasePath], { input: match[0], encoding: 'utf8' })
}

async function main(): Promise<void> {
  // ── 0. 政策表纯函数断言 ────────────────────────────────────────────────
  assert.equal(classifyServiceOutcome('mock_interview', 'interview_opened'), 'made')
  assert.equal(classifyServiceOutcome('mock_interview', 'interview_followup_failed'), 'made')
  assert.equal(classifyServiceOutcome('mock_interview', 'interview_report_completed'), 'made')
  assert.equal(classifyServiceOutcome('mock_interview', 'interview_report_failed'), 'not_made')
  assert.equal(failureReasonFor('interview_report_failed'), '报告没生成')
  assert.equal(decideInterviewReportFailure({ serviceKey: 'mock_interview', status: 'consumed', settledAt: new Date(), reportState: null, sessionEnded: false }), 'enter_retry')
  assert.equal(decideInterviewReportFailure({ serviceKey: 'mock_interview', status: 'consumed', settledAt: new Date(), reportState: null, sessionEnded: true }), 'refund_left')
  assert.equal(decideInterviewReportFailure({ serviceKey: 'mock_interview', status: 'consumed', settledAt: new Date(), reportState: 'retry', sessionEnded: false }), 'refund_failed')
  assert.equal(decideInterviewReportFailure({ serviceKey: 'mock_interview', status: 'consumed', settledAt: new Date(), reportState: 'done', sessionEnded: false }), 'ignore')
  assert.equal(decideInterviewReportFailure({ serviceKey: 'mock_interview', status: 'refunded', settledAt: new Date(), reportState: 'retry', sessionEnded: false }), 'ignore')
  pass('判据集中落在 service-order.policy.ts')

  // ── 1. 隔离库准备（兼容 SQLite 与真 PostgreSQL）────────────────────────
  const envUrl = process.env['DATABASE_URL'] ?? ''
  const usePostgres = isPostgresUrl(envUrl)
  let sqliteDir: string | null = null
  if (usePostgres) {
    process.env['VERIFICATION_DATABASE_TARGET'] ||= 'isolated'
    assertIsolatedVerificationDatabase()
  } else {
    sqliteDir = mkdtempSync(join(tmpdir(), 'svc-iv-report-'))
    const dbPath = join(sqliteDir, 'verify.db')
    const dbUrl = `file:${dbPath}`
    process.env['DATABASE_URL'] = dbUrl
    process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
    assertIsolatedVerificationDatabase()
    closeSync(openSync(dbPath, 'wx'))
    pushSqlite(dbUrl, dbPath)
  }

  const runId = randomBytes(6).toString('hex')
  const termCharge = `term-ivr-chg-${runId}`
  const termFree = `term-ivr-free-${runId}`
  const createdSessions: string[] = []
  const store = new Map<string, string>()
  const redis = {
    async get(key: string) { return store.get(key) ?? null },
    async setEx(key: string, _ttl: number, value: string) { store.set(key, value) },
    async getDel(key: string) { const v = store.get(key) ?? null; store.delete(key); return v },
    async setJsonIfVersionNotOlder() { return 'ok' as const },
    async setIfAbsent(key: string, value: string) { if (store.has(key)) return false; store.set(key, value); return true },
    async del(key: string) { return store.delete(key) ? 1 : 0 },
  }

  const prisma = new PrismaService()
  if (usePostgres) assert.equal(prisma.dbKind, 'postgres', 'PostgreSQL 模式必须连真 PG 客户端')
  await prisma.onModuleInit()

  const audit = new AuditService(prisma)
  const sessions = new TerminalSessionService(redis as never, prisma, { async validateTerminalToken() {} })
  let refundCalls = 0
  let refundedOrderIds: string[] = []
  let refundDelayMs = 0
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
            refundedOrderIds.push(input.orderId)
            if (refundDelayMs > 0) await new Promise((r) => setTimeout(r, refundDelayMs))
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
  const online = new OnlinePaymentService(prisma, audit, {} as OrderStatusService, registry, redis as unknown as RedisService)
  const jwt = new JwtService({ secret: process.env['JWT_SECRET']! })

  let questionMode: 'ok' | 'fail' = 'ok'
  let reportMode: 'ok' | 'fail' | 'slow-fail' = 'ok'
  let reportCalls = 0
  const llm = {
    async nextQuestion() {
      if (questionMode === 'fail') {
        throw new ServiceUnavailableException({ error: { code: 'AI_INTERVIEW_QUESTION_FAILED', message: '面试问题生成失败' } })
      }
      return { greeting: '你好，开始今天的练习。', question: '请先做一段 1 分钟自我介绍。', qType: 'intro' }
    },
    async buildReport() {
      reportCalls += 1
      if (reportMode === 'slow-fail') {
        await new Promise((r) => setTimeout(r, 40))
        throw new ServiceUnavailableException({ error: { code: 'AI_INTERVIEW_REPORT_FAILED', message: '练习报告生成失败' } })
      }
      if (reportMode === 'fail') {
        throw new ServiceUnavailableException({ error: { code: 'AI_INTERVIEW_REPORT_FAILED', message: '练习报告生成失败' } })
      }
      return sampleReport()
    },
  } as unknown as MockInterviewLlmService

  const privacy = { async requireActiveConsent() {} } as unknown as MemberPrivacyService
  const aiLog = { record() {} } as unknown as AiLogService
  const makeInterviewService = () => new MockInterviewService(
    prisma,
    llm,
    {} as InterviewReportPdfService,
    {} as InterviewPracticeSheetPdfService,
    {} as FilesService,
    {} as ResumeExtractionService,
    audit,
    aiLog,
    privacy,
    undefined,
    undefined,
  )
  const interviewService = makeInterviewService()

  @Module({
    controllers: [
      ServiceOrderController,
      PaymentController,
      KioskSessionController,
      MockInterviewController,
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
      { provide: PAYMENT_PROVIDER_TOKEN, useValue: registry },
      { provide: PricingService, useValue: {} },
      { provide: RefundService, useValue: {} },
      { provide: MockInterviewService, useValue: interviewService },
      { provide: AsrService, useValue: { enabled: false } },
      { provide: TtsService, useValue: { enabled: false } },
      { provide: AiLogService, useValue: aiLog },
      { provide: InterviewTranscriptPrintService, useValue: {} },
      TerminalIdentityGuard,
    ],
  })
  class VerifyModule {}

  const app = await NestFactory.create(VerifyModule, { logger: false, abortOnError: false, bodyParser: false })
  try {
    installBodyParsers(app)
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const details = flatten(errors)
        return new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: details[0] ?? '参数错误', details } })
      },
    }))
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.listen(0, '127.0.0.1')
    const port = (app.getHttpServer().address() as AddressInfo).port
    const base = `http://127.0.0.1:${port}`

    async function call(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const json = (await res.json()) as { success?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } }
      return { status: res.status, json }
    }

    async function seedTerminal(id: string, code: string): Promise<string> {
      await prisma.terminal.create({
        data: { id, terminalCode: code, agentToken: `agent-${id}`, deviceFingerprint: `fp-${id}` },
      })
      const token = `tok-${id}`
      store.set(`term:session:${token}`, JSON.stringify({ terminalId: id, generation: 0, issuedAt: new Date().toISOString() }))
      return token
    }

    const chargeToken = await seedTerminal(termCharge, `IVR-CHG-${runId}`)
    const freeToken = await seedTerminal(termFree, `IVR-FREE-${runId}`)
    await setTerminalUserPrintPrices(prisma, termCharge, { resume_optimize: 0, mock_interview: 100, scan: 0, print_bw_page: 0, print_color_page: 0 })
    await setTerminalUserPrintPrices(prisma, termFree, { resume_optimize: 0, mock_interview: 0, scan: 0, print_bw_page: 0, print_color_page: 0 })

    const termHeaders = (terminalId: string, token: string, kioskSessionId?: string, orderId?: string): Record<string, string> => ({
      'x-terminal-id': terminalId,
      'x-terminal-session-token': token,
      ...(kioskSessionId ? { 'x-kiosk-session-id': kioskSessionId } : {}),
      ...(orderId ? { 'x-service-order-id': orderId } : {}),
    })

    async function openKiosk(terminalId: string, token: string): Promise<string> {
      const id = randomUUID()
      const res = await call('POST', '/api/v1/kiosk/session/start', {
        clientSessionId: id, wokeAt: new Date().toISOString(), category: 'interview',
      }, termHeaders(terminalId, token))
      assert.equal(res.status, 200, `开会话应 200，实际 ${res.status} ${JSON.stringify(res.json)}`)
      return id
    }

    async function endKiosk(terminalId: string, token: string, clientSessionId: string) {
      const res = await call('POST', '/api/v1/kiosk/session/end', {
        clientSessionId, endedAt: new Date().toISOString(), endReason: 'user_exit',
      }, termHeaders(terminalId, token))
      assert.equal(res.status, 200)
    }

    const callbackPath = buildPaymentCallbackPath('sandbox')
    async function paidOrder(kioskSessionId: string): Promise<string> {
      const made = await call('POST', '/api/v1/kiosk/service-orders', {
        serviceKey: 'mock_interview', kioskSessionId,
      }, termHeaders(termCharge, chargeToken))
      assert.equal(made.status, 200)
      const id = String(made.json.data?.['id'])
      const row = await prisma.serviceOrder.findUniqueOrThrow({ where: { id } })
      const packed = sandbox.buildSimulatedCallback({
        path: callbackPath,
        attemptId: row.providerOrderNo,
        prepayId: row.prepayId ?? 'prepay',
        orderId: row.id,
        amountCents: row.amountCents,
        result: 'success',
        channelTxnNo: `txn-${runId}-${randomUUID().slice(0, 8)}`,
      })
      const cb = await fetch(`${base}${callbackPath}`, { method: 'POST', headers: packed.headers, body: new Uint8Array(packed.rawBody) })
      assert.equal(cb.status, 200)
      return id
    }

    async function createAndAnswerInterview(opts: { terminalId: string; token: string; kioskSessionId?: string; orderId?: string; answer?: boolean }) {
      const created = await call('POST', '/api/v1/mock-interviews', {
        interviewerType: 'hr', industry: '互联网', position: '产品经理', experience: 'y1_3', difficulty: 'standard', durationMin: 3,
      }, termHeaders(opts.terminalId, opts.token))
      assert.equal(created.status, 201)
      const sessionId = String(created.json.data?.['sessionId'])
      const accessToken = String(created.json.data?.['accessToken'])
      createdSessions.push(sessionId)
      const startRes = await call('POST', `/api/v1/mock-interviews/${sessionId}/start`, { hardDeadline: true }, {
        ...termHeaders(opts.terminalId, opts.token, opts.kioskSessionId, opts.orderId),
        'x-interview-access-token': accessToken,
      })
      assert.equal(startRes.status, 201, `开场应成功，实际 ${startRes.status} ${JSON.stringify(startRes.json)}`)
      if (opts.answer !== false) {
        const ans = await call('POST', `/api/v1/mock-interviews/${sessionId}/answer`, { answer: '我有三年产品经验，负责需求梳理与数据复盘。' }, {
          ...termHeaders(opts.terminalId, opts.token),
          'x-interview-access-token': accessToken,
        })
        assert.equal(ans.status, 201)
      }
      return { sessionId, accessToken }
    }

    const endInterview = (sessionId: string, accessToken: string, terminalId = termCharge, token = chargeToken) =>
      call('POST', `/api/v1/mock-interviews/${sessionId}/end`, {}, {
        ...termHeaders(terminalId, token),
        'x-interview-access-token': accessToken,
      })

    const loadOrder = (id: string) => prisma.serviceOrder.findUniqueOrThrow({ where: { id } })

    // ── Case 1: 开场后出报告成功 → 不退 ────────────────────────────────────
    {
      refundCalls = 0
      reportMode = 'ok'
      const ks = await openKiosk(termCharge, chargeToken)
      const orderId = await paidOrder(ks)
      const iv = await createAndAnswerInterview({ terminalId: termCharge, token: chargeToken, kioskSessionId: ks, orderId })
      const ended = await endInterview(iv.sessionId, iv.accessToken)
      assert.equal(ended.status, 201)
      const row = await loadOrder(orderId)
      assert.equal(row.status, 'consumed')
      assert.equal(row.reportState, 'done')
      assert.equal(row.failureReason, null)
      assert.equal(row.retryUntil, null)
      await endKiosk(termCharge, chargeToken, ks)
      await serviceOrders.sweep(new Date(Date.now() + 60 * 60_000))
      const after = await loadOrder(orderId)
      assert.equal(after.status, 'consumed')
      assert.equal(after.reportState, 'done')
      assert.equal(refundCalls, 0)
      pass('Case 1: 开场后出报告成功 → 做成不退（离场与清扫均不退）')
    }

    // ── Case 2 & 3: 首次失败 → 进免费再试、单不可开新场、无回答不误触；再试成功 → 做成不退
    {
      refundCalls = 0
      const ks = await openKiosk(termCharge, chargeToken)
      const orderId = await paidOrder(ks)
      // 先验证未作答（INTERVIEW_NO_ANSWERS）不算系统报告失败
      const ivNoAns = await createAndAnswerInterview({ terminalId: termCharge, token: chargeToken, kioskSessionId: ks, orderId, answer: false })
      const noAnsEnd = await endInterview(ivNoAns.sessionId, ivNoAns.accessToken)
      assert.equal(noAnsEnd.status, 400)
      assert.equal(noAnsEnd.json.error?.code, 'INTERVIEW_NO_ANSWERS')
      const afterNoAns = await loadOrder(orderId)
      assert.equal(afterNoAns.status, 'consumed')
      assert.equal(afterNoAns.reportState, null, '用户未作答不算系统报告失败')
      assert.equal(afterNoAns.retryUntil, null)

      // 回答一题后首次出报告模型失败
      const ans = await call('POST', `/api/v1/mock-interviews/${ivNoAns.sessionId}/answer`, { answer: '我擅长跨团队协作和数据分析。' }, {
        ...termHeaders(termCharge, chargeToken),
        'x-interview-access-token': ivNoAns.accessToken,
      })
      assert.equal(ans.status, 201)
      reportMode = 'fail'
      const tBefore = Date.now()
      const firstFail = await endInterview(ivNoAns.sessionId, ivNoAns.accessToken)
      assert.equal(firstFail.status, 503)
      const afterFail1 = await loadOrder(orderId)
      assert.equal(afterFail1.status, 'consumed', '报告失败后单留在 consumed，不回 paid')
      assert.equal(afterFail1.reportState, 'retry')
      assert.equal(afterFail1.failureReason, '报告没生成')
      assert.ok(afterFail1.retryUntil, '应写下 10 分钟再试窗口')
      const delta = afterFail1.retryUntil.getTime() - tBefore
      assert.ok(delta >= SERVICE_RETRY_WINDOW_MS - 5_000 && delta <= SERVICE_RETRY_WINDOW_MS + 10_000)
      assert.equal(refundCalls, 0)

      // 同一单不能被拿去开一场新面试（需求 1e）
      const otherIv = await call('POST', '/api/v1/mock-interviews', {
        interviewerType: 'hr', industry: '互联网', position: '运营', experience: 'y1_3', difficulty: 'standard', durationMin: 3,
      }, termHeaders(termCharge, chargeToken))
      const otherId = String(otherIv.json.data?.['sessionId'])
      const otherTok = String(otherIv.json.data?.['accessToken'])
      createdSessions.push(otherId)
      const hijack = await call('POST', `/api/v1/mock-interviews/${otherId}/start`, {}, {
        ...termHeaders(termCharge, chargeToken, ks, orderId),
        'x-interview-access-token': otherTok,
      })
      assert.equal(hijack.status, 409, '报告再试中的单绝不能被新开场认领')
      assert.equal(hijack.json.error?.code, 'SERVICE_ORDER_IN_USE')

      // 另一张新付单也不能把这场顶替掉（ref.ts 不打架）
      const otherOrderId = await paidOrder(ks)
      await prisma.mockInterviewTurn.deleteMany({ where: { sessionId: ivNoAns.sessionId } })
      await prisma.mockInterviewSession.update({ where: { id: ivNoAns.sessionId }, data: { status: 'configured' } })
      const displace = await call('POST', `/api/v1/mock-interviews/${ivNoAns.sessionId}/start`, {}, {
        ...termHeaders(termCharge, chargeToken, ks, otherOrderId),
        'x-interview-access-token': ivNoAns.accessToken,
      })
      assert.equal(displace.status, 409, '已有已结案开场单的场次不得被新单顶替')
      assert.equal(displace.json.error?.code, 'SERVICE_ORDER_REF_OCCUPIED')
      // 恢复场次状态以便继续测再试成功
      await prisma.mockInterviewSession.update({ where: { id: ivNoAns.sessionId }, data: { status: 'in_progress' } })
      await prisma.mockInterviewTurn.createMany({
        data: [
          { sessionId: ivNoAns.sessionId, idx: 0, role: 'interviewer', qType: 'intro', content: '请自我介绍' },
          { sessionId: ivNoAns.sessionId, idx: 1, role: 'candidate', content: '我擅长数据分析', skipped: false },
        ],
      })
      // 把测试用的 otherOrderId 退掉免得干扰后续清扫
      await executeServiceOrderRefund(prisma, registry, audit, redis as never, otherOrderId, '测试清理')
      refundCalls = 0

      // 窗口内再试出报告成功（不收钱）→ 做成不退
      reportMode = 'ok'
      const retryOk = await endInterview(ivNoAns.sessionId, ivNoAns.accessToken)
      assert.equal(retryOk.status, 201)
      const afterOk = await loadOrder(orderId)
      assert.equal(afterOk.status, 'consumed')
      assert.equal(afterOk.reportState, 'done')
      assert.equal(afterOk.failureReason, null)
      assert.equal(afterOk.retryUntil, null)
      await serviceOrders.sweep(new Date(Date.now() + 60 * 60_000))
      await endKiosk(termCharge, chargeToken, ks)
      assert.equal((await loadOrder(orderId)).status, 'consumed')
      assert.equal(refundCalls, 0)
      pass('Case 2 & 3: 首次失败进免费再试且不可开新场/不可顶替，再试成功做成不退')
    }

    // ── Case 4: 再试仍失败 → 退一次且只一次；退后再出报告不倒回做成 ─────────
    {
      refundCalls = 0
      reportMode = 'fail'
      const ks = await openKiosk(termCharge, chargeToken)
      const orderId = await paidOrder(ks)
      const iv = await createAndAnswerInterview({ terminalId: termCharge, token: chargeToken, kioskSessionId: ks, orderId })
      assert.equal((await endInterview(iv.sessionId, iv.accessToken)).status, 503)
      assert.equal((await loadOrder(orderId)).reportState, 'retry')
      assert.equal(refundCalls, 0)

      assert.equal((await endInterview(iv.sessionId, iv.accessToken)).status, 503)
      const refunded = await loadOrder(orderId)
      assert.equal(refunded.status, 'refunded')
      assert.equal(refunded.refundReason, SERVICE_REFUND_REASON_REPORT_FAILED)
      assert.ok(refunded.refundedAt)
      assert.equal(refundCalls, 1)
      const auditRow = await prisma.auditLog.findFirst({ where: { targetId: orderId, action: 'service_order.refunded' } })
      assert.ok(auditRow, '自动退款必须落审计')

      // 退完后再调用 end 成功，绝不能把 refunded 改回 consumed / done
      reportMode = 'ok'
      assert.equal((await endInterview(iv.sessionId, iv.accessToken)).status, 201)
      const afterLateReport = await loadOrder(orderId)
      assert.equal(afterLateReport.status, 'refunded', '已退款的单绝不因后续出报告倒回做成')
      assert.notEqual(afterLateReport.reportState, 'done')
      assert.equal(refundCalls, 1)
      pass('Case 4: 再试仍失败退一次且只一次，退后再出报告不倒回做成')
    }

    // ── Case 5: 窗口过期清扫 → 退 ──────────────────────────────────────────
    {
      refundCalls = 0
      reportMode = 'fail'
      const ks = await openKiosk(termCharge, chargeToken)
      const orderId = await paidOrder(ks)
      const iv = await createAndAnswerInterview({ terminalId: termCharge, token: chargeToken, kioskSessionId: ks, orderId })
      assert.equal((await endInterview(iv.sessionId, iv.accessToken)).status, 503)
      assert.equal((await loadOrder(orderId)).reportState, 'retry')
      // 窗口未过期清扫不退
      await serviceOrders.sweep(new Date(Date.now() + 2 * 60_000))
      assert.equal((await loadOrder(orderId)).status, 'consumed')
      assert.equal(refundCalls, 0)
      // 窗口过期清扫自动退
      await serviceOrders.sweep(new Date(Date.now() + SERVICE_RETRY_WINDOW_MS + 60_000))
      const swept = await loadOrder(orderId)
      assert.equal(swept.status, 'refunded')
      assert.equal(swept.refundReason, SERVICE_REFUND_REASON_RETRY_EXPIRED)
      assert.equal(refundCalls, 1)
      pass('Case 5: 再试窗口过期清扫自动退')
    }

    // ── Case 6: 会话结束（onSessionEnded）→ 退 ──────────────────────────────
    {
      refundCalls = 0
      reportMode = 'fail'
      const ks = await openKiosk(termCharge, chargeToken)
      const orderId = await paidOrder(ks)
      const iv = await createAndAnswerInterview({ terminalId: termCharge, token: chargeToken, kioskSessionId: ks, orderId })
      assert.equal((await endInterview(iv.sessionId, iv.accessToken)).status, 503)
      assert.equal((await loadOrder(orderId)).reportState, 'retry')
      assert.equal(refundCalls, 0)

      await endKiosk(termCharge, chargeToken, ks)
      const left = await loadOrder(orderId)
      assert.equal(left.status, 'refunded')
      assert.equal(left.refundReason, SERVICE_REFUND_REASON_REPORT_LEFT)
      assert.equal(refundCalls, 1)
      pass('Case 6: 会话结束自动退')
    }

    // ── Case 7: 开场后从不出报告就离开 → 不退；开场重试过（attemptsUsed=2）后首次报告失败仍给再试
    {
      refundCalls = 0
      const ks = await openKiosk(termCharge, chargeToken)
      const orderId = await paidOrder(ks)
      await createAndAnswerInterview({ terminalId: termCharge, token: chargeToken, kioskSessionId: ks, orderId })
      await endKiosk(termCharge, chargeToken, ks)
      await serviceOrders.sweep(new Date(Date.now() + 60 * 60_000))
      const row = await loadOrder(orderId)
      assert.equal(row.status, 'consumed', '开场后从不出报告就离开，绝不退')
      assert.equal(row.reportState, null)
      assert.equal(refundCalls, 0)

      // 开场首次失败 → 重试开场成功（attemptsUsed=2）→ 首次报告失败仍进 10 分钟再试
      const ks2 = await openKiosk(termCharge, chargeToken)
      const order2 = await paidOrder(ks2)
      const iv2Created = await call('POST', '/api/v1/mock-interviews', {
        interviewerType: 'hr', industry: '互联网', position: '产品', experience: 'y1_3', difficulty: 'standard', durationMin: 3,
      }, termHeaders(termCharge, chargeToken))
      const iv2Id = String(iv2Created.json.data?.['sessionId'])
      const iv2Tok = String(iv2Created.json.data?.['accessToken'])
      createdSessions.push(iv2Id)
      questionMode = 'fail'
      const startFail = await call('POST', `/api/v1/mock-interviews/${iv2Id}/start`, {}, {
        ...termHeaders(termCharge, chargeToken, ks2, order2),
        'x-interview-access-token': iv2Tok,
      })
      assert.equal(startFail.status, 503)
      assert.equal((await loadOrder(order2)).status, 'paid')
      assert.equal((await loadOrder(order2)).attemptsUsed, 1)
      questionMode = 'ok'
      const startOk = await call('POST', `/api/v1/mock-interviews/${iv2Id}/start`, {}, {
        ...termHeaders(termCharge, chargeToken, ks2, order2),
        'x-interview-access-token': iv2Tok,
      })
      assert.equal(startOk.status, 201)
      assert.equal((await loadOrder(order2)).attemptsUsed, 2)
      await call('POST', `/api/v1/mock-interviews/${iv2Id}/answer`, { answer: '回答一条。' }, {
        ...termHeaders(termCharge, chargeToken),
        'x-interview-access-token': iv2Tok,
      })
      reportMode = 'fail'
      assert.equal((await endInterview(iv2Id, iv2Tok)).status, 503)
      const afterIv2Fail1 = await loadOrder(order2)
      assert.equal(afterIv2Fail1.status, 'consumed', '开场重试过的场次，首次报告失败仍应给免费再试')
      assert.equal(afterIv2Fail1.reportState, 'retry')
      assert.equal(refundCalls, 0)
      reportMode = 'ok'
      assert.equal((await endInterview(iv2Id, iv2Tok)).status, 201)
      assert.equal((await loadOrder(order2)).reportState, 'done')
      pass('Case 7: 开场后不出报告就离开不退；开场重试过仍给首次报告免费再试')
    }

    // ── Case 8: 报告落库失败 → 同样算系统原因进再试与退款 ──────────────────
    {
      refundCalls = 0
      reportMode = 'ok'
      const ks = await openKiosk(termCharge, chargeToken)
      const orderId = await paidOrder(ks)
      const iv = await createAndAnswerInterview({ terminalId: termCharge, token: chargeToken, kioskSessionId: ks, orderId })
      const origCreate = prisma.mockInterviewReport.create.bind(prisma.mockInterviewReport)
      let failWrites = 2
      prisma.mockInterviewReport.create = (async (...args: Parameters<typeof origCreate>) => {
        if (failWrites > 0) {
          failWrites -= 1
          throw new Error('simulated_db_write_failure')
        }
        return origCreate(...args)
      }) as typeof origCreate
      try {
        assert.equal((await endInterview(iv.sessionId, iv.accessToken)).status, 500)
        const afterDb1 = await loadOrder(orderId)
        assert.equal(afterDb1.status, 'consumed')
        assert.equal(afterDb1.reportState, 'retry')
        assert.equal(refundCalls, 0)

        assert.equal((await endInterview(iv.sessionId, iv.accessToken)).status, 500)
        const afterDb2 = await loadOrder(orderId)
        assert.equal(afterDb2.status, 'refunded')
        assert.equal(refundCalls, 1)
      } finally {
        prisma.mockInterviewReport.create = origCreate
      }
      pass('Case 8: 报告落库失败进入再试与自动退')
    }

    // ── Case 9: 并发测试（同实例合并、并发两次 end + 清扫只退一次、做成后不退）
    {
      // 9a: 同实例连点两次首次 end 失败 → 合并只进 retry，不直接退
      refundCalls = 0
      reportCalls = 0
      reportMode = 'slow-fail'
      const ks9a = await openKiosk(termCharge, chargeToken)
      const order9a = await paidOrder(ks9a)
      const iv9a = await createAndAnswerInterview({ terminalId: termCharge, token: chargeToken, kioskSessionId: ks9a, orderId: order9a })
      const [r1, r2] = await Promise.all([endInterview(iv9a.sessionId, iv9a.accessToken), endInterview(iv9a.sessionId, iv9a.accessToken)])
      assert.equal(r1.status, 503)
      assert.equal(r2.status, 503)
      assert.equal(reportCalls, 1, '同实例并发首次 end 应被锁合并只调一次模型')
      assert.equal((await loadOrder(order9a)).status, 'consumed')
      assert.equal((await loadOrder(order9a)).reportState, 'retry')
      assert.equal(refundCalls, 0)
      reportMode = 'ok'
      assert.equal((await endInterview(iv9a.sessionId, iv9a.accessToken)).status, 201)
      assert.equal((await loadOrder(order9a)).reportState, 'done')

      // 9b: 已在 retry + 窗口到期，两个独立服务实例的 end 失败 + sweep 同时撞同一单 → 只退一次
      refundCalls = 0
      refundedOrderIds = []
      refundDelayMs = 40
      reportMode = 'fail'
      const ks9b = await openKiosk(termCharge, chargeToken)
      const order9b = await paidOrder(ks9b)
      const iv9b = await createAndAnswerInterview({ terminalId: termCharge, token: chargeToken, kioskSessionId: ks9b, orderId: order9b })
      assert.equal((await endInterview(iv9b.sessionId, iv9b.accessToken)).status, 503)
      assert.equal((await loadOrder(order9b)).reportState, 'retry')
      // 把窗口拨到已过期，让 sweep 与两路并发 end 同时抢退；用 slow-fail 确保两路独立实例都进入 buildReport → onReportFailed
      await prisma.serviceOrder.update({ where: { id: order9b }, data: { retryUntil: new Date(Date.now() - 10_000) } })
      reportMode = 'slow-fail'

      const svcA = makeInterviewService()
      const svcB = makeInterviewService()
      const barrier = createRaceBarrier(3)
      const requester = { endUserId: null, accessToken: iv9b.accessToken }
      // 在 claimRefund 的 updateMany 前对齐三路（两路并发 end + 一路清扫）：
      // 三路都已读到 status='consumed' / reportState='retry' 后同时起跑，真正撞向条件 updateMany 门闩。
      const origUpdateMany = prisma.serviceOrder.updateMany.bind(prisma.serviceOrder)
      prisma.serviceOrder.updateMany = (async (args: Parameters<typeof origUpdateMany>[0]) => {
        const w = (args as { where?: { id?: unknown }; data?: { status?: unknown } })?.where
        const d = (args as { where?: { id?: unknown }; data?: { status?: unknown } })?.data
        if (w?.id === order9b && d?.status === 'refunding') {
          await barrier.wait()
        }
        return origUpdateMany(args)
      }) as typeof origUpdateMany
      const runEndFail = async (svc: MockInterviewService) => {
        await svc.end(iv9b.sessionId, requester, {
          onReportMade: () => serviceOrders.noteInterviewReportMade(iv9b.sessionId),
          onReportFailed: () => serviceOrders.noteInterviewReportFailed(iv9b.sessionId),
        }).catch(() => undefined)
      }
      const runSweep = async () => {
        await serviceOrders.sweep(new Date())
      }
      try {
        await Promise.all([runEndFail(svcA), runEndFail(svcB), runSweep()])
      } finally {
        prisma.serviceOrder.updateMany = origUpdateMany
      }
      assert.equal(barrier.timedOut, false, '三路并发必须真正同时撞到 claimRefund')
      assert.equal(refundCalls, 1, `并发两次 end + 清扫必须只调渠道退款 1 次，实际 ${refundCalls}`)
      assert.deepEqual(refundedOrderIds, [order9b])
      assert.equal((await loadOrder(order9b)).status, 'refunded')
      refundDelayMs = 0

      // 9c: 做成之后绝不再退（并发做成 vs 清扫 + 已 done 后直接退款/清扫/失败均跳过）
      refundCalls = 0
      refundedOrderIds = []
      const ks9c = await openKiosk(termCharge, chargeToken)
      const order9c = await paidOrder(ks9c)
      const iv9c = await createAndAnswerInterview({ terminalId: termCharge, token: chargeToken, kioskSessionId: ks9c, orderId: order9c })
      reportMode = 'fail'
      assert.equal((await endInterview(iv9c.sessionId, iv9c.accessToken)).status, 503)
      reportMode = 'ok'
      assert.equal((await endInterview(iv9c.sessionId, iv9c.accessToken)).status, 201)
      assert.equal((await loadOrder(order9c)).reportState, 'done')
      await serviceOrders.noteInterviewReportFailed(iv9c.sessionId)
      const directAttempt = await executeServiceOrderRefund(prisma, registry, audit, redis as never, order9c, '误退测试')
      assert.equal(directAttempt, 'skipped', '已做成（reportState=done）的单调用退款必须跳过')
      await serviceOrders.sweep(new Date(Date.now() + 60 * 60_000))
      await endKiosk(termCharge, chargeToken, ks9c)
      assert.equal((await loadOrder(order9c)).status, 'consumed')
      assert.equal((await loadOrder(order9c)).reportState, 'done')
      assert.equal(refundCalls, 0)
      assert.equal(refundedOrderIds.filter((id) => id === order9c).length, 0)
      pass('Case 9: 并发两次 end + 清扫只退一次；做成后绝不再退；退后不倒回做成')
    }

    // ── Case 10: 免费机器（无服务单）→ 完全不碰 ─────────────────────────────
    {
      refundCalls = 0
      reportMode = 'fail'
      const ksFree = await openKiosk(termFree, freeToken)
      const ivFree = await createAndAnswerInterview({ terminalId: termFree, token: freeToken, kioskSessionId: ksFree })
      assert.equal((await endInterview(ivFree.sessionId, ivFree.accessToken, termFree, freeToken)).status, 503)
      assert.equal((await endInterview(ivFree.sessionId, ivFree.accessToken, termFree, freeToken)).status, 503)
      await endKiosk(termFree, freeToken, ksFree)
      await serviceOrders.sweep(new Date(Date.now() + 60 * 60_000))
      const freeOrders = await prisma.serviceOrder.count({ where: { terminalId: termFree } })
      assert.equal(freeOrders, 0)
      assert.equal(refundCalls, 0)
      pass('Case 10: 免费机器完全不碰，行为与原来一致')
    }

    pass(`模拟面试报告失败免费再试与自动退款全部通过 (${usePostgres ? 'PostgreSQL' : 'SQLite'})`)
  } finally {
    await app.close().catch(() => undefined)
    // 清理本轮数据（PG 隔离库不留脏数据）
    await prisma.mockInterviewSession.deleteMany({ where: { id: { in: createdSessions } } }).catch(() => undefined)
    await prisma.serviceOrder.deleteMany({ where: { terminalId: { in: [termCharge, termFree] } } }).catch(() => undefined)
    await prisma.kioskSession.deleteMany({ where: { terminalId: { in: [termCharge, termFree] } } }).catch(() => undefined)
    await prisma.terminalServicePrice.deleteMany({ where: { terminalId: { in: [termCharge, termFree] } } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: { in: [termCharge, termFree] } } }).catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
    if (sqliteDir) rmSync(sqliteDir, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
