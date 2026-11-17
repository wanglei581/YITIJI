/**
 * 小青文字对话、数字人通话、模拟面试：「能不能用」与真实调用是同一个判断。
 *
 * 本文件按任务包分段长出来。当前段只守小青文字对话：
 *   GET /assistant/availability 与 POST /assistant/chat 共用 assistantChatRefusal。
 *   没配、全站暂停、当天预算到顶、配好，探针与对话入口双向一致。
 *   顾问作业面 advisor_work 配好不能把 assistant_chat 说成能用。
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
import { LlmConfigService } from '../src/ai/llm/llm-config.service'

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

  console.log('\n=== ALL PASS ===')
}

main().then(() => {
  restoreEnv()
}).catch((error: unknown) => {
  restoreEnv()
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
