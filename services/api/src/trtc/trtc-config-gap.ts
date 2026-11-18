import type { AiRefusal } from '../ai/assistant-chat-availability'

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
 *
 * 单独成文件：建会话服务和可用判断都要读它。判断还要回过来用服务里的配置拼装，
 * 若缺口仍放在判断文件里，两边会循环引用。
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
