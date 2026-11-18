/**
 * 小青文字对话、数字人通话、模拟面试：「能不能用」与真实调用是同一个判断。
 *
 * 小青文字对话：GET /assistant/availability 与 POST /assistant/chat 共用 assistantChatRefusal。
 * 数字人通话：能力表 digital_human 与 POST /trtc/session 共用 digitalHumanVerdict。
 *   没配、全站暂停、当天预算到顶、配好，两边双向一致。能力表原因不含凭证字段名。
 *
 * 不连数据库、不调用计费模型。临时目录里的真实 LlmConfigService。
 * 运行：pnpm --filter @ai-job-print/api verify:ai-availability-alignment
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ServiceUnavailableException } from '@nestjs/common'
import { AiAccessService } from '../src/ai-access/ai-access.service'
import { AiController } from '../src/ai/ai.controller'
import { AssistantAvailabilityController } from '../src/ai/assistant-availability.controller'
import { AssistantChatAvailability } from '../src/ai/assistant-chat-availability.service'
import { listKioskAiCapabilities } from '../src/ai/kiosk-ai-capabilities'
import { LlmConfigService } from '../src/ai/llm/llm-config.service'
import { MockInterviewAvailability } from '../src/mock-interview/mock-interview-availability.service'
import { MockInterviewController } from '../src/mock-interview/mock-interview.controller'
import { TrtcController } from '../src/trtc/trtc.controller'
import { runQ22bDigitalHumanEndpoint } from './verify-q22b-digital-human-endpoint'
import { runQ22bManualInterviewHttp } from './verify-q22b-manual-interview-http'

const DATA_DIR = mkdtempSync(join(tmpdir(), 'q22-avail-'))
const SAVED_ENV = {
  FILE_STORAGE_DIR: process.env['FILE_STORAGE_DIR'],
  SECRET_ENCRYPTION_KEY: process.env['SECRET_ENCRYPTION_KEY'],
  NODE_ENV: process.env['NODE_ENV'],
  AI_PAUSED: process.env['AI_PAUSED'],
  AI_PROVIDER: process.env['AI_PROVIDER'],
  AI_LLM_API_KEY: process.env['AI_LLM_API_KEY'],
}

process.env['FILE_STORAGE_DIR'] = DATA_DIR
process.env['SECRET_ENCRYPTION_KEY'] = 'verify-q22-availability-encryption-key-32'
process.env['NODE_ENV'] = 'test'
delete process.env['AI_PAUSED']
process.env['AI_PROVIDER'] = 'llm'
delete process.env['AI_LLM_API_KEY']

const ROOT = join(__dirname, '..')
const PASSED = 'PASSED_GATE'

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

function restoreEnv(): void {
  const put = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  put('FILE_STORAGE_DIR', SAVED_ENV.FILE_STORAGE_DIR)
  put('SECRET_ENCRYPTION_KEY', SAVED_ENV.SECRET_ENCRYPTION_KEY)
  put('NODE_ENV', SAVED_ENV.NODE_ENV)
  put('AI_PAUSED', SAVED_ENV.AI_PAUSED)
  put('AI_PROVIDER', SAVED_ENV.AI_PROVIDER)
  put('AI_LLM_API_KEY', SAVED_ENV.AI_LLM_API_KEY)
  rmSync(DATA_DIR, { recursive: true, force: true })
}

function sourceContracts(): void {
  const fn = read('src/ai/assistant-chat-availability.ts')
  assert.match(fn, /isReady\('assistant_chat'\)/, '对话能不能用必须看 assistant_chat.isReady，不得改回顾问作业面的 isAvailable')
  const chat = read('src/ai/ai.controller.ts')
  const chatBlock = chat.slice(chat.indexOf("@Post('assistant/chat')"))
  assert.match(chatBlock, /gate\.refusal\(\)/, 'POST /assistant/chat 必须调用共用 refusal')
  const probe = read('src/ai/assistant-availability.controller.ts')
  assert.match(probe, /this\.availability\.refusal\(\)/, '探针必须调用同一个 refusal')
  assert.match(probe, /@AiUse\('read'\)/, '探针是只读')
  const moduleSrc = read('src/ai/ai.module.ts')
  assert.match(moduleSrc, /AssistantChatAvailability/, '生产模块必须提供共用判断')
  assert.match(moduleSrc, /AssistantAvailabilityController/, '生产模块必须挂上探针')
  console.log('  PASS 小青：源码共用 assistant_chat 判断')

  const trtc = read('src/trtc/trtc.controller.ts')
  const start = trtc.slice(trtc.indexOf("@Post('session')"), trtc.indexOf("@Post('session/stop')"))
  assert.match(start, /digitalHumanVerdict\(/, '建会话必须调用共用判断')
  assert.doesNotMatch(start, /getConfig\('digital_human'\)/, '建会话不得另读一遍启用位')
  const verdictSrc = read('src/trtc/digital-human-availability.ts')
  assert.match(verdictSrc, /getConfig\('digital_human'\)/, '启用位只在共用判断里读')
  assert.match(verdictSrc, /paidAiRefusal\('voice'\)/, '暂停和预算走同一道')
  assert.match(verdictSrc, /trtcConfigGap\(/, '凭证缺口走同一道')
  assert.match(read('src/ai/kiosk-ai-capabilities.ts'), /digitalHumanVerdict\(/, '能力表必须调用同一个判断')
  assert.match(read('src/trtc/trtc.service.ts'), /trtcConfigGap\(/, '建会话服务不得再把缺凭证报成 500')
  console.log('  PASS 数字人：源码共用一个判断')

  const interviewLlm = read('src/mock-interview/mock-interview-llm.service.ts')
  const callLlm = interviewLlm.slice(interviewLlm.indexOf('private async callLlm'))
  assert.match(callLlm, /mockInterviewModelRefusal\(this\.config\)/, '出题必须调用共用的模型位判断')
  assert.doesNotMatch(callLlm, /code: 'AI_NOT_CONFIGURED'/, '出题不得再手写一套没配错误')
  const interviewCtrl = read('src/mock-interview/mock-interview.controller.ts')
  const interviewStart = interviewCtrl.slice(interviewCtrl.indexOf("@Post(':id/start')"), interviewCtrl.indexOf("@Post(':id/answer')"))
  assert.match(interviewStart, /this\.opening\.refusal\(\)/, '开场必须调用共用判断')
  const interviewProbe = interviewCtrl.slice(interviewCtrl.indexOf("@Get('availability')"), interviewCtrl.indexOf("@Post(':id/end')"))
  assert.match(interviewProbe, /this\.opening\.refusal\(\)/, '面试探针必须调用同一个判断')
  assert.match(interviewProbe, /@AiUse\('read'\)/, '面试探针是只读')
  assert.match(interviewProbe, /available: refusal === null/, '探针只回答能不能用')
  assert.match(read('src/mock-interview/mock-interview.module.ts'), /MockInterviewAvailability/, '生产模块必须提供共用判断')
  console.log('  PASS 模拟面试：源码共用一个判断')
}

const TRTC_FIXTURE: Record<string, string> = {
  TRTC_SDK_APP_ID: '1400000001',
  TRTC_SDK_SECRET_KEY: 'verify-trtc-sdk-key-not-real',
  TENCENT_SECRET_ID: 'verify-tencent-id-not-real',
  TENCENT_SECRET_KEY: 'verify-tencent-key-not-real',
  TRTC_LLM_API_KEY: 'verify-trtc-llm-key-not-real',
  TRTC_LLM_API_URL: 'https://api.deepseek.com/v1/chat/completions',
  TRTC_TTS_CONFIG_JSON: '{"TTSType":"tencent"}',
}

/** 这些值会改掉默认 DeepSeek 地址或白名单。夹具期间清掉，结束再放回去。 */
const TRTC_ENV_NOISE = [
  'TRTC_LLM_CONFIG_JSON',
  'TRTC_LLM_MODEL',
  'TRTC_LLM_TYPE',
  'TRTC_SYSTEM_PROMPT',
  'TRTC_TTS_TYPE',
  'TRTC_TTS_APP_ID',
  'TENCENT_APP_ID',
  'AI_ENDPOINT_ALLOWLIST',
  'AI_ENDPOINT_ALLOWLIST_EXTRA',
]

function withoutTrtcEnv(): () => void {
  const saved = new Map<string, string | undefined>()
  for (const key of [...Object.keys(TRTC_FIXTURE), ...TRTC_ENV_NOISE]) {
    saved.set(key, process.env[key])
    delete process.env[key]
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

function withTrtcEnv(): void {
  for (const [key, value] of Object.entries(TRTC_FIXTURE)) process.env[key] = value
}

function fakeRedis(store: Map<string, string>) {
  return {
    async get(key: string) { return store.get(key) ?? null },
    async setEx(key: string, _ttl: number, value: string) { store.set(key, value) },
    async del(key: string) { store.delete(key); return 1 },
  }
}

function chatError(error: unknown): { code?: string; message?: string } | 'passed' | 'other' {
  if (error instanceof ServiceUnavailableException) {
    const body = error.getResponse() as { error?: { code?: string; message?: string } }
    return body.error ?? {}
  }
  if (error instanceof Error && error.message === PASSED) return 'passed'
  return 'other'
}

async function main(): Promise<void> {
  console.log('\n=== AI availability alignment ===')
  sourceContracts()

  const store = new Map<string, string>()
  let budgetExhausted = false
  const budget = {
    async assertWithinBudget() {
      if (!budgetExhausted) return
      throw new ServiceUnavailableException({
        error: {
          code: 'AI_BUDGET_EXHAUSTED',
          message: '今天的 AI 服务额度已用完，明天恢复；打印、扫描等其他功能照常',
          details: ['global'],
        },
      })
    },
  }
  const access = new AiAccessService(
    fakeRedis(store) as never,
    {} as never,
    {} as never,
    {} as never,
    budget as never,
  )
  const llm = new LlmConfigService()
  const gate = new AssistantChatAvailability(access, llm)
  const probe = new AssistantAvailabilityController(gate)
  const chat = new AiController(...(Array.from({ length: AiController.length }, () => ({})) as never[]))
  Object.assign(chat, {
    assistantAvailability: gate,
    publicQuota: { consume: async () => { throw new Error(PASSED) } },
    jwt: {},
    redis: {},
    prisma: {},
  })

  const pair = async (label: string, expectCode: string | null) => {
    access.clearCache()
    const body = await probe.availabilityProbe()
    const text = JSON.stringify(body)
    assert.equal(body.success, true)
    assert.deepEqual(Object.keys(body.data), ['available'])
    assert.doesNotMatch(text, /apiKey|baseURL|systemPrompt|sk-q22/i, `${label} 探针回显了配置`)
    let outcome: ReturnType<typeof chatError> = 'other'
    try {
      await chat.chatWithAssistant({ message: '你好' } as never, { headers: {} } as never)
    } catch (error) {
      outcome = chatError(error)
    }
    if (expectCode === null) {
      assert.equal(body.data.available, true, `${label} 探针应可用`)
      assert.equal(outcome, 'passed', `${label} 对话入口应放行到模型调用之前`)
    } else {
      assert.equal(body.data.available, false, `${label} 探针应不可用`)
      assert.notEqual(outcome, 'passed', `${label} 对话入口不得放行`)
      assert.notEqual(outcome, 'other', `${label} 对话入口应回 503 而不是其它错误`)
      if (outcome !== 'passed' && outcome !== 'other') {
        assert.equal(outcome.code, expectCode, `${label} 对话拒绝码`)
      }
    }
    console.log(`  PASS 小青双向 ${label}`)
  }

  llm.update({ enabled: true, apiKey: 'sk-q22-advisor-only-not-real' }, 'advisor_work')
  await pair('顾问作业面配好、assistant_chat 没配', 'AI_NOT_CONFIGURED')

  llm.update({ enabled: true, apiKey: 'sk-q22-assistant-not-real' }, 'assistant_chat')
  llm.update({ enabled: false }, 'assistant_chat')
  await pair('assistant_chat 被关掉', 'AI_NOT_CONFIGURED')

  llm.update({ enabled: true, apiKey: 'sk-q22-assistant-not-real' }, 'assistant_chat')
  store.set('system:ai-access:paused', 'on')
  await pair('全站暂停', 'AI_PAUSED')

  store.set('system:ai-access:paused', 'off')
  budgetExhausted = true
  await pair('当天预算到顶', 'AI_BUDGET_EXHAUSTED')

  budgetExhausted = false
  access.clearCache()
  await pair('assistant_chat 配好且未暂停、未到顶', null)

  const restoreTrtc = withoutTrtcEnv()
  let starts = 0
  const session = new TrtcController(
    { startSession: async (userId: string) => { starts += 1; return { taskId: 'bill', sdkAppId: 1, userId, userSig: 's', roomId: 'r', maxSessionSeconds: 60, expiresAt: new Date().toISOString() } }, stopSession: async () => undefined } as never,
    fakeRedis(new Map()) as never,
    llm,
    access,
  )
  const both = async (label: string, expectCode: string | null) => {
    access.clearCache()
    const before = starts
    const listed = await listKioskAiCapabilities(llm, access)
    const item = listed.items.find((entry) => entry.key === 'digital_human')
    assert.ok(item, `${label} 能力表缺 digital_human`)
    assert.doesNotMatch(JSON.stringify(item), /secret|apikey/i, `${label} 能力表带出凭证字段名`)
    let code: string | null = null
    try {
      await session.startSession({ userId: 'caller' }, {} as never, 'terminal-1')
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error
      const body = error.getResponse() as { error?: { code?: string } }
      code = body.error?.code ?? 'missing'
      assert.notEqual(error.getStatus(), 500, `${label} 不得回 500`)
    }
    if (expectCode === null) {
      assert.equal(item.status, 'available', `${label} 能力表应可用`)
      assert.equal(code, null, `${label} 建会话应放行`)
      assert.equal(starts, before + 1, `${label} 应真正调用通话`)
    } else {
      assert.equal(item.status, 'off', `${label} 能力表应不可用`)
      assert.equal(code, expectCode, `${label} 建会话拒绝码`)
      assert.equal(starts, before, `${label} 不得开始计费`)
    }
    console.log(`  PASS 数字人双向 ${label}`)
  }
  try {
    llm.update({ enabled: true }, 'digital_human')
    await both('音视频凭证没配', 'AI_NOT_CONFIGURED')
    withTrtcEnv()
    llm.update({ enabled: false }, 'digital_human')
    await both('功能位关掉', 'AI_PAUSED')
    llm.update({ enabled: true }, 'digital_human')
    store.set('system:ai-access:paused', 'on')
    await both('全站暂停', 'AI_PAUSED')
    store.set('system:ai-access:paused', 'off')
    budgetExhausted = true
    await both('当天预算到顶', 'AI_BUDGET_EXHAUSTED')
    budgetExhausted = false
    await both('凭证齐、开着、未暂停、未到顶', null)
  } finally {
    restoreTrtc()
  }

  await runQ22bDigitalHumanEndpoint({
    access,
    llm,
    store,
    setBudgetExhausted: (value) => { budgetExhausted = value },
  })

  store.set('system:ai-access:paused', 'off')
  budgetExhausted = false
  access.clearCache()
  let openings = 0
  const interview = new MockInterviewController(
    {
      hasInterviewerTurn: async () => false,
      start: async () => { openings += 1; throw new Error(PASSED) },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    new MockInterviewAvailability(access, llm),
  )
  const interviewPair = async (label: string, expectCode: string | null) => {
    access.clearCache()
    const before = openings
    const body = await interview.availability()
    const text = JSON.stringify(body)
    assert.equal(body.success, true)
    assert.deepEqual(Object.keys(body.data).sort(), ['available'])
    assert.doesNotMatch(text, /apiKey|baseURL|systemPrompt|vendor|\bmodel\b|\benabled\b|sk-q22/i, `${label} 探针回显了配置`)
    let outcome: ReturnType<typeof chatError> = 'other'
    try {
      await interview.start('sess-q22', {} as never, { headers: {} })
    } catch (error) {
      outcome = chatError(error)
    }
    if (expectCode === null) {
      assert.equal(body.data.available, true, `${label} 探针应可用`)
      assert.equal(outcome, 'passed', `${label} 开场应放行到出题之前`)
      assert.equal(openings, before + 1, `${label} 应真正进入开场`)
    } else {
      assert.equal(body.data.available, false, `${label} 探针应不可用`)
      assert.notEqual(outcome, 'passed', `${label} 开场不得放行`)
      assert.notEqual(outcome, 'other', `${label} 开场应回 503 而不是其它错误`)
      if (outcome !== 'passed' && outcome !== 'other') {
        assert.equal(outcome.code, expectCode, `${label} 开场拒绝码`)
      }
      assert.equal(openings, before, `${label} 不得进入出题`)
    }
    console.log(`  PASS 模拟面试双向 ${label}`)
  }
  await interviewPair('mock_interview 没配', 'AI_NOT_CONFIGURED')
  llm.update({ enabled: true, apiKey: 'sk-q22-interview-not-real' }, 'mock_interview')
  llm.update({ enabled: false }, 'mock_interview')
  await interviewPair('mock_interview 被关掉', 'AI_NOT_CONFIGURED')
  llm.update({ enabled: true }, 'mock_interview')
  store.set('system:ai-access:paused', 'on')
  await interviewPair('全站暂停', 'AI_PAUSED')
  store.set('system:ai-access:paused', 'off')
  budgetExhausted = true
  await interviewPair('当天预算到顶', 'AI_BUDGET_EXHAUSTED')
  budgetExhausted = false
  await interviewPair('mock_interview 配好且未暂停、未到顶', null)

  await runQ22bManualInterviewHttp({
    access,
    llm,
    store,
    setBudgetExhausted: (value) => { budgetExhausted = value },
  })

  console.log('\n=== ALL PASS ===')
}

main().then(() => {
  restoreEnv()
}).catch((error: unknown) => {
  restoreEnv()
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
