/**
 * Q22b：数字人可用判断与真实建会话共用同一段配置、同一个委托地址校验。
 *
 * 配置会被真实服务拒绝时，能力表也说不可用。真实 TrtcService.startSession
 * 回 503 AI_ENDPOINT_NOT_ALLOWED，不占会话、不请求腾讯云。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ServiceUnavailableException } from '@nestjs/common'
import type { AiAccessService } from '../src/ai-access/ai-access.service'
import { listKioskAiCapabilities } from '../src/ai/kiosk-ai-capabilities'
import { AI_ENDPOINT_NOT_ALLOWED, AI_ENDPOINT_NOT_ALLOWED_MESSAGE } from '../src/ai/llm/llm-failure'
import type { LlmConfigService } from '../src/ai/llm/llm-config.service'
import { TrtcService } from '../src/trtc/trtc.service'

const ROOT = join(__dirname, '..')

const BASE_ENV: Record<string, string> = {
  TRTC_SDK_APP_ID: '1400000001',
  TRTC_SDK_SECRET_KEY: 'verify-trtc-sdk-key-not-real',
  TENCENT_SECRET_ID: 'verify-tencent-id-not-real',
  TENCENT_SECRET_KEY: 'verify-tencent-key-not-real',
  TRTC_LLM_API_KEY: 'verify-trtc-llm-key-not-real',
  TRTC_LLM_API_URL: 'https://api.deepseek.com/v1/chat/completions',
  TRTC_TTS_APP_ID: '1300000001',
}

const CLEAR_KEYS = [
  'TRTC_TTS_CONFIG_JSON',
  'TRTC_LLM_CONFIG_JSON',
  'TRTC_TTS_TYPE',
  'TRTC_LLM_MODEL',
  'TRTC_LLM_TYPE',
  'TRTC_SYSTEM_PROMPT',
  'AI_ENDPOINT_ALLOWLIST',
  'AI_ENDPOINT_ALLOWLIST_EXTRA',
  'TENCENT_APP_ID',
]

export async function runQ22bDigitalHumanEndpoint(input: {
  access: AiAccessService
  llm: LlmConfigService
  store: Map<string, string>
  setBudgetExhausted: (value: boolean) => void
}): Promise<void> {
  const saved = new Map<string, string | undefined>()
  for (const key of [...Object.keys(BASE_ENV), ...CLEAR_KEYS]) saved.set(key, process.env[key])
  const previousFetch = globalThis.fetch
  const traffic = { fetches: 0 }
  globalThis.fetch = (async () => {
    traffic.fetches += 1
    return new Response('{}', { status: 200 })
  }) as typeof fetch
  try {
    input.store.set('system:ai-access:paused', 'off')
    input.setBudgetExhausted(false)
    input.access.clearCache()
    input.llm.update({ enabled: true }, 'digital_human')
    await rejectCase(input, traffic, '坏的语音合成 JSON', { TRTC_TTS_CONFIG_JSON: 'not-json' })
    await rejectCase(input, traffic, '模型地址不在白名单', {
      TRTC_LLM_API_URL: 'https://api.openai.com/v1/chat/completions',
      TRTC_TTS_CONFIG_JSON: '{"TTSType":"tencent"}',
    })
    sourceContract()
  } finally {
    globalThis.fetch = previousFetch
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function rejectCase(
  input: {
    access: AiAccessService
    llm: LlmConfigService
  },
  traffic: { fetches: number },
  label: string,
  patch: Record<string, string>,
): Promise<void> {
  for (const key of CLEAR_KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(BASE_ENV)) process.env[key] = value
  for (const [key, value] of Object.entries(patch)) process.env[key] = value
  traffic.fetches = 0
  let reserves = 0
  const registry = {
    reserve: async () => { reserves += 1 },
    activate: async () => undefined,
    sessionForTask: async () => null,
  }
  input.access.clearCache()
  const listed = await listKioskAiCapabilities(input.llm, input.access)
  const item = listed.items.find((entry) => entry.key === 'digital_human')
  assert.ok(item, `${label} 能力表缺 digital_human`)
  assert.equal(item.status, 'off', `${label} 能力表应不可用`)
  assert.equal(item.reason, AI_ENDPOINT_NOT_ALLOWED_MESSAGE, `${label} 能力表原因应与真实拒绝同一句`)
  assert.doesNotMatch(JSON.stringify(item), /secret|apiKey/i, `${label} 能力表带出凭证字段名`)

  let error: unknown
  try {
    await new TrtcService(registry as never).startSession('user-q22b')
  } catch (caught) {
    error = caught
  }
  assert.ok(error instanceof ServiceUnavailableException, `${label} 真实建会话应 503，实际 ${String(error)}`)
  const body = error.getResponse() as { error?: { code?: string; message?: string } }
  assert.equal(body.error?.code, AI_ENDPOINT_NOT_ALLOWED, `${label} 真实建会话拒绝码`)
  assert.equal(body.error?.message, AI_ENDPOINT_NOT_ALLOWED_MESSAGE, `${label} 真实建会话拒绝文案`)
  assert.equal(reserves, 0, `${label} 不得占会话`)
  assert.equal(traffic.fetches, 0, `${label} 不得请求腾讯`)
  console.log(`  PASS 数字人坏配置 ${label}：能力表与真实建会话都拒绝，未发出请求`)
}

function sourceContract(): void {
  const availability = readFileSync(join(ROOT, 'src/trtc/digital-human-availability.ts'), 'utf8')
  const service = readFileSync(join(ROOT, 'src/trtc/trtc.service.ts'), 'utf8')
  assert.match(availability, /buildTrtcSessionDelegatedConfigs\(/, '可用判断必须用建会话的同一份配置拼装')
  assert.match(availability, /assertTrtcDelegatedEndpoints\(/, '可用判断必须调用同一个委托地址校验')
  assert.match(availability, /from '\.\/trtc-delegated-endpoints'/, '校验从原文件引入，不得复制')
  assert.doesNotMatch(availability, /function assertTrtcDelegatedEndpoints/, '可用判断不得自己定义校验')
  assert.match(service, /export function buildTrtcSessionDelegatedConfigs\(/, '建会话必须导出同一份拼装')
  assert.match(service, /assertTrtcDelegatedEndpoints\(/, '建会话仍调用同一个校验')
  assert.doesNotMatch(service, /function assertTrtcDelegatedEndpoints/, '建会话不得复制一份校验')
  console.log('  PASS 数字人：可用判断与建会话共用同一校验')
}
