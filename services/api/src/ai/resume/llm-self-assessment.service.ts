// ============================================================
// 自我探索 · 倾向参考 —— LLM 解读服务（v1）
//
// 合规口径（与 docs/compliance/compliance-boundary.md §4.5 同档）：
// - LLM 仅生成自然语言解读（note / summary），禁用「适合 / 不适合 / 推荐岗位 / 推荐企业
//   / 适合工作 / 适合做 / 你必须 / 不得 / 排序 / 排名 / Top%」等指令性词。
// - 不复用 MBTI / 大五 / DISC / 霍兰德 / SCL / PHQ / GAD / MMPI 等任何标签或量表。
// - Prompt 末尾强制追加「本解读基于本人作答，仅作为自助参考，不代任何招聘结果、能力证明或心理评估」。
// - 答案原文不送 LLM：仅送维度 key/label/strength 与简短证据题号。
// - 命中合规词 → 丢弃该条 note；命中「适合 / 不适合」级 → 整体拒答。
// - 解读正文上限 MAX_NOTE_CHARS = 300 / MAX_SUMMARY_CHARS = 300。
// - 复用 resume_optimize LLM 接入（密钥仅服务端）。
// ============================================================

import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { LlmConfigService } from '../llm/llm-config.service'
import {
  LLM_BUSY_MESSAGE,
  LLM_TIMEOUT_MS,
  LlmBusyError,
  LlmTimeoutError,
  llmFetchJson,
  llmTimeoutMessage,
} from '../llm/llm-http'
import { llmEmptyResponseError, llmUnreachableError, llmUpstreamStatusError } from '../llm/llm-failure'
import { normalizeLlmUsage, type AiLlmCallSink, type RawLlmUsage } from '../ai-log.service'
import type { SelfAssessmentDimensionResult } from './self-assessment.types'

const MAX_NOTE_CHARS = 300
const MAX_SUMMARY_CHARS = 300

/** 「适合 / 不适合 / 推荐岗位」级指令词：命中即整体拒答。 */
const HARD_REJECT = [
  '适合岗位',
  '适合工作',
  '适合做',
  '不适合',
  '不得从事',
  '应该避免',
  '你必须',
  '推荐岗位',
  '推荐企业',
  '推荐给企业',
  '建议岗位',
  '匹配岗位',
  '排序',
  '排名',
  'Top%',
  '前 10%',
  'MBTI',
  '大五人格',
  '霍兰德',
  'DISC',
  'SCL',
  'PHQ',
  'GAD',
  'MMPI',
  '抑郁',
  '焦虑',
  '人格',
  '心理测评',
  '临床',
  '诊断',
]

/** 软拒绝词：命中即丢弃该条 note，不影响整体。 */
const SOFT_REJECT = [
  '适合岗位',
  '推荐岗位',
  '推荐给企业',
  '适合做',
  '适合工作',
  '匹配岗位',
  '排行榜',
  '排名',
  'Top%',
]

function containsAny(text: string, words: string[]): string | null {
  for (const w of words) {
    if (text.includes(w)) return w
  }
  return null
}

export interface LlmSelfAssessmentInput {
  /** 纯函数评分结果（已含 note=null 状态） */
  scored: {
    dimensions: SelfAssessmentDimensionResult[]
    summary: string | null
  }
  /** 同意颗粒度（仅元数据；不向 LLM 透露用户是否勾选敏感题） */
  consent: { nonSensitive: boolean; sensitive: boolean }
  /**
   * 每次真实 LLM 调用结束后回调 provider + token usage。
   *
   * 缺了它，selfAssessment 这条**付费**调用会零 token 落账，
   * Admin「分能力调用量与成本」把它当 token 计费能力渲染成 ¥0.0000，
   * 即对一次真实花钱的调用谎称免费。
   */
  onLlmCall?: AiLlmCallSink
}

export interface LlmSelfAssessmentOutput {
  status: 'completed' | 'rejected'
  /** 整体拒答原因（仅整体拒答时出现） */
  failReason?: string
  dimensions: SelfAssessmentDimensionResult[]
  summary: string | null
  providerName: string
}

interface LlmParsedOutput {
  dimensions?: Array<{ key?: string; note?: string }>
  summary?: string
}

@Injectable()
export class LlmSelfAssessmentService {
  private readonly logger = new Logger(LlmSelfAssessmentService.name)

  constructor(private readonly config: LlmConfigService) {}

  async summarize(input: LlmSelfAssessmentInput): Promise<LlmSelfAssessmentOutput> {
    const providerName = this.config.getConfig('self_assessment').vendor
    let raw: string
    try {
      raw = await this.callLlm(input.scored.dimensions, input.onLlmCall)
    } catch (err) {
      // LLM 不可用 → 优雅降级：返回 strength + null note（不阻塞主流程）
      this.logger.warn(`self_assessment.llm_unavailable degraded=${(err as Error).message}`)
      return {
        status: 'completed',
        dimensions: input.scored.dimensions.map((d) => ({ ...d, note: null })),
        summary: null,
        providerName: 'llm_unavailable',
      }
    }

    const parsed = this.parse(raw)
    if (!parsed) {
      this.logger.warn('self_assessment.parse_failed')
      return {
        status: 'completed',
        dimensions: input.scored.dimensions.map((d) => ({ ...d, note: null })),
        summary: null,
        providerName,
      }
    }

    // 整体拒答：命中「适合 / 不适合」级指令
    const joined = JSON.stringify(parsed)
    const hardHit = containsAny(joined, HARD_REJECT)
    if (hardHit) {
      this.logger.warn(`self_assessment.hard_reject term=${hardHit}`)
      return {
        status: 'rejected',
        failReason: '本次解读未能生成合规结果，请重新作答或稍后重试',
        dimensions: input.scored.dimensions.map((d) => ({ ...d, note: null })),
        summary: null,
        providerName,
      }
    }

    // 软拒绝：丢弃命中的 note，按 dim 落入 null
    const dims: SelfAssessmentDimensionResult[] = input.scored.dimensions.map((d) => {
      const out = (parsed.dimensions ?? []).find((x) => x.key === d.key)
      if (!out || typeof out.note !== 'string' || !out.note.trim()) {
        return { ...d, note: null }
      }
      const trimmed = out.note.trim().slice(0, MAX_NOTE_CHARS)
      const soft = containsAny(trimmed, SOFT_REJECT)
      if (soft) {
        this.logger.warn(`self_assessment.soft_reject dim=${d.key} term=${soft}`)
        return { ...d, note: null }
      }
      return { ...d, note: trimmed }
    })

    let summary: string | null = null
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
      const trimmed = parsed.summary.trim().slice(0, MAX_SUMMARY_CHARS)
      const soft = containsAny(trimmed, SOFT_REJECT)
      summary = soft ? null : trimmed
    }

    return {
      status: 'completed',
      dimensions: dims,
      summary,
      providerName,
    }
  }

  private parse(raw: string): LlmParsedOutput | null {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    try {
      return JSON.parse(cleaned) as LlmParsedOutput
    } catch {
      const a = cleaned.indexOf('{')
      const b = cleaned.lastIndexOf('}')
      if (a >= 0 && b > a) {
        try { return JSON.parse(cleaned.slice(a, b + 1)) as LlmParsedOutput } catch { return null }
      }
      return null
    }
  }

  /**
   * 独立功能位 self_assessment（S0-3 拆键；未单独配置时继承 resume_optimize，密钥仅服务端）。
   * 答案原文不送 LLM：仅送维度 key/label/strength + 简短证据题号。
   *
   * 注：2026-07-31 的共用键注释漏登记了本消费方，S0-3 一并补上（风险 R3）。
   * 本键不可用只影响解读文字（note/summary 置 null），问卷打分是纯函数，主流程不受影响。
   */
  private async callLlm(dimensions: SelfAssessmentDimensionResult[], onLlmCall?: AiLlmCallSink): Promise<string> {
    const apiKey = this.config.getApiKey('self_assessment')
    const cfg = this.config.getConfig('self_assessment')
    if (!apiKey || !cfg.enabled) {
      // 未配置 = 一次都没打到模型，不回调 onLlmCall（callCount 保持 0 → 不落账）
      throw new ServiceUnavailableException({ error: { code: 'AI_NOT_CONFIGURED', message: 'AI 服务暂未启用' } })
    }
    const providerLabel = `llm:${cfg.vendor}:${cfg.model}`
    const url = `${cfg.baseURL.replace(/\/$/, '')}/chat/completions`
    const system =
      '你是「自我探索 · 倾向参考」工具的解读助手。' +
      '输入是 5 个维度（兴趣偏好 / 工作风格 / 团队偏向 / 价值取向 / 求职动机）的强度分（0-5）。' +
      '请为每个维度写一段自然语言解读（≤ 300 字），并写一段整体解读（≤ 300 字）。' +
      '\n硬性要求：' +
      '\n1. 不引用任何临床量表、心理学标签、性格类型；不输出诊断或疾病相关表述。' +
      '\n2. 不出现「适合 / 不适合 / 推荐岗位 / 推荐企业 / 适合做 / 应该 / 你必须 / 排序 / 排名 / Top%」等指令性词。' +
      '\n3. 解读只描述本次作答的倾向，不延伸到对人格、能力、心理的判断，不做职业排名。' +
      '\n4. 整体解读末尾追加：「本解读基于本人作答，仅作为自助参考，不代任何招聘结果、能力证明或心理评估」。' +
      '\n只输出 JSON（不要 markdown 代码块）：' +
      '{"dimensions":[{"key":"interest","note":"..."},{"key":"style","note":"..."},{"key":"team","note":"..."},{"key":"value","note":"..."},{"key":"motivation","note":"..."}],"summary":"整体解读"}'

    const user =
      '请基于以下 5 维度强度生成本次自然语言解读：\n' +
      dimensions.map((d) => `${d.label}（${d.key}）：强度 ${d.strength}/5`).join('\n')

    let res: Awaited<ReturnType<typeof llmFetchJson>>
    try {
      res = await llmFetchJson(
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: cfg.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
            temperature: cfg.temperature,
            stream: false,
            // DeepSeek V4：关闭 thinking，避免 reasoning 占满输出导致 content 为空
            ...(cfg.model.startsWith('deepseek-v4') ? { thinking: { type: 'disabled' } } : {}),
          }),
        },
        { timeoutMs: LLM_TIMEOUT_MS },
      )
    } catch (error) {
      if (error instanceof LlmBusyError) {
        // 闸门拒绝时请求根本没发出 → 不落账，否则等于凭空记一次没花过的调用。
        throw new ServiceUnavailableException({ error: { code: 'AI_BUSY', message: LLM_BUSY_MESSAGE } })
      }
      if (error instanceof LlmTimeoutError) {
        // 已经发出请求（可能已计费），必须记一次调用，否则失败调用整条不落账
        onLlmCall?.({ provider: providerLabel })
        throw new ServiceUnavailableException({
          error: { code: 'AI_SELF_ASSESSMENT_TIMEOUT', message: llmTimeoutMessage('AI 倾向解读', error.timeoutMs) },
        })
      }
      // 已经发出请求（可能已计费），必须记一次调用，否则失败调用整条不落账
      onLlmCall?.({ provider: providerLabel })
      throw llmUnreachableError('AI 自我探索解读服务')
    }
    if (!res.ok) {
      onLlmCall?.({ provider: providerLabel })
      throw llmUpstreamStatusError('AI 自我探索解读服务', res.status)
    }
    const data = res.data as { choices?: Array<{ message?: { content?: string } }>; usage?: RawLlmUsage } | null
    onLlmCall?.({ provider: providerLabel, tokenUsage: normalizeLlmUsage(data?.usage) })
    const reply = data?.choices?.[0]?.message?.content?.trim()
    if (!reply) throw llmEmptyResponseError('AI 自我探索解读服务')
    return reply
  }
}
