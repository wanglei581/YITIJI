// ============================================================
// LlmConfigService — AI 大模型运行时配置（管理员可改）
//
// - 配置项：vendor / model / baseURL / systemPrompt / temperature / enabled + apiKey
// - apiKey 用 AES-256-GCM 加密后落盘，绝不下发前端（前端只读 apiKeyConfigured）
// - 持久化到 <dataDir>/ai-model-config.json，重启不丢
// - 默认值来自 env（首次启动可零配置用上 DeepSeek）
// ============================================================

import { Injectable, Logger } from '@nestjs/common'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { encryptSecret, decryptSecret } from '../../common/crypto/secret-cipher'
import { LLM_PRESETS, isLlmVendor, type LlmVendor } from './llm-presets'

export interface LlmConfig {
  vendor:       LlmVendor
  model:        string
  baseURL:      string
  systemPrompt: string
  temperature:  number
  enabled:      boolean
}

/** 前端可见的配置视图（不含 apiKey 明文） */
export interface LlmConfigView extends LlmConfig {
  apiKeyConfigured: boolean
}

interface PersistedConfig extends LlmConfig {
  apiKeyEncrypted: string | null
}

const DEFAULT_SYSTEM_PROMPT =
  '你是「AI 求职打印服务终端」的就业服务助手，名字叫小青，亲切、专业、口语化。' +
  '你为求职者提供简历优化建议、求职指导、就业政策解读、打印扫描帮助，以及岗位/招聘会信息查询引导。' +
  '回答简洁自然，避免机械式重复，每次控制在 120 字以内。' +
  '合规红线：你不提供企业招聘、一键投递、简历投递给企业、简历筛选、面试邀约、Offer 管理等服务；' +
  '遇到此类需求，请引导用户「去来源平台投递」。岗位和招聘会只作为第三方来源信息展示。'

@Injectable()
export class LlmConfigService {
  private readonly logger = new Logger(LlmConfigService.name)
  private readonly filePath: string
  private cache: PersistedConfig

  constructor() {
    const dataDir = resolve(process.env['FILE_STORAGE_DIR'] || join(process.cwd(), 'data'))
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
    this.filePath = join(dataDir, 'ai-model-config.json')
    this.cache = this.load()
  }

  // ── 持久化 ────────────────────────────────────────────────
  private load(): PersistedConfig {
    if (existsSync(this.filePath)) {
      try {
        const raw = JSON.parse(readFileSync(this.filePath, 'utf-8')) as Partial<PersistedConfig>
        if (raw.vendor && isLlmVendor(raw.vendor)) {
          return this.withDefaults(raw)
        }
      } catch {
        this.logger.warn('ai-model-config.json 解析失败，使用默认配置')
      }
    }
    return this.fromEnv()
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2), 'utf-8')
  }

  private withDefaults(raw: Partial<PersistedConfig>): PersistedConfig {
    const vendor = (raw.vendor && isLlmVendor(raw.vendor)) ? raw.vendor : 'deepseek'
    const preset = LLM_PRESETS[vendor]
    return {
      vendor,
      model:           raw.model        ?? preset.defaultModel,
      baseURL:         raw.baseURL      ?? preset.baseURL,
      systemPrompt:    raw.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
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
      temperature:     0.7,
      enabled:         Boolean(envKey),
      apiKeyEncrypted: envKey ? encryptSecret(envKey) : null,
    }
  }

  // ── 读取 ──────────────────────────────────────────────────
  getView(): LlmConfigView {
    const { apiKeyEncrypted, ...rest } = this.cache
    return { ...rest, apiKeyConfigured: Boolean(apiKeyEncrypted) }
  }

  getConfig(): LlmConfig {
    // 复制后剔除加密密钥，避免下发到下游（不泄漏到 LlmConfig 返回值）
    const rest: PersistedConfig = { ...this.cache }
    delete (rest as { apiKeyEncrypted?: unknown }).apiKeyEncrypted
    return rest
  }

  /** 取解密后的 apiKey（仅服务端调用） */
  getApiKey(): string | null {
    if (!this.cache.apiKeyEncrypted) return null
    try {
      return decryptSecret(this.cache.apiKeyEncrypted)
    } catch {
      this.logger.error('apiKey 解密失败（SECRET_ENCRYPTION_KEY 可能已变更）')
      return null
    }
  }

  isReady(): boolean {
    return this.cache.enabled && Boolean(this.cache.apiKeyEncrypted)
  }

  // ── 更新 ──────────────────────────────────────────────────
  update(patch: Partial<LlmConfig> & { apiKey?: string }): LlmConfigView {
    const next: PersistedConfig = { ...this.cache }

    if (patch.vendor && isLlmVendor(patch.vendor) && patch.vendor !== next.vendor) {
      next.vendor = patch.vendor
      // 切换厂商时，若未显式指定，则套用该厂商默认 baseURL/model
      const preset = LLM_PRESETS[patch.vendor]
      next.baseURL = patch.baseURL ?? preset.baseURL
      next.model   = patch.model   ?? preset.defaultModel
    }
    if (patch.model        !== undefined) next.model = patch.model
    if (patch.baseURL      !== undefined) next.baseURL = patch.baseURL
    if (patch.systemPrompt !== undefined) next.systemPrompt = patch.systemPrompt
    if (patch.temperature  !== undefined) next.temperature = patch.temperature
    if (patch.enabled      !== undefined) next.enabled = patch.enabled
    // apiKey：只有传了非空值才更新；传空字符串视为「清除」
    if (patch.apiKey !== undefined) {
      next.apiKeyEncrypted = patch.apiKey ? encryptSecret(patch.apiKey) : null
    }

    this.cache = next
    this.save()
    this.logger.log(`AI 模型配置已更新：vendor=${next.vendor} model=${next.model} enabled=${next.enabled}`)
    return this.getView()
  }
}
