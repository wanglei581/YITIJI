// ============================================================================
// 数字人：交给腾讯云代调的第三方地址，建房前按出站白名单核对
//
// 为什么要有这个文件：数字人对话（StartAIConversation）里，模型与语音合成的请求
// 不是本进程发的 —— 我们把 LLMConfig / TTSConfig 交给腾讯云，由腾讯云去调配置里的
// 地址。对话内容（可能含简历、个人信息）和要合成的文字会被转发到那里，所以目的地
// 必须在我们这边、建房之前核对（feature-scope §七 #26 点名了 TRTC_LLM_API_URL）。
//   - TRTC_LLM_API_URL 默认是 DeepSeek，但 TRTC_LLM_CONFIG_JSON 可以整段覆盖；
//     腾讯云文档里 dify 类型不写地址时默认 api.dify.ai、coze 有国际站 api.coze.com。
//   - TRTC_TTS_CONFIG_JSON 可以把语音合成换成 elevenlabs、cartesia、azure 或自定义地址。
//
// 规则（fail-closed）：
//   - 配置不是 JSON 对象 → 看不出目的地 → 不放行。
//   - 配置里凡是「像地址」的字符串（带协议头的值；或键名含 url / host / endpoint /
//     domain 的值）逐个过白名单，任一不在单内 → 不放行。
//   - 模型配置里一个地址都没有 → 目的地是厂商默认值，核对不了 → 不放行。
//   - 语音合成一个地址都没有时，只放行腾讯云自家的类型（tencent / flow），
//     其余类型（azure、elevenlabs、cartesia 等）没有地址可核 → 不放行。
//
// 为什么不放进 trtc.service.ts：那边是建房流程与凭证拼装，这里是纯判定（不读 env、
// 不发请求），单独成文件便于门禁直接喂配置字符串做正反例，也不让 service 继续变长。
// ============================================================================

import {
  assertAiEndpointAllowed,
  rejectUnverifiableAiEndpoint,
  type AiOutboundService,
} from '../common/outbound/ai-endpoint-allowlist'

/** 腾讯云自家的语音合成类型：合成在腾讯云内完成，不出腾讯云。 */
const TENCENT_NATIVE_TTS_TYPES: ReadonlySet<string> = new Set(['tencent', 'flow'])

const URL_LIKE_KEY = /url|host|endpoint|domain/iu
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//iu
const MAX_DEPTH = 6

function parseConfigObject(raw: string, service: AiOutboundService): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return rejectUnverifiableAiEndpoint(service)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return rejectUnverifiableAiEndpoint(service)
  return parsed as Record<string, unknown>
}

/** 收集配置里所有「像地址」的值；没有协议头但挂在地址类键名下的，按 https 补全再判。 */
function collectEndpointValues(value: unknown, keyHint: string, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH) return
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return
    if (HAS_SCHEME.test(text)) out.push(text)
    else if (URL_LIKE_KEY.test(keyHint)) out.push(`https://${text}`)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEndpointValues(item, keyHint, depth + 1, out)
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      collectEndpointValues(item, key, depth + 1, out)
    }
  }
}

function endpointValuesOf(config: Record<string, unknown>): string[] {
  const out: string[] = []
  collectEndpointValues(config, '', 0, out)
  return out
}

/**
 * 建房前调用。任何一处不在白名单 → 抛 AiEndpointNotAllowedError（调用方映射成
 * 503 AI_ENDPOINT_NOT_ALLOWED），此时还没有调用腾讯云，也没有建房。
 */
export function assertTrtcDelegatedEndpoints(llmConfig: string, ttsConfig: string): void {
  const llm = parseConfigObject(llmConfig, 'trtc_llm')
  const llmEndpoints = endpointValuesOf(llm)
  if (llmEndpoints.length === 0) rejectUnverifiableAiEndpoint('trtc_llm')
  for (const endpoint of llmEndpoints) assertAiEndpointAllowed(endpoint, 'trtc_llm')

  const tts = parseConfigObject(ttsConfig, 'trtc_tts')
  const ttsEndpoints = endpointValuesOf(tts)
  for (const endpoint of ttsEndpoints) assertAiEndpointAllowed(endpoint, 'trtc_tts')
  if (ttsEndpoints.length === 0) {
    const ttsType = typeof tts['TTSType'] === 'string' ? tts['TTSType'].trim().toLowerCase() : ''
    if (!TENCENT_NATIVE_TTS_TYPES.has(ttsType)) rejectUnverifiableAiEndpoint('trtc_tts')
  }
}
