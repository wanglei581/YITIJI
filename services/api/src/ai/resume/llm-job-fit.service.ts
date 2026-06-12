import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { LlmConfigService } from '../llm/llm-config.service'

// ============================================================
// 2D 目标岗位定向优化 + 岗位匹配度参考。
//
// 合规（硬约束）：
// - 输出是「匹配度参考」：参考等级（高/中/低），绝不输出百分比、AI匹配率、
//   录用概率、通过率等任何量化承诺；投递动作只引导「去来源平台投递」。
// - 防编造（对齐 2B 优化契约）：matchPoints 的 evidence 必须能在简历原文中
//   找到（归一化子串匹配）；找不到的匹配点直接丢弃；建议只谈表达与准备方向，
//   不替用户虚构经历。
// - 输出全文扫描：禁词或数字百分比（如「85%」）命中 → 重试一次 → 仍命中诚实失败。
// - 简历原文/岗位文本/输出不写日志（仅元数据）。
// ============================================================

const BANNED = [
  '录用概率', '录用率', '通过率', '保过', '保录用', '保面试', '精准命中',
  'AI匹配率', '匹配率', '内部题库', '一键投递', '立即投递', '平台投递',
] as const

export interface JobFitJobContext {
  title: string
  company?: string | null
  description?: string | null
  requirements?: string | null
}

export interface JobFitPayload {
  /** 参考等级（非量化承诺）：reference_high / reference_medium / reference_low */
  fitLevel: 'reference_high' | 'reference_medium' | 'reference_low'
  summary: string
  /** 匹配点：evidence 必须出自简历原文（服务端已校验） */
  matchPoints: Array<{ point: string; evidence: string }>
  /** 差距与建议：只谈准备方向/表达，不编造经历 */
  gapPoints: Array<{ gap: string; suggestion: string }>
  /** 简历定向优化建议（表达层面） */
  targetedSuggestions: string[]
}

/** 归一化（与 2B 优化一致）：去空白与常见标点后做子串匹配。 */
function normalizeForMatch(text: string): string {
  return text.replace(/[\s\u3000,，.。;；:：、·\-—()（）]/g, '')
}

function findViolation(text: string): string | null {
  for (const term of BANNED) {
    if (text.includes(term)) return term
  }
  const pct = text.match(/\d{1,3}\s*%/)
  if (pct) return pct[0]
  return null
}

@Injectable()
export class LlmJobFitService {
  private readonly logger = new Logger(LlmJobFitService.name)

  constructor(private readonly config: LlmConfigService) {}

  async analyze(resumeText: string, job: JobFitJobContext): Promise<JobFitPayload> {
    const sys =
      '你是求职者本人的简历顾问。基于求职者的简历原文与目标岗位信息，输出「岗位匹配度参考」与定向优化建议。' +
      '这只是给求职者本人修改简历、准备投递用的参考，不是招聘评估，不代表录用结果。' +
      '\n硬性要求：' +
      '\n1. fitLevel 只能是 reference_high / reference_medium / reference_low（参考等级），绝不输出任何百分比、匹配率、录用概率、通过率。' +
      '\n2. matchPoints 中每条的 evidence 必须是简历原文中真实出现的内容（原文摘录），绝不编造。' +
      '\n3. gapPoints 的 suggestion 只谈表达优化与准备方向（如补充量化数据、突出某段经历），绝不虚构求职者没有的经历或技能。' +
      '\n4. 不出现「一键投递/立即投递/平台投递」等表述；投递请引导用户前往岗位来源平台。' +
      '\n只输出 JSON（不要 markdown 代码块）：' +
      '{"fitLevel":"reference_high|reference_medium|reference_low","summary":"2-3 句总评（说明这是参考）",' +
      '"matchPoints":[{"point":"与岗位要求的匹配点","evidence":"简历原文摘录(≤60字)"}](2-5 条),' +
      '"gapPoints":[{"gap":"与岗位要求的差距","suggestion":"表达/准备建议"}](1-4 条),' +
      '"targetedSuggestions":["针对该岗位修改简历的具体建议"](2-5 条)}'

    const jobText =
      `岗位：${job.title}${job.company ? `（${job.company}）` : ''}\n` +
      (job.description ? `岗位描述：${job.description.slice(0, 1500)}\n` : '') +
      (job.requirements ? `任职要求：${job.requirements.slice(0, 1500)}\n` : '')
    const user = `【目标岗位】\n${jobText}\n【简历原文】\n${resumeText.slice(0, 8000)}`

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const t0 = Date.now()
      const raw = await this.callLlm(sys, user)
      const parsed = this.parse(raw)
      const payload = this.validate(parsed, resumeText)
      if (!payload) {
        this.logger.warn(`jobfit.invalid attempt=${attempt} ms=${Date.now() - t0}`)
        continue
      }
      const violation = findViolation(JSON.stringify(payload))
      if (violation) {
        this.logger.warn(`jobfit.banned attempt=${attempt}`)
        continue
      }
      this.logger.log(`jobfit.ok ms=${Date.now() - t0} match=${payload.matchPoints.length} gap=${payload.gapPoints.length}`)
      return payload
    }
    throw new ServiceUnavailableException({
      error: { code: 'AI_JOB_FIT_FAILED', message: '岗位匹配参考生成失败，请稍后重试' },
    })
  }

  // ── 校验 ──────────────────────────────────────────────────────────────────

  private validate(p: Partial<JobFitPayload> | null, resumeText: string): JobFitPayload | null {
    if (!p) return null
    const levels = ['reference_high', 'reference_medium', 'reference_low']
    if (!levels.includes(p.fitLevel ?? '') || typeof p.summary !== 'string' || !p.summary.trim()) return null
    if (!Array.isArray(p.matchPoints) || !Array.isArray(p.gapPoints) || !Array.isArray(p.targetedSuggestions)) return null

    // 防编造：evidence 必须出自简历原文（归一化子串匹配）；不符的匹配点丢弃
    const normResume = normalizeForMatch(resumeText)
    const matchPoints = p.matchPoints
      .filter((m): m is { point: string; evidence: string } =>
        !!m && typeof m.point === 'string' && typeof m.evidence === 'string' && m.point.trim().length > 0 && m.evidence.trim().length > 0)
      .map((m) => ({ point: m.point.trim().slice(0, 200), evidence: m.evidence.trim().slice(0, 120) }))
      .filter((m) => {
        const needle = normalizeForMatch(m.evidence)
        return needle.length >= 4 && normResume.includes(needle)
      })
      .slice(0, 5)
    if (matchPoints.length === 0) return null // 一条真实匹配点都给不出 → 视为无效输出

    const gapPoints = p.gapPoints
      .filter((g): g is { gap: string; suggestion: string } =>
        !!g && typeof g.gap === 'string' && typeof g.suggestion === 'string' && g.gap.trim().length > 0)
      .map((g) => ({ gap: g.gap.trim().slice(0, 200), suggestion: g.suggestion.trim().slice(0, 300) }))
      .slice(0, 4)

    const targetedSuggestions = p.targetedSuggestions
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim().slice(0, 300))
      .slice(0, 5)
    if (targetedSuggestions.length === 0) return null

    return {
      fitLevel: p.fitLevel as JobFitPayload['fitLevel'],
      summary: p.summary.trim().slice(0, 500),
      matchPoints,
      gapPoints,
      targetedSuggestions,
    }
  }

  private parse(raw: string): Partial<JobFitPayload> | null {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    try {
      return JSON.parse(cleaned) as Partial<JobFitPayload>
    } catch {
      const a = cleaned.indexOf('{')
      const b = cleaned.lastIndexOf('}')
      if (a >= 0 && b > a) {
        try { return JSON.parse(cleaned.slice(a, b + 1)) as Partial<JobFitPayload> } catch { return null }
      }
      return null
    }
  }

  /** 复用 resume_optimize 功能位（同一条"基于简历的定向输出"链路；密钥仅服务端）。 */
  private async callLlm(system: string, user: string): Promise<string> {
    const apiKey = this.config.getApiKey('resume_optimize')
    const cfg = this.config.getConfig('resume_optimize')
    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException({ error: { code: 'AI_NOT_CONFIGURED', message: 'AI 服务暂未启用，请联系管理员配置' } })
    }
    const url = `${cfg.baseURL.replace(/\/$/, '')}/chat/completions`
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
      this.logger.error('jobfit.llm network_error')
      throw new ServiceUnavailableException({ error: { code: 'AI_UNAVAILABLE', message: 'AI 模型连接失败，请稍后重试' } })
    }
    if (!res.ok) {
      this.logger.error(`jobfit.llm upstream_non_2xx status=${res.status}`)
      throw new ServiceUnavailableException({ error: { code: 'AI_UNAVAILABLE', message: `AI 模型返回错误 (${res.status})` } })
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const reply = data.choices?.[0]?.message?.content?.trim()
    if (!reply) {
      throw new ServiceUnavailableException({ error: { code: 'AI_UNAVAILABLE', message: 'AI 模型未返回内容' } })
    }
    return reply
  }
}
