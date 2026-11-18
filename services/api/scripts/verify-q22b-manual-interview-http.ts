/**
 * 题目单手动退路穿过真实全局守卫。
 *
 * 建配置、取题目单不调模型。四种 AI 不可用（模型没配、全站暂停、预算耗尽、平台没开通）
 * 这两条都要进处理函数并成功；开场仍拒绝。另有本机供应商替身下开场成功的正向对照。
 *
 * 由 verify:ai-availability-alignment 调用，因此进 CI。不占固定端口。
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { Logger, Module, ValidationPipe, type INestApplication } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { AiAccessGuard } from '../src/ai-access/ai-access.guard'
import { AiAccessService } from '../src/ai-access/ai-access.service'
import { LlmConfigService } from '../src/ai/llm/llm-config.service'
import { AiLogService } from '../src/ai/ai-log.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { PrismaService } from '../src/prisma/prisma.service'
import { RedisService } from '../src/common/redis/redis.service'
import { AsrService } from '../src/mock-interview/asr/asr.service'
import { TtsService } from '../src/mock-interview/asr/tts.service'
import { MockInterviewAvailability } from '../src/mock-interview/mock-interview-availability.service'
import { MockInterviewController } from '../src/mock-interview/mock-interview.controller'
import { MockInterviewLlmService } from '../src/mock-interview/mock-interview-llm.service'
import { MockInterviewService } from '../src/mock-interview/mock-interview.service'
import { InterviewTranscriptPrintService } from '../src/mock-interview/interview-transcript-print.service'

const CREATE_BODY = {
  interviewerType: 'hr',
  industry: '制造业',
  position: '质检',
  experience: 'y1_3',
  difficulty: 'standard',
  durationMin: 5,
}

const QUESTION = '请介绍一下你的项目经历。'
const GREETING = '你好，我们开始练习。'

interface HttpBody {
  success?: boolean
  data?: Record<string, unknown>
  error?: { code?: string; message?: string }
}

export interface Q22bManualInterviewDeps {
  access: AiAccessService
  llm: LlmConfigService
  store: Map<string, string>
  setBudgetExhausted: (value: boolean) => void
}

class CountingAvailability extends MockInterviewAvailability {
  calls = 0
  override refusal() {
    this.calls += 1
    return super.refusal()
  }
}

function setFlags(store: Map<string, string>, access: AiAccessService, paused: boolean): void {
  store.set('system:ai-access:loginGate', 'off')
  store.set('system:ai-access:declarationEnforced', 'off')
  store.set('system:ai-access:paused', paused ? 'on' : 'off')
  store.set('system:ai-access:maintenance', 'off')
  access.clearCache()
}

async function post(base: string, path: string, json?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: HttpBody }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { ...(json === undefined ? {} : { 'content-type': 'application/json' }), ...(headers ?? {}) },
    body: json === undefined ? undefined : JSON.stringify(json),
  })
  const text = await res.text()
  let body: HttpBody = {}
  try { body = text ? JSON.parse(text) as HttpBody : {} } catch { body = { error: { message: text } } }
  return { status: res.status, body }
}

export async function runQ22bManualInterviewHttp(deps: Q22bManualInterviewDeps): Promise<void> {
  const { access, llm, store, setBudgetExhausted } = deps
  const savedNode = process.env['NODE_ENV']
  const savedProvider = process.env['AI_PROVIDER']
  let app: INestApplication | undefined
  let stub: Server | undefined
  const calls = { create: 0, sheet: 0, start: 0 }
  let live = false
  let stubHits = 0
  const opening = new CountingAvailability(access, llm)
  const sessions = new Map<string, string>()

  @Module({
    controllers: [MockInterviewController],
    providers: [
      { provide: PrismaService, useValue: {} },
      { provide: RedisService, useValue: { get: async (key: string) => store.get(key) ?? null, setEx: async (key: string, _ttl: number, value: string) => { store.set(key, value) }, del: async (key: string) => { store.delete(key); return 1 } } },
      { provide: JwtService, useValue: {} },
      { provide: AiLogService, useValue: {} },
      { provide: MockInterviewService, useValue: {
        createSession: async () => {
          calls.create += 1
          const sessionId = `q22b-${calls.create}`
          const accessToken = `tok-${calls.create}`
          sessions.set(sessionId, accessToken)
          return { sessionId, accessToken, questionTarget: 6 }
        },
        printPracticeSheet: async (id: string) => {
          calls.sheet += 1
          assert.ok(sessions.has(id), '题目单应接到刚建的配置')
          return { printFileUrl: `https://files.invalid/sheet-${id}.pdf`, variant: 'degraded' }
        },
        hasInterviewerTurn: async () => false,
        start: async () => {
          calls.start += 1
          assert.equal(live, true, '开场处理函数只应在正向对照里被进入')
          const out = await new MockInterviewLlmService(llm).nextQuestion({
            interviewerType: 'hr',
            industry: '制造业',
            position: '质检',
            experience: 'y1_3',
            difficulty: 'standard',
            questionTarget: 6,
            askedCount: 0,
            resumeDigest: null,
            transcript: [],
          })
          return { question: out.question, greeting: out.greeting }
        },
      } },
      { provide: AsrService, useValue: {} },
      { provide: TtsService, useValue: {} },
      { provide: InterviewTranscriptPrintService, useValue: {} },
      { provide: AiAccessService, useValue: access },
      { provide: MockInterviewAvailability, useValue: opening },
      AiAccessGuard,
      { provide: APP_GUARD, useExisting: AiAccessGuard },
    ],
  })
  class Q22bHttpModule {}

  const restoreEnv = () => {
    if (savedNode === undefined) delete process.env['NODE_ENV']
    else process.env['NODE_ENV'] = savedNode
    if (savedProvider === undefined) delete process.env['AI_PROVIDER']
    else process.env['AI_PROVIDER'] = savedProvider
    access.clearCache()
  }

  try {
    Logger.overrideLogger(false)
    app = await NestFactory.create(Q22bHttpModule, { abortOnError: false, logger: false })
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address()
    assert.ok(address && typeof address !== 'string', '无法取得监听地址')
    const base = `http://127.0.0.1:${address.port}/api/v1`

    const manual = async (label: string, startCode: string) => {
      const before = { ...calls }
      const refusalBefore = opening.calls
      const created = await post(base, '/mock-interviews', CREATE_BODY)
      assert.equal(created.status, 201, `${label} 建配置应成功，实际 ${created.status} ${JSON.stringify(created.body)}`)
      assert.equal(created.body.success, true, `${label} 建配置成功体`)
      const sessionId = String(created.body.data?.['sessionId'] ?? '')
      const token = String(created.body.data?.['accessToken'] ?? '')
      assert.ok(sessionId && token, `${label} 建配置应返回会话号和令牌`)
      assert.equal(calls.create, before.create + 1, `${label} 建配置应进入处理函数`)
      const sheet = await post(base, `/mock-interviews/${sessionId}/practice-sheet`, undefined, { 'x-interview-access-token': token })
      assert.equal(sheet.status, 201, `${label} 题目单应成功，实际 ${sheet.status} ${JSON.stringify(sheet.body)}`)
      assert.equal(sheet.body.success, true)
      assert.equal(sheet.body.data?.['variant'], 'degraded', `${label} 题目单应是不调模型的降级单`)
      assert.equal(typeof sheet.body.data?.['printFileUrl'], 'string', `${label} 题目单应给出打印地址`)
      assert.equal(calls.sheet, before.sheet + 1, `${label} 题目单应进入处理函数`)
      const started = await post(base, `/mock-interviews/${sessionId}/start`, {}, { 'x-interview-access-token': token })
      assert.equal(started.status, 503, `${label} 开场应拒绝，实际 ${started.status} ${JSON.stringify(started.body)}`)
      assert.equal(started.body.error?.code, startCode, `${label} 开场拒绝码`)
      assert.equal(calls.start, before.start, `${label} 开场不得进入出题`)
      if (startCode === 'AI_NOT_CONFIGURED') {
        assert.equal(opening.calls, refusalBefore + 1, `${label} 守卫应放行到开场里的模型位判断`)
      } else {
        assert.equal(opening.calls, refusalBefore, `${label} 应由全局守卫拦住，而不是进到开场判断`)
      }
      console.log(`  PASS 题目单手动退路 ${label}`)
    }

    process.env['NODE_ENV'] = 'test'
    process.env['AI_PROVIDER'] = 'llm'
    setBudgetExhausted(false)
    setFlags(store, access, false)
    llm.update({ enabled: false }, 'mock_interview')
    await manual('只是模型没配', 'AI_NOT_CONFIGURED')

    llm.update({ enabled: true, apiKey: 'sk-q22b-interview-not-real' }, 'mock_interview')
    setFlags(store, access, true)
    await manual('全站暂停', 'AI_PAUSED')

    setFlags(store, access, false)
    setBudgetExhausted(true)
    await manual('预算耗尽', 'AI_BUDGET_EXHAUSTED')

    setBudgetExhausted(false)
    setFlags(store, access, false)
    process.env['NODE_ENV'] = 'production'
    process.env['AI_PROVIDER'] = 'mock'
    access.clearCache()
    await manual('平台没开通', 'AI_PROVIDER_NOT_CONFIGURED')

    process.env['NODE_ENV'] = 'test'
    process.env['AI_PROVIDER'] = 'llm'
    access.clearCache()
    stubHits = 0
    stub = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        stubHits += 1
        const content = JSON.stringify({ question: QUESTION, qType: 'intro', greeting: GREETING })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content } }] }))
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => stub!.listen(0, '127.0.0.1', () => resolve()))
    const stubAddr = stub.address()
    assert.ok(stubAddr && typeof stubAddr !== 'string')
    llm.update({
      enabled: true,
      apiKey: 'sk-q22b-live-not-real',
      baseURL: `http://127.0.0.1:${stubAddr.port}/v1`,
    }, 'mock_interview')
    setFlags(store, access, false)
    setBudgetExhausted(false)
    live = true
    const before = { ...calls }
    const created = await post(base, '/mock-interviews', CREATE_BODY)
    assert.equal(created.status, 201, `正向对照建配置 ${created.status} ${JSON.stringify(created.body)}`)
    const sessionId = String(created.body.data?.['sessionId'] ?? '')
    const token = String(created.body.data?.['accessToken'] ?? '')
    const started = await post(base, `/mock-interviews/${sessionId}/start`, {}, { 'x-interview-access-token': token })
    assert.equal(started.status, 201, `正向对照开场应成功，实际 ${started.status} ${JSON.stringify(started.body)}`)
    assert.equal(started.body.data?.['question'], QUESTION, '开场应返回替身题目')
    assert.equal(started.body.data?.['greeting'], GREETING)
    assert.equal(calls.start, before.start + 1, '正向对照应进入开场处理函数')
    assert.equal(stubHits, 1, '供应商替身应被真实 nextQuestion 打到一次')
    console.log('  PASS 题目单手动退路 供应商替身下 AI 正常')

    const controller = readFileSync(join(__dirname, '../src/mock-interview/mock-interview.controller.ts'), 'utf8')
    const createBlock = controller.slice(controller.indexOf('@Post()'), controller.indexOf("@Post(':id/start')"))
    const sheetBlock = controller.slice(controller.indexOf("@Post(':id/practice-sheet')"), controller.indexOf("@Post(':id/transcript/print')"))
    const startBlock = controller.slice(controller.indexOf("@Post(':id/start')"), controller.indexOf("@Post(':id/answer')"))
    assert.match(createBlock, /@AiUseExempt\(/)
    assert.match(createBlock, /@MaintenanceBlocked\(\)/)
    assert.doesNotMatch(createBlock, /@AiUse\(/)
    assert.match(sheetBlock, /@AiUseExempt\(/)
    assert.match(sheetBlock, /@MaintenanceBlocked\(\)/)
    assert.doesNotMatch(sheetBlock, /@AiUse\(/)
    assert.match(startBlock, /@AiUse\('generate'\)/)
    console.log('  PASS 题目单手动退路 源码只标真正调模型的开场')
  } finally {
    live = false
    restoreEnv()
    setBudgetExhausted(false)
    setFlags(store, access, false)
    if (stub) await new Promise<void>((resolve) => stub!.close(() => resolve()))
    if (app) await app.close()
  }
}
