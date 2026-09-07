import { AI_MODEL_FEATURES, type LlmConfigService, type LlmConfigView } from './llm/llm-config.service'

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

function toItem(view: LlmConfigView, metaStatus: 'active' | 'planned'): KioskAiCapabilityItem {
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
  return { ...base, status: 'available', providerName: view.vendor }
}

/** 只读 llm-config 视图。不解密 apiKey，不发任何出站请求。 */
export function listKioskAiCapabilities(config: LlmConfigService): KioskAiCapabilitiesResponse {
  const items = AI_MODEL_FEATURES.map((meta) => toItem(config.getView(meta.key), meta.status))
  return { items }
}
