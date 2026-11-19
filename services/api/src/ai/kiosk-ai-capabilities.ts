import { AI_MODEL_FEATURES, type LlmConfigService, type LlmConfigView } from './llm/llm-config.service'
import { evaluateAiPlatform, type AiPlatformState } from '../config/ai-platform-config'
import type { AiAccessService } from '../ai-access/ai-access.service'
import { digitalHumanVerdict } from '../trtc/digital-human-availability'

/** 契约源：packages/shared/src/types/ai.ts（KioskAiCapabilitiesResponse）。 */
export type KioskAiCapabilityStatus = 'available' | 'degraded' | 'off'

export interface KioskAiCapabilityItem {
  key: string
  status: KioskAiCapabilityStatus
  reason?: string
  providerName?: string
}

export interface KioskAiCapabilitiesResponse {
  items: KioskAiCapabilityItem[]
}

const LLM_STUB_PROVIDERS = new Set(['openai', 'claude', 'local', 'qwen', 'zhipu'])

function currentAiProvider(): string {
  return (process.env['AI_PROVIDER'] ?? 'mock').trim().toLowerCase() || 'mock'
}

/** 图片 / 扫描件要走 OCR 的能力。OCR 未开通时只降级它，文字版简历照常。 */
const OCR_DEPENDENT_FEATURES = new Set(['resume_diagnosis'])

function toItem(view: LlmConfigView, metaStatus: 'active' | 'planned', platform: AiPlatformState): KioskAiCapabilityItem {
  const aiProvider = currentAiProvider()
  const base: Pick<KioskAiCapabilityItem, 'key'> = { key: view.featureKey }

  if (metaStatus === 'planned') {
    return { ...base, status: 'off', reason: '后续接入，当前尚未开放' }
  }

  // 打印参数预填是确定性规则，不读大模型凭证；只看 enabled。
  if (view.featureKey === 'print_param_prefill') {
    if (!view.enabled) return { ...base, status: 'off', reason: '管理员已关闭该能力' }
    return { ...base, status: 'available' }
  }

  // 生产缺 AI 平台配置（F-11）：如实报不可用，一体机走既有的「AI 暂不可用」分支。
  if (!platform.generationAvailable) {
    return { ...base, status: 'off', reason: 'AI 服务暂未开通' }
  }
  if (!view.enabled) {
    return { ...base, status: 'off', reason: '管理员已关闭该能力' }
  }
  if (!view.apiKeyConfigured) {
    return { ...base, status: 'off', reason: '未配置模型密钥' }
  }
  if (aiProvider === 'mock') {
    return {
      ...base,
      status: 'degraded',
      reason: '当前为开发 mock，未接真实模型',
      providerName: view.vendor,
    }
  }
  if (LLM_STUB_PROVIDERS.has(aiProvider)) {
    return {
      ...base,
      status: 'off',
      reason: '当前提供商尚未接入真实调用',
      providerName: view.vendor,
    }
  }
  if (!platform.ocrConfigured && OCR_DEPENDENT_FEATURES.has(view.featureKey)) {
    return { ...base, status: 'degraded', reason: '图片和扫描版简历暂不能识别，文字版 PDF / Word 照常', providerName: view.vendor }
  }
  return { ...base, status: 'available', providerName: view.vendor }
}

/**
 * 只读 llm-config 视图。不解密密钥，不发任何出站请求。
 * digital_human 改用与 POST /trtc/session 相同的判断，不用本功能位自己的模型密钥。
 */
export async function listKioskAiCapabilities(
  config: LlmConfigService,
  access?: Pick<AiAccessService, 'paidAiRefusal'>,
): Promise<KioskAiCapabilitiesResponse> {
  const platform = evaluateAiPlatform()
  const items = AI_MODEL_FEATURES.map((meta) => toItem(config.getView(meta.key), meta.status, platform))
  const index = items.findIndex((item) => item.key === 'digital_human')
  if (index >= 0) {
    const verdict = await digitalHumanVerdict(access, config)
    items[index] = verdict.refusal
      ? { key: 'digital_human', status: 'off', reason: verdict.capabilityReason ?? '音视频通话还没配齐' }
      : { key: 'digital_human', status: 'available' }
  }
  return { items }
}
