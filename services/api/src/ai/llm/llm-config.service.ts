// ============================================================
// LlmConfigService — AI 大模型运行时配置（管理员可改）
//
// - 配置项：vendor / model / baseURL / systemPrompt / roleScope / forbiddenWords / temperature / enabled + apiKey
// - apiKey 用 AES-256-GCM 加密后落盘，绝不下发前端（前端只读 apiKeyConfigured）
// - v1 按功能持久化到 <dataDir>/ai-model-configs.json，重启不丢
// - 保留旧 <dataDir>/ai-model-config.json 作为兼容/回退来源，首次迁移复制到 assistant_chat 与 resume_diagnosis
// - 默认值来自 env（首次启动可零配置用上 DeepSeek）
// ============================================================

import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { encryptSecret, decryptSecret } from '../../common/crypto/secret-cipher'
import { LLM_PRESETS, isLlmVendor, type LlmVendor } from './llm-presets'
import { DEFAULT_FORBIDDEN_WORDS, DEFAULT_ROLE_SCOPE, normalizeForbiddenWords } from './llm-guard'

export interface LlmConfig {
  vendor:       LlmVendor
  model:        string
  baseURL:      string
  systemPrompt: string
  roleScope:    string
  forbiddenWords: string[]
  temperature:  number
  enabled:      boolean
}

export type AiModelFeatureKey =
  | 'assistant_chat'
  | 'mock_interview'
  | 'resume_diagnosis'
  | 'resume_generate'
  | 'resume_optimize'
  | 'digital_human'
  | 'poster_generation'

export interface AiModelFeatureMeta {
  key: AiModelFeatureKey
  label: string
  status: 'active' | 'planned'
  description: string
  runtimeNote: string
  allowCustomSystemPrompt: boolean
}

/** 前端可见的配置视图（不含 apiKey 明文） */
export interface LlmConfigView extends LlmConfig {
  featureKey: AiModelFeatureKey
  apiKeyConfigured: boolean
}

interface PersistedConfig extends LlmConfig {
  apiKeyEncrypted: string | null
}

type PersistedConfigMap = Record<AiModelFeatureKey, PersistedConfig>

const DEFAULT_SYSTEM_PROMPT =
  '你是「AI 求职打印服务终端」的就业服务助手，名字叫小青，亲切、专业、口语化。' +
  '你为求职者提供简历优化建议、求职指导、就业政策解读、打印扫描帮助，以及岗位/招聘会信息查询引导。' +
  '回答简洁自然，避免机械式重复。岗位和招聘会只作为第三方或官方来源信息入口展示。'

const MAX_SYSTEM_PROMPT_CHARS = 4000
const MAX_ROLE_SCOPE_CHARS = 2000
const MAX_FORBIDDEN_WORDS = 100
const MAX_FORBIDDEN_WORD_CHARS = 40

export const AI_MODEL_FEATURES: AiModelFeatureMeta[] = [
  {
    key: 'assistant_chat',
    label: 'AI助手对话',
    status: 'active',
    description: '用于前台 AI助手文字对话。',
    runtimeNote: '已被 AI 助手运行链路消费。',
    allowCustomSystemPrompt: true,
  },
  {
    key: 'resume_diagnosis',
    label: 'AI简历诊断',
    status: 'active',
    description: '用于上传简历后的 AI 诊断报告，仅供求职者本人修改简历参考，不代表投递、面试或录用结果。',
    runtimeNote: '已被 AI 简历诊断运行链路消费；诊断结构化 System Prompt 由服务端强制，管理员自定义 System Prompt v1 不参与诊断。',
    allowCustomSystemPrompt: false,
  },
  {
    key: 'resume_generate',
    label: 'AI简历生成',
    status: 'active',
    description: '用于引导式表单生成简历。AI 只润色用户提供的信息，不编造学历、证书、公司或项目经历。',
    runtimeNote: '已被 AI 简历生成运行链路消费；生成结构化 System Prompt 由服务端强制（防编造契约），管理员自定义 System Prompt 不参与生成。',
    allowCustomSystemPrompt: false,
  },
  {
    key: 'resume_optimize',
    label: 'AI简历优化',
    status: 'active',
    description: '用于基于简历原文与诊断报告生成优化版简历与新旧对比。AI 只优化表达，不编造经历；事实信息须出现在简历原文中。',
    runtimeNote: '已被 AI 简历优化运行链路消费；优化结构化 System Prompt 由服务端强制（防编造契约），管理员自定义 System Prompt 不参与优化。',
    allowCustomSystemPrompt: false,
  },
  {
    key: 'mock_interview',
    label: 'AI模拟面试',
    status: 'active',
    description: '用于求职者本人的对话式模拟面试练习与练习报告。仅供本人参考，不代表任何招聘结果承诺，不参与企业筛选、面试邀约或录用决策。',
    runtimeNote: '已被 2C 模拟面试运行链路消费；面试官与报告结构化 System Prompt 由服务端强制，管理员自定义 System Prompt 不参与。',
    allowCustomSystemPrompt: false,
  },
  {
    key: 'digital_human',
    label: 'AI数字人引导',
    status: 'planned',
    description: '后续接入。用于一体机前台数字人引导与操作说明。',
    runtimeNote: '后续接入，当前尚未被运行链路消费。',
    allowCustomSystemPrompt: true,
  },
  {
    key: 'poster_generation',
    label: 'AI海报生成',
    status: 'planned',
    description: '后续接入。用于待机宣传屏 AI 海报草稿生成。',
    runtimeNote: '独立配置待建设，当前宣传屏 AI 文生图仍为 disabled stub。',
    allowCustomSystemPrompt: true,
  },
]

const ACTIVE_FEATURE_KEYS = AI_MODEL_FEATURES.map((feature) => feature.key)

function isAiModelFeatureKey(value: unknown): value is AiModelFeatureKey {
  return typeof value === 'string' && ACTIVE_FEATURE_KEYS.includes(value as AiModelFeatureKey)
}

function normalizeConfigText(value: string | undefined, fallback: string, maxChars: number): string {
  const text = value?.trim() || fallback
  return text.slice(0, maxChars)
}

function normalizeConfigForbiddenWords(words: readonly string[] | undefined): string[] {
  return normalizeForbiddenWords(words)
    .map((word) => word.slice(0, MAX_FORBIDDEN_WORD_CHARS))
    .slice(0, MAX_FORBIDDEN_WORDS)
}

function parseForbiddenWordsFromEnv(value: string | undefined): string[] {
  if (!value) return DEFAULT_FORBIDDEN_WORDS
  return normalizeConfigForbiddenWords(value.split(/[,，\n]/))
}

@Injectable()
export class LlmConfigService {
  private readonly logger = new Logger(LlmConfigService.name)
  private readonly filePath: string
  private readonly legacyFilePath: string
  private cache: PersistedConfigMap

  constructor() {
    const dataDir = resolve(process.env['FILE_STORAGE_DIR'] || join(process.cwd(), 'data'))
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
    this.filePath = join(dataDir, 'ai-model-configs.json')
    this.legacyFilePath = join(dataDir, 'ai-model-config.json')
    this.cache = this.load()
  }

  // ── 持久化 ────────────────────────────────────────────────
  private load(): PersistedConfigMap {
    if (existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<Record<AiModelFeatureKey, Partial<PersistedConfig>>>
        return this.withMapDefaults(raw)
      } catch {
        this.logger.warn('ai-model-configs.json 解析失败，使用默认配置')
      }
    }

    if (existsSync(this.legacyFilePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.legacyFilePath, 'utf-8')) as Partial<PersistedConfig>
        if (raw.vendor && isLlmVendor(raw.vendor)) {
          const legacy = this.withDefaults(raw)
          const migrated = this.withMapDefaults({
            assistant_chat: legacy,
            resume_diagnosis: legacy,
          })
          writeFileSync(this.filePath, JSON.stringify(migrated, null, 2), 'utf-8')
          this.logger.log('已从 ai-model-config.json 迁移到 ai-model-configs.json')
          return migrated
        }
      } catch {
        this.logger.warn('ai-model-config.json 解析失败，使用默认配置')
      }
    }

    return this.withMapDefaults({})
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8')
  }

  private withMapDefaults(raw: Partial<Record<AiModelFeatureKey, Partial<PersistedConfig>>>): PersistedConfigMap {
    const env = this.fromEnv()
    const map = {} as PersistedConfigMap
    for (const key of ACTIVE_FEATURE_KEYS) {
      map[key] = this.withDefaults(raw[key] ?? env)
    }
    return map
  }

  private withDefaults(raw: Partial<PersistedConfig>): PersistedConfig {
    const vendor = (raw.vendor && isLlmVendor(raw.vendor)) ? raw.vendor : 'deepseek'
    const preset = LLM_PRESETS[vendor]
    return {
      vendor,
      model:           raw.model        ?? preset.defaultModel,
      baseURL:         raw.baseURL      ?? preset.baseURL,
      systemPrompt:    normalizeConfigText(raw.systemPrompt, DEFAULT_SYSTEM_PROMPT, MAX_SYSTEM_PROMPT_CHARS),
      roleScope:       normalizeConfigText(raw.roleScope, DEFAULT_ROLE_SCOPE, MAX_ROLE_SCOPE_CHARS),
      forbiddenWords:  normalizeConfigForbiddenWords(raw.forbiddenWords ?? DEFAULT_FORBIDDEN_WORDS),
      temperature:     typeof raw.temperature === 'number' ? raw.temperature : 0.7,
      enabled:         raw.enabled ?? false,
      apiKeyEncrypted: raw.apiKeyEncrypted ?? null,
    }
  }

  /** 从 env 取默认配置（首次启动；可复用 TRTC 的 DeepSeek key） */
  private fromEnv(): PersistedConfig {
    const vendor: LlmVendor = 'deepseek'
    const preset = LLM_PRESETS[vendor]
    const envKey = process.env['AI_LLM_API_KEY'] || process.env['TRTC_LLM_API_KEY'] || ''
    return {
      vendor,
      model:           preset.defaultModel,
      baseURL:         preset.baseURL,
      systemPrompt:    DEFAULT_SYSTEM_PROMPT,
      roleScope:       normalizeConfigText(process.env['AI_ASSISTANT_ROLE_SCOPE'], DEFAULT_ROLE_SCOPE, MAX_ROLE_SCOPE_CHARS),
      forbiddenWords:  parseForbiddenWordsFromEnv(process.env['AI_ASSISTANT_FORBIDDEN_WORDS']),
      temperature:     0.7,
      enabled:         Boolean(envKey),
      apiKeyEncrypted: envKey ? encryptSecret(envKey) : null,
    }
  }

  // ── 读取 ──────────────────────────────────────────────────
  getFeatures(): AiModelFeatureMeta[] {
    return AI_MODEL_FEATURES
  }

  getViews(): Record<AiModelFeatureKey, LlmConfigView> {
    return Object.fromEntries(
      ACTIVE_FEATURE_KEYS.map((key) => [key, this.getView(key)]),
    ) as Record<AiModelFeatureKey, LlmConfigView>
  }

  getView(feature: AiModelFeatureKey = 'assistant_chat'): LlmConfigView {
    const { apiKeyEncrypted, ...rest } = this.cache[feature]
    return { featureKey: feature, ...rest, apiKeyConfigured: Boolean(apiKeyEncrypted) }
  }

  getConfig(feature: AiModelFeatureKey = 'assistant_chat'): LlmConfig {
    // 复制后剔除加密密钥，避免下发到下游（不泄漏到 LlmConfig 返回值）
    const rest: PersistedConfig = { ...this.cache[feature] }
    delete (rest as { apiKeyEncrypted?: unknown }).apiKeyEncrypted
    return rest
  }

  /** 取解密后的 apiKey（仅服务端调用） */
  getApiKey(feature: AiModelFeatureKey = 'assistant_chat'): string | null {
    const cfg = this.cache[feature]
    if (!cfg.apiKeyEncrypted) return null
    try {
      return decryptSecret(cfg.apiKeyEncrypted)
    } catch {
      this.logger.error('apiKey 解密失败（SECRET_ENCRYPTION_KEY 可能已变更）')
      return null
    }
  }

  isReady(feature: AiModelFeatureKey = 'assistant_chat'): boolean {
    const cfg = this.cache[feature]
    return cfg.enabled && Boolean(cfg.apiKeyEncrypted)
  }

  // ── 更新 ──────────────────────────────────────────────────
  update(patch: Partial<LlmConfig> & { apiKey?: string }, feature: AiModelFeatureKey = 'assistant_chat'): LlmConfigView {
    const next: PersistedConfig = { ...this.cache[feature] }

    if (patch.vendor && isLlmVendor(patch.vendor) && patch.vendor !== next.vendor) {
      next.vendor = patch.vendor
      // 切换厂商时，若未显式指定，则套用该厂商默认 baseURL/model
      const preset = LLM_PRESETS[patch.vendor]
      next.baseURL = patch.baseURL ?? preset.baseURL
      next.model   = patch.model   ?? preset.defaultModel
    }
    if (patch.model        !== undefined) next.model = patch.model
    if (patch.baseURL      !== undefined) next.baseURL = patch.baseURL
    if (patch.systemPrompt !== undefined) {
      next.systemPrompt = normalizeConfigText(patch.systemPrompt, DEFAULT_SYSTEM_PROMPT, MAX_SYSTEM_PROMPT_CHARS)
    }
    if (patch.roleScope    !== undefined) {
      next.roleScope = normalizeConfigText(patch.roleScope, DEFAULT_ROLE_SCOPE, MAX_ROLE_SCOPE_CHARS)
    }
    if (patch.forbiddenWords !== undefined) {
      next.forbiddenWords = normalizeConfigForbiddenWords(patch.forbiddenWords)
    }
    if (patch.temperature  !== undefined) next.temperature = patch.temperature
    if (patch.enabled      !== undefined) next.enabled = patch.enabled
    // apiKey：只有传了非空值才更新；传空字符串视为「清除」
    if (patch.apiKey !== undefined) {
      next.apiKeyEncrypted = patch.apiKey ? encryptSecret(patch.apiKey) : null
    }

    this.cache = { ...this.cache, [feature]: next }
    this.save()
    this.logger.log(`AI 模型配置已更新：feature=${feature} vendor=${next.vendor} model=${next.model} enabled=${next.enabled}`)
    return this.getView(feature)
  }

  /**
   * 校验并返回合法 featureKey；非法值抛 400（绝不静默回落到 assistant_chat）。
   * 错误信息只含合法枚举（公开的功能名），不含任何敏感配置。
   */
  assertValidFeatureKey(value: unknown): AiModelFeatureKey {
    if (isAiModelFeatureKey(value)) return value
    throw new BadRequestException({
      error: {
        code: 'AI_FEATURE_KEY_INVALID',
        message: `Unknown AI model feature. Must be one of: ${ACTIVE_FEATURE_KEYS.join(', ')}`,
      },
    })
  }
}
