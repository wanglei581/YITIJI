// ============================================================================
// 只读核对：DeepSeek 思考模式是否真的被关掉 + 小青音色是否还能合成
//
// 给运维在服务器上跑（services/api 目录，与 API 进程同一个工作目录）。会访问
// 模型，不进 CI。离线自检是 verify:llm-thinking-live-gate，不触网。
//
// 密钥与线上同一处，不能只看当前 shell 的 process.env：
//   1. 先 import dotenv/config，与 src/main.ts 启动时同一加载方式（不覆盖已有变量）；
//   2. 文字模型优先用后台 AI 槽位：LlmConfigService.getApiKey / getConfig /
//      getAuditSnapshot（解密在服务里，这里不复制）；
//   3. 槽位没有单独配过的密钥时，再用服务 .env 里的 AI_LLM_API_KEY，否则
//      TRTC_LLM_API_KEY（LlmConfigService.fromEnv 的同一顺序）；
//   4. 音色密钥走 readTencentTtsSecretPair，音色 ID 走 readXiaoqingVoiceType。
//
// 退出：缺密钥或某一项被跳过 → 打印「未验证：<项>」并退出码 1。
// 只有显式 --allow-skip 才允许跳过，此时仍打印「未验证」，退出码 0。
// 请求做了但失败（「未通过」）始终退出码 1，--allow-skip 不管这一条。
// 全程不打印密钥，也不打印密钥头尾片段。
//
// 用法（在 services/api 目录）：
//   npx -y pnpm@11.2.2 run probe:llm-thinking-live
//   npx -y pnpm@11.2.2 run probe:llm-thinking-live -- --tts
//   npx -y pnpm@11.2.2 run probe:llm-thinking-live -- --model deepseek-flash
//   npx -y pnpm@11.2.2 run probe:llm-thinking-live -- --feature assistant_chat
//   npx -y pnpm@11.2.2 run probe:llm-thinking-live -- --voice 101001 --tts
//   npx -y pnpm@11.2.2 run probe:llm-thinking-live -- --allow-skip
//
// 怎么看结果：
//   「关闭思考」那一行 reasoning_tokens 应为 0 或没有、耗时明显更短；
//   「默认（不关）」那一行 reasoning_tokens > 0 就说明官方默认确实在思考、
//   而我们的关闭写法确实生效。
//   音色一行显示「可用」= 该音色 ID 能合成；显示错误码 = 该音色不可用或无权限。
// ============================================================================
import 'dotenv/config'
import 'reflect-metadata'
import { randomUUID } from 'node:crypto'

import { deepseekThinkingOff } from '../src/ai/llm/deepseek-thinking'
import {
  AI_MODEL_FEATURES,
  LlmConfigService,
  type AiModelFeatureKey,
} from '../src/ai/llm/llm-config.service'
import { readTencentTtsSecretPair, readTextToVoiceTarget } from '../src/mock-interview/asr/tts.service'
import { tc3Sign } from '../src/common/tencent/tc3'
import { readXiaoqingVoiceType } from '../src/trtc/trtc.service'

const QUESTION = '用一句话告诉我：打印一份简历前应该检查哪一项？'
const SECRET_ENV_NAMES = [
  'AI_LLM_API_KEY',
  'TRTC_LLM_API_KEY',
  'DEEPSEEK_API_KEY',
  'TENCENT_SECRET_ID',
  'TENCENT_SECRET_KEY',
  'TENCENT_TTS_SECRET_ID',
  'TENCENT_TTS_SECRET_KEY',
  'TRTC_SDK_SECRET_KEY',
] as const

/** 已经拿到手的密钥。只用于从输出里抹掉，本身绝不打印。 */
const heldSecrets: string[] = []

function holdSecret(value: string | undefined | null): void {
  const text = value?.trim()
  if (!text || text.length < 8 || heldSecrets.includes(text)) return
  heldSecrets.push(text)
}

function redact(text: string): string {
  let out = text
  for (const secret of heldSecrets) {
    out = out.split(secret).join('[REDACTED]')
    if (secret.length >= 20) {
      out = out.split(secret.slice(0, 12)).join('[REDACTED]')
      out = out.split(secret.slice(-8)).join('[REDACTED]')
    }
  }
  return out.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
}

function say(line: string): void {
  console.log(redact(line))
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function holdKnownEnvSecrets(): void {
  for (const name of SECRET_ENV_NAMES) holdSecret(process.env[name])
}

function safeOrigin(baseURL: string): string {
  try {
    return new URL(baseURL).origin
  } catch {
    return '（地址无法解析）'
  }
}

/** 与 llm-chat.service 的 callLlm 同一拼接：baseURL 去掉尾斜线再加对话路径。 */
function chatCompletionsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/$/, '')}/chat/completions`
}

interface ChatUsage {
  prompt_tokens?: number
  completion_tokens?: number
  completion_tokens_details?: { reasoning_tokens?: number }
}

interface ResolvedLlm {
  apiKey: string
  model: string
  baseURL: string
  vendor: string
  enabled: boolean
  source: string
}

function activeFeatures(): AiModelFeatureKey[] {
  return AI_MODEL_FEATURES.filter((feature) => feature.status === 'active').map((feature) => feature.key)
}

function envKeyName(apiKey: string): 'AI_LLM_API_KEY' | 'TRTC_LLM_API_KEY' | null {
  if (process.env['AI_LLM_API_KEY']?.trim() && apiKey === process.env['AI_LLM_API_KEY']?.trim()) return 'AI_LLM_API_KEY'
  if (process.env['TRTC_LLM_API_KEY']?.trim() && apiKey === process.env['TRTC_LLM_API_KEY']?.trim()) return 'TRTC_LLM_API_KEY'
  return null
}

function slotState(service: LlmConfigService, feature: AiModelFeatureKey): {
  effective: AiModelFeatureKey
  explicit: boolean
  hasCipher: boolean
  enabled: boolean
} {
  const snap = service.getAuditSnapshot(feature)
  const effective = snap.effectiveFeature
  const eff = effective === feature ? snap : service.getAuditSnapshot(effective)
  return {
    effective,
    explicit: eff.explicitlyConfigured,
    hasCipher: eff.apiKeyConfigured,
    enabled: eff.enabled,
  }
}

function pickFrom(service: LlmConfigService, feature: AiModelFeatureKey, source: string): ResolvedLlm | null {
  const apiKey = service.getApiKey(feature)?.trim()
  if (!apiKey) return null
  const cfg = service.getConfig(feature)
  return {
    apiKey,
    model: cfg.model,
    baseURL: cfg.baseURL,
    vendor: cfg.vendor,
    enabled: cfg.enabled,
    source,
  }
}

/**
 * 槽位优先：管理员单独配过且能解密的功能位（先启用中的，再停用的）。
 * 都没有，才用尚未单独配置、由 .env 兜底的功能位。
 * 显式 --feature 时只看那一个，不偷偷改看别的功能位。
 */
function resolveLlm(service: LlmConfigService): { target: ResolvedLlm | null; detail: string; warnings: string[] } {
  const requested = argValue('--feature')
  const features = requested ? [service.assertValidFeatureKey(requested)] : activeFeatures()
  const warnings: string[] = []
  const decryptFailed: string[] = []
  const explicitEnabled: AiModelFeatureKey[] = []
  const explicitDisabled: AiModelFeatureKey[] = []
  const envBacked: AiModelFeatureKey[] = []

  for (const feature of features) {
    const state = slotState(service, feature)
    if (state.explicit && state.hasCipher) {
      if (!service.getApiKey(feature)?.trim()) {
        decryptFailed.push(state.effective)
        continue
      }
      ;(state.enabled ? explicitEnabled : explicitDisabled).push(feature)
      continue
    }
    if (!state.explicit) envBacked.push(feature)
  }

  for (const feature of [...explicitEnabled, ...explicitDisabled]) {
    const state = slotState(service, feature)
    const target = pickFrom(service, feature, `后台 AI 槽位 ${state.effective}`)
    if (!target) continue
    for (const name of decryptFailed) warnings.push(`后台 AI 槽位 ${name} 的密钥无法解密`)
    return { target, detail: '', warnings }
  }

  if (!requested || decryptFailed.length === 0) {
    for (const feature of envBacked) {
      const key = service.getApiKey(feature)?.trim()
      if (!key) continue
      const state = slotState(service, feature)
      const named = envKeyName(key)
      const source = named ? `服务 .env ${named}` : `后台 AI 槽位 ${state.effective}`
      const target = pickFrom(service, feature, source)
      if (!target) continue
      for (const name of decryptFailed) warnings.push(`后台 AI 槽位 ${name} 的密钥无法解密`)
      return { target, detail: '', warnings }
    }
  }

  if (decryptFailed.length > 0) return { target: null, detail: '后台 AI 槽位密钥无法解密', warnings }
  return { target: null, detail: '后台 AI 槽位与服务 .env 都没有可用密钥', warnings }
}

async function askOnce(label: string, baseURL: string, apiKey: string, body: Record<string, unknown>): Promise<boolean> {
  const t0 = Date.now()
  try {
    const res = await fetch(chatCompletionsUrl(baseURL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    })
    const ms = Date.now() - t0
    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
      usage?: ChatUsage
      error?: { message?: string; code?: string }
    } | null
    if (!res.ok) {
      const code = data?.error?.code ?? ''
      const message = redact(String(data?.error?.message ?? '')).slice(0, 160)
      say(`  ${label}：HTTP ${res.status}，${code} ${message}（${ms} ms）`)
      return false
    }
    const msg = data?.choices?.[0]?.message
    const usage = data?.usage
    say(
      `  ${label}：耗时 ${ms} ms | completion_tokens=${usage?.completion_tokens ?? '无'}`
      + ` | reasoning_tokens=${usage?.completion_tokens_details?.reasoning_tokens ?? '无'}`
      + ` | 有思考内容=${msg?.reasoning_content ? `是（${msg.reasoning_content.length} 字）` : '否'}`
      + ` | 回答字数=${(msg?.content ?? '').length}`,
    )
    return true
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error'
    const message = redact(error instanceof Error ? error.message : '').slice(0, 160)
    say(`  ${label}：请求失败 ${name} ${message}（${Date.now() - t0} ms）`)
    return false
  }
}

async function checkDeepseek(target: ResolvedLlm): Promise<boolean> {
  holdSecret(target.apiKey)
  const model = argValue('--model')?.trim() || target.model
  say(
    `DeepSeek 核对：模型 ${model}，厂商 ${target.vendor}，启用=${target.enabled ? '是' : '否'}`
    + `，密钥来源：${target.source}（不显示内容），地址 ${safeOrigin(target.baseURL)}`,
  )
  const off = deepseekThinkingOff(model)
  if (Object.keys(off).length === 0) say('  注意：这个模型名不是 DeepSeek 系，共用函数不会加关闭思考字段。')
  const common = { model, messages: [{ role: 'user', content: QUESTION }], stream: false, max_tokens: 1024 }
  const plain = await askOnce('默认（不关思考）', target.baseURL, target.apiKey, common)
  const closed = await askOnce('关闭思考（代码实际发的）', target.baseURL, target.apiKey, { ...common, ...off })
  return plain && closed
}

function envVarName(primary: string, fallback: string): string {
  return process.env[primary] ? primary : fallback
}

function probeVoice(): number {
  if (!process.argv.includes('--voice')) return readXiaoqingVoiceType()
  const n = Number(argValue('--voice'))
  return Number.isFinite(n) ? n : readXiaoqingVoiceType()
}

async function checkTtsVoice(): Promise<boolean> {
  const pair = readTencentTtsSecretPair()
  if (!pair.secretId || !pair.secretKey) return false
  holdSecret(pair.secretId)
  holdSecret(pair.secretKey)
  const voice = probeVoice()
  const target = readTextToVoiceTarget()
  say(
    `音色 ${voice}：密钥来源 ${envVarName('TENCENT_TTS_SECRET_ID', 'TENCENT_SECRET_ID')}`
    + ` / ${envVarName('TENCENT_TTS_SECRET_KEY', 'TENCENT_SECRET_KEY')}（不显示内容）`,
  )
  const payload = JSON.stringify({ Text: '你好', SessionId: randomUUID(), VoiceType: voice, Codec: 'mp3', ModelType: 1 })
  const ts = Math.floor(Date.now() / 1000)
  const t0 = Date.now()
  try {
    const res = await fetch(target.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: tc3Sign({
          host: target.signHost,
          service: 'tts',
          payload,
          ts,
          secretId: pair.secretId,
          secretKey: pair.secretKey,
        }),
        'X-TC-Action': 'TextToVoice',
        'X-TC-Version': '2019-08-23',
        'X-TC-Timestamp': String(ts),
        'X-TC-Region': target.region,
      },
      body: payload,
      signal: AbortSignal.timeout(20_000),
    })
    const data = (await res.json().catch(() => null)) as { Response?: { Audio?: string; Error?: { Code?: string; Message?: string } } } | null
    const err = data?.Response?.Error
    if (err) {
      const detail = redact(`${err.Code ?? ''} ${err.Message ?? ''}`).slice(0, 120)
      say(`音色 ${voice}：不可用 —— ${detail}（${Date.now() - t0} ms）`)
      return false
    }
    if (data?.Response?.Audio) {
      say(`音色 ${voice}：可用，合成了 ${Buffer.from(data.Response.Audio, 'base64').length} 字节音频（${Date.now() - t0} ms）`)
      return true
    }
    say(`音色 ${voice}：HTTP ${res.status}，返回里既没有音频也没有错误码（${Date.now() - t0} ms）`)
    return false
  } catch (error) {
    const name = error instanceof Error ? error.name : 'Error'
    say(`音色 ${voice}：请求失败 ${name}`)
    return false
  }
}

type ItemState = 'verified' | 'unverified' | 'failed' | 'not-requested'

function finish(deepseek: ItemState, voice: ItemState, allowSkip: boolean): number {
  const failed = deepseek === 'failed' || voice === 'failed'
  const skipped = deepseek === 'unverified' || voice === 'unverified'
  if (failed) return 1
  if (skipped && !allowSkip) return 1
  return 0
}

function invalidFeature(error: unknown): boolean {
  const ex = error as { getResponse?: () => unknown }
  const body = typeof ex?.getResponse === 'function' ? ex.getResponse() : undefined
  return (body as { error?: { code?: string } } | undefined)?.error?.code === 'AI_FEATURE_KEY_INVALID'
}

async function main(): Promise<number> {
  holdKnownEnvSecrets()
  const allowSkip = process.argv.includes('--allow-skip')
  const wantTts = process.argv.includes('--tts')
  let deepseek: ItemState = 'unverified'
  let voice: ItemState = wantTts ? 'unverified' : 'not-requested'

  let service: LlmConfigService | null = null
  try {
    service = new LlmConfigService()
  } catch {
    say('未验证：DeepSeek（读取后台 AI 槽位失败）')
  }

  if (service) {
    try {
      const resolved = resolveLlm(service)
      for (const warning of resolved.warnings) say(`注意：${warning}`)
      if (!resolved.target) {
        say(`未验证：DeepSeek（${resolved.detail}）`)
      } else {
        deepseek = (await checkDeepseek(resolved.target)) ? 'verified' : 'failed'
        if (deepseek === 'failed') say('未通过：DeepSeek')
      }
    } catch (error) {
      say(invalidFeature(error) ? '未验证：DeepSeek（功能位不正确）' : '未验证：DeepSeek（读取后台 AI 槽位失败）')
      deepseek = 'unverified'
    }
  }

  if (wantTts) {
    const pair = readTencentTtsSecretPair()
    if (!pair.secretId || !pair.secretKey) {
      say('未验证：音色（服务 .env 没有腾讯云语音合成密钥）')
      voice = 'unverified'
    } else {
      voice = (await checkTtsVoice()) ? 'verified' : 'failed'
      if (voice === 'failed') say('未通过：音色')
    }
  }

  return finish(deepseek, voice, allowSkip)
}

void main()
  .then((code) => {
    process.exit(code)
  })
  .catch((error: unknown) => {
    const message = redact(error instanceof Error ? error.message : 'unknown').slice(0, 160)
    say(`未通过：探针异常 ${message}`)
    process.exit(1)
  })
