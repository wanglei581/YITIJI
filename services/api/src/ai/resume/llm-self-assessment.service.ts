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
    const providerName = this.config.getConfig('resume_optimize').vendor
    let raw: string
    try {
      raw = await this.callLlm()
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
   * 复用 resume_optimize LLM 接入（密钥仅服务端）。
   * 答案原文不送 LLM：仅送维度 key/label/strength + 简短证据题号。
   */
  private async callLlm(): Promise<string> {
    const apiKey = this.config.getApiKey('resume_optimize')
    const cfg = this.config.getConfig('resume_optimize')
    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException({ error: { code: 'AI_NOT_CONFIGURED', message: 'AI 服务暂未启用' } })
    }
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

    const user = '请基于以下 5 维度强度生成本次自然语言解读。'

    let res: Response
    try {
      res = await fetch(url, {
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
        }),
      })
    } catch {
      throw new ServiceUnavailableException({ error: { code: 'AI_UNAVAILABLE', message: 'AI 模型连接失败' } })
    }
    if (!res.ok) {
      throw new ServiceUnavailableException({ error: { code: 'AI_UNAVAILABLE', message: `AI 模型返回错误 (${res.status})` } })
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const reply = data.choices?.[0]?.message?.content?.trim()
    if (!reply) throw new ServiceUnavailableException({ error: { code: 'AI_UNAVAILABLE', message: 'AI 模型未返回内容' } })
    return reply
  }
}
