// ============================================================
// AI 大模型配置变更审计 —— 快照、差异与脱敏
//
// 为什么单独成文件：
//   1. llm-config.service.ts 已 506 行（CLAUDE.md §8 的 500 行评估线），不再往里堆；
//   2. apiKey 的脱敏规则必须**只有一处**，且必须是不依赖 Nest DI / 请求上下文的
//      纯函数，才能被 verify 脚本直接拿去断言。
//
// ⚠️ 铁律：apiKey 的**明文、密文、长度、前缀、哈希**一律不得进入审计 payload。
//    审计日志本身也是可被读取的资产（GET /admin/audit-logs 就能翻），
//    在里面留任何密钥物料都等于把密钥换了个地方存。
//    密钥只以「本次对它做了什么动作」这一个枚举参与审计。
//
//    对比：systemPrompt / roleScope 是**运营撰写的配置文本**，不是密钥，
//    因此记录它们的字符数 + 内容哈希（便于事后判断「改了」「又改回去了」）。
//    仍不记全文——AuditService 的 payload 上限是 4KB，而 systemPrompt 单字段
//    就允许 4000 字，全文入库会让**整条**审计被截断成 {truncated:true}，
//    等于连 vendor/model 改了什么都查不到。全文随时可从 GET /admin/ai-config 读。
// ============================================================

import { createHash } from 'node:crypto'
import type { LlmVendor } from './llm-presets'

/**
 * 本次更新对 apiKey 做了什么。
 *
 * - `absent`    本次请求根本没提交 apiKey 字段（其它配置项的改动不影响密钥）
 * - `unchanged` 提交了，但与现值逐字相同 / 对空配置提交空值 —— 如实记「没变」，不谎报轮换
 * - `set`       原本没有密钥，本次首次配置
 * - `rotated`   原本有密钥，本次换成了不同的值
 * - `cleared`   原本有密钥，本次清空
 */
export type AiConfigApiKeyAction = 'absent' | 'unchanged' | 'set' | 'rotated' | 'cleared'

/**
 * 配置的审计快照。**构造时就已脱敏**：
 * 原始 systemPrompt / roleScope 文本与任何密钥物料都不会出现在本结构里，
 * 因此调用方无论怎么用都不可能把它们写进审计日志。
 */
export interface LlmConfigAuditSnapshot {
  vendor: LlmVendor
  model: string
  baseURL: string
  temperature: number
  enabled: boolean
  systemPromptChars: number
  /** sha256 前 12 位十六进制。用于判断「是否改动 / 是否改回原值」，不可还原原文。 */
  systemPromptHash: string
  roleScopeChars: number
  roleScopeHash: string
  /** 禁词表本身是运营配置，不是用户数据，可如实记录（差异按增删列出，并封顶）。 */
  forbiddenWords: string[]
  /** 只记「是否已配置密钥」这个布尔，绝不记密钥本身。 */
  apiKeyConfigured: boolean
  /** 该功能位是否已被单独配置过（false = 仍在继承父键）。 */
  explicitlyConfigured: boolean
  /** 当时实际生效的功能位；继承中的子键会指向父键。 */
  effectiveFeature: string
}

/** 差异 payload 里单个标量字段的前后值。 */
interface ScalarChange {
  from: string | number | boolean
  to: string | number | boolean
}

interface TextChange {
  fromChars: number
  toChars: number
  fromHash: string
  toHash: string
}

interface ForbiddenWordsChange {
  fromCount: number
  toCount: number
  added: string[]
  removed: string[]
  /** added/removed 被截断时为 true —— 如实说明列表不完整，不假装是全量。 */
  truncated: boolean
}

interface ApiKeyChange {
  action: AiConfigApiKeyAction
  configuredFrom: boolean
  configuredTo: boolean
}

/**
 * 刻意用 type 而不是 interface：AuditService.write 的 payload 形参是
 * `Record<string, unknown>`，而 interface **不会**获得隐式索引签名，
 * 传进去会 TS2322。改回 interface 前请先看这条。
 */
export type AiConfigAuditPayload = {
  /** 管理员操作的功能位（不是解析后的父键）。 */
  feature: string
  /** 本次实际改动的配置项名；空数组 = 提交了但什么都没变（也如实落一条）。 */
  changedFields: string[]
  changes: Record<string, ScalarChange | TextChange | ForbiddenWordsChange | ApiKeyChange>
  /** 密钥动作单独提到顶层，便于事后只筛「谁动过密钥」。 */
  apiKeyAction: AiConfigApiKeyAction
  /** 本次是否让一个「继承中」的子键脱离父键、固化为独立配置。 */
  inheritanceBroken: boolean
  effectiveFeatureFrom: string
  effectiveFeatureTo: string
}

/** 禁词差异列表的封顶条数（两侧各自）。超出只列前 N 条并置 truncated。 */
const MAX_FORBIDDEN_WORD_DIFF = 10

/** 内容哈希：sha256 前 12 位。空串固定返回空串，避免「空」和「有内容」哈希看着一样。 */
export function auditTextHash(text: string): string {
  if (text.length === 0) return ''
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)
}

/**
 * 构造 AI 配置变更的审计 payload。
 *
 * 纯函数：只吃两个**已脱敏**的快照 + 密钥动作枚举，因此不可能泄漏密钥或提示词全文。
 */
export function buildAiConfigAuditPayload(
  feature: string,
  before: LlmConfigAuditSnapshot,
  after: LlmConfigAuditSnapshot,
  apiKeyAction: AiConfigApiKeyAction,
): AiConfigAuditPayload {
  const changes: AiConfigAuditPayload['changes'] = {}
  const changedFields: string[] = []

  const scalar = <K extends 'vendor' | 'model' | 'baseURL' | 'temperature' | 'enabled'>(key: K): void => {
    if (before[key] === after[key]) return
    changedFields.push(key)
    changes[key] = { from: before[key], to: after[key] }
  }
  scalar('vendor')
  scalar('model')
  scalar('baseURL')
  scalar('temperature')
  scalar('enabled')

  if (before.systemPromptHash !== after.systemPromptHash) {
    changedFields.push('systemPrompt')
    changes['systemPrompt'] = {
      fromChars: before.systemPromptChars,
      toChars: after.systemPromptChars,
      fromHash: before.systemPromptHash,
      toHash: after.systemPromptHash,
    }
  }
  if (before.roleScopeHash !== after.roleScopeHash) {
    changedFields.push('roleScope')
    changes['roleScope'] = {
      fromChars: before.roleScopeChars,
      toChars: after.roleScopeChars,
      fromHash: before.roleScopeHash,
      toHash: after.roleScopeHash,
    }
  }

  const beforeWords = new Set(before.forbiddenWords)
  const afterWords = new Set(after.forbiddenWords)
  const added = after.forbiddenWords.filter((word) => !beforeWords.has(word))
  const removed = before.forbiddenWords.filter((word) => !afterWords.has(word))
  if (added.length > 0 || removed.length > 0) {
    changedFields.push('forbiddenWords')
    changes['forbiddenWords'] = {
      fromCount: before.forbiddenWords.length,
      toCount: after.forbiddenWords.length,
      added: added.slice(0, MAX_FORBIDDEN_WORD_DIFF),
      removed: removed.slice(0, MAX_FORBIDDEN_WORD_DIFF),
      truncated: added.length > MAX_FORBIDDEN_WORD_DIFF || removed.length > MAX_FORBIDDEN_WORD_DIFF,
    }
  }

  // 密钥：只落动作 + 前后「是否已配置」。这里**故意**没有 from/to/长度/哈希字段，
  // 改这段之前请先读本文件开头的铁律。
  if (apiKeyAction !== 'absent' && apiKeyAction !== 'unchanged') {
    changedFields.push('apiKey')
  }
  changes['apiKey'] = {
    action: apiKeyAction,
    configuredFrom: before.apiKeyConfigured,
    configuredTo: after.apiKeyConfigured,
  }

  return {
    feature,
    changedFields,
    changes,
    apiKeyAction,
    inheritanceBroken: !before.explicitlyConfigured && after.explicitlyConfigured,
    effectiveFeatureFrom: before.effectiveFeature,
    effectiveFeatureTo: after.effectiveFeature,
  }
}

/**
 * 本次更新是否翻转了「启用」开关。
 * 关停 / 启用某个 AI 能力是独立的安全事件，调用方据此额外落一条可单独筛选的审计。
 */
export function didToggleEnabled(before: LlmConfigAuditSnapshot, after: LlmConfigAuditSnapshot): boolean {
  return before.enabled !== after.enabled
}
