import { aiPlatformBlockFor } from '../config/ai-platform-config'
import type { AiAccessService } from '../ai-access/ai-access.service'
import type { AiRefusal } from '../ai/assistant-chat-availability'
import { AI_ENDPOINT_NOT_ALLOWED_MESSAGE, llmEndpointNotAllowedError } from '../ai/llm/llm-failure'
import type { LlmConfigService } from '../ai/llm/llm-config.service'
import { AiEndpointNotAllowedError } from '../common/outbound/ai-endpoint-allowlist'
import { trtcConfigGap } from './trtc-config-gap'
import { assertTrtcDelegatedEndpoints } from './trtc-delegated-endpoints'
import { buildTrtcSessionDelegatedConfigs } from './trtc.service'

export { DIGITAL_HUMAN_CONFIG_REASON, trtcConfigGap } from './trtc-config-gap'
export type { TrtcConfigGap } from './trtc-config-gap'

/** 与通话接口拒绝时同一句、同一个码。 */
export const DIGITAL_HUMAN_PAUSED: AiRefusal = {
  code: 'AI_PAUSED',
  message: 'AI 服务暂停中，打印扫描照常',
}

export interface DigitalHumanVerdict {
  refusal: AiRefusal | null
  capabilityReason: string | null
}

/**
 * 数字人通话能不能用。能力表与 POST /trtc/session 都走这里。
 *
 * 顺序：平台开通、功能位启用、全站暂停与当天预算、音视频凭证、委托地址。
 * 委托地址用建会话拼出来的同一段配置，再调用同一个 assertTrtcDelegatedEndpoints。
 * 终端身份不在这里：建会话仍由终端守卫拦，能力表保持匿名可读。
 * 没注入配置或访问服务时跳过对应一项，兼容只传两个参数的旧构造。
 */
export async function digitalHumanVerdict(
  access: Pick<AiAccessService, 'paidAiRefusal'> | undefined,
  llm: Pick<LlmConfigService, 'getConfig'> | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DigitalHumanVerdict> {
  const platform = aiPlatformBlockFor('voice')
  if (platform) {
    // 能力表和其他模型位同一句短原因。通话接口仍回平台闸门原来的拒绝体。
    return { refusal: platform, capabilityReason: 'AI 服务暂未开通' }
  }
  if (llm && llm.getConfig('digital_human').enabled === false) {
    return { refusal: DIGITAL_HUMAN_PAUSED, capabilityReason: DIGITAL_HUMAN_PAUSED.message }
  }
  if (access) {
    const paid = await access.paidAiRefusal('voice')
    if (paid) return { refusal: paid, capabilityReason: paid.message }
  }
  const gap = trtcConfigGap(env)
  if (gap) return { refusal: gap.http, capabilityReason: gap.capabilityReason }
  try {
    const { llmConfig, ttsConfig } = buildTrtcSessionDelegatedConfigs(env)
    assertTrtcDelegatedEndpoints(llmConfig, ttsConfig)
  } catch (error) {
    if (error instanceof AiEndpointNotAllowedError) return endpointNotAllowed()
    throw error
  }
  return { refusal: null, capabilityReason: null }
}

/** 与 startSession 捕获到同一错误后抛出的 503 同一句、同一个码。 */
function endpointNotAllowed(): DigitalHumanVerdict {
  const denied = llmEndpointNotAllowedError()
  const body = denied.getResponse() as { error?: { code?: string; message?: string } }
  const code = typeof body.error?.code === 'string' ? body.error.code : 'AI_ENDPOINT_NOT_ALLOWED'
  const message = typeof body.error?.message === 'string' ? body.error.message : AI_ENDPOINT_NOT_ALLOWED_MESSAGE
  return { refusal: { code, message }, capabilityReason: message }
}
