import { buildGuardedSystemPrompt, type LlmGuardConfig } from '../ai/llm/llm-guard'
import { llmNotConfiguredError } from '../ai/llm/llm-failure'

const PROMPT_FIELDS = new Set(['messages', 'system', 'systemprompt', 'systemrole', 'prompt', 'input', 'instructions'])

function invalidConfig(): never {
  // JSON.parse 的原生异常可能摘录 APIKey；不返回、不记录配置正文或解析异常。
  throw llmNotConfiguredError('实时语音暂时不可用，请使用文字交流')
}

/**
 * 在任何会话预占和腾讯请求之前守住完整 JSON 覆盖的提示词。
 * 模型、凭证、地址、关闭思考等字段保留；仅 SystemPrompt 补齐现有守卫与语音约束。
 */
export function guardTrtcLlmConfigJson(raw: string, fallback: LlmGuardConfig): string {
  let value: unknown
  try { value = JSON.parse(raw) } catch { return invalidConfig() }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidConfig()
  const config = value as Record<string, unknown>
  // 只有 OpenAI 兼容路径明确接收 SystemPrompt；外置智能体的内部提示词无法在此核验。
  if (config.LLMType !== 'openai') return invalidConfig()
  if (config.SystemPrompt !== undefined && typeof config.SystemPrompt !== 'string') return invalidConfig()

  // 腾讯文档：ExtraBody / MetaInfo 会透传到模型请求体。拒绝其中重定义提示词的字段，
  // 不假定腾讯或不同模型厂商的字段合并优先级。普通采样/关闭思考参数仍原样保留。
  for (const field of ['ExtraBody', 'MetaInfo']) {
    const extra = config[field]
    if (extra === undefined) continue
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) return invalidConfig()
    if (Object.keys(extra).some((key) => PROMPT_FIELDS.has(key.replaceAll('_', '').toLowerCase()))) return invalidConfig()
  }
  if (config.UserMessages !== undefined) {
    if (!Array.isArray(config.UserMessages)) return invalidConfig()
    for (const message of config.UserMessages) {
      if (!message || typeof message !== 'object' || Array.isArray(message)) return invalidConfig()
      const role = (message as Record<string, unknown>).Role
      if (role !== 'user' && role !== 'assistant') return invalidConfig()
    }
  }

  config.SystemPrompt = buildGuardedSystemPrompt({
    ...fallback,
    systemPrompt: typeof config.SystemPrompt === 'string' && config.SystemPrompt.trim()
      ? config.SystemPrompt : fallback.systemPrompt,
  }, { policyVariant: 'voice' })
  return JSON.stringify(config)
}
