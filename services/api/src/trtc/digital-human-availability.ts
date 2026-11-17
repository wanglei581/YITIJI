import { aiPlatformBlockFor } from '../config/ai-platform-config'
import type { AiAccessService } from '../ai-access/ai-access.service'
import type { AiRefusal } from '../ai/assistant-chat-availability'
import type { LlmConfigService } from '../ai/llm/llm-config.service'

/** 与通话接口拒绝时同一句、同一个码。 */
export const DIGITAL_HUMAN_PAUSED: AiRefusal = {
  code: 'AI_PAUSED',
  message: 'AI 服务暂停中，打印扫描照常',
}

/** 能力表用。不带凭证字段名，避免响应里出现 secret / apiKey。 */
export const DIGITAL_HUMAN_CONFIG_REASON = '音视频通话还没配齐'

export interface TrtcConfigGap {
  http: AiRefusal
  capabilityReason: string
}

function missing(message: string): TrtcConfigGap {
  return {
    http: { code: 'AI_NOT_CONFIGURED', message },
    capabilityReason: DIGITAL_HUMAN_CONFIG_REASON,
  }
}

/**
 * 通话开场前的凭证缺口。句子沿用原先建会话时的那几句。
 * 能力表只拿 capabilityReason，不把带字段名的句子放进响应。
 */
export function trtcConfigGap(env: NodeJS.ProcessEnv = process.env): TrtcConfigGap | null {
  const sdkAppId = Number(env['TRTC_SDK_APP_ID'])
  if (!sdkAppId || !env['TRTC_SDK_SECRET_KEY']) return missing('TRTC 应用凭证未配置')
  if (!env['TENCENT_SECRET_ID'] || !env['TENCENT_SECRET_KEY']) {
    return missing('腾讯云 API 凭证（SecretId/SecretKey）未配置')
  }
  if (!env['TRTC_LLM_API_KEY']) return missing('LLM API Key 未配置（TRTC_LLM_API_KEY）')
  if (env['TRTC_TTS_CONFIG_JSON']?.trim()) return null
  const ttsType = (env['TRTC_TTS_TYPE'] ?? 'tencent').toLowerCase()
  if (ttsType !== 'tencent') {
    return missing(`不支持的 TRTC_TTS_TYPE: ${ttsType}，请使用 tencent 或 TRTC_TTS_CONFIG_JSON`)
  }
  const appId = Number(env['TRTC_TTS_APP_ID'] ?? env['TENCENT_APP_ID'])
  if (!Number.isFinite(appId) || appId <= 0) {
    return missing('腾讯 TTS AppId 未配置（TRTC_TTS_APP_ID 或 TENCENT_APP_ID）')
  }
  return null
}

export interface DigitalHumanVerdict {
  refusal: AiRefusal | null
  capabilityReason: string | null
}

/**
 * 数字人通话能不能用。能力表与 POST /trtc/session 都走这里。
 *
 * 顺序：平台开通、功能位启用、全站暂停与当天预算、音视频凭证。
 * 终端身份不在这里：建会话仍由终端守卫拦，能力表保持匿名可读。
 * 没注入配置或访问服务时跳过对应一项，兼容只传两个参数的旧构造。
 */
export async function digitalHumanVerdict(
  access: Pick<AiAccessService, 'paidAiRefusal'> | undefined,
  llm: Pick<LlmConfigService, 'getConfig'> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DigitalHumanVerdict> {
  const platform = aiPlatformBlockFor('voice')
  if (platform) return { refusal: platform, capabilityReason: platform.message }
  if (llm && llm.getConfig('digital_human').enabled === false) {
    return { refusal: DIGITAL_HUMAN_PAUSED, capabilityReason: DIGITAL_HUMAN_PAUSED.message }
  }
  if (access) {
    const paid = await access.paidAiRefusal('voice')
    if (paid) return { refusal: paid, capabilityReason: paid.message }
  }
  const gap = trtcConfigGap(env)
  if (gap) return { refusal: gap.http, capabilityReason: gap.capabilityReason }
  return { refusal: null, capabilityReason: null }
}
