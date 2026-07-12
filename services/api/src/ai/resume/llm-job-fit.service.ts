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
// - 输出全文扫描：禁词、数字百分比（如「85%」）、诱导编造/自相矛盾建议命中 → 重试一次 → 仍命中诚实失败。
// - 简历原文/岗位文本/输出不写日志（仅元数据）。
// ============================================================

const BANNED = [
  '录用概率', '录用率', '通过率', '保过', '保录用', '保面试', '精准命中',
  'AI匹配率', '匹配率', '内部题库', '一键投递', '立即投递', '平台投递',
] as const

// ── 输出安全防线（Mavis 2D 验收补丁）────────────────────────────────────────
// A. 自相矛盾判断（如「符合本科要求…大专」）：全局 violation → 重试 → 连续命中诚实失败。
// (?<!不) 负向断言:「学历不符合要求…本科…大专」是**正确**的差距表述,不能误伤;
// 只拦「(基本)符合本科…大专」这类自相矛盾。
const CONTRADICTION_PATTERNS: RegExp[] = [
  /(?<!不)符合[^。；;]{0,12}本科[^。；;]{0,24}(大专|专科)/,
  /(大专|专科)[^。；;]{0,24}(?<!不)符合[^。；;]{0,12}本科/,
  /学历符合[^。；;]{0,24}(大专|专科)/,
]

// B. 诱导编造经历（「替换为/改写为/包装成…项目/经历」「删除…行政/经历」）：建议级过滤。
const FABRICATION_HINT =
  /(替换为|改写为|包装成|伪装成)[^。；;]{0,30}(项目|经历|公司|学历|证书|技能)|删除[^。；;]{0,20}(行政|工作|经历|描述|学历)/

// C. 无依据示例数字（「如/例如/比如…100份」）：建议级过滤。已有的百分比拦截保持全局 violation。
const EXAMPLE_NUMBER = /(?:如|例如|比如)[^。；;，,]{0,40}\d/

/** 高风险建议被过滤后的安全兜底（不诱导编造、不给示例数字）。 */
const SAFE_FALLBACK_SUGGESTION =
  '只基于本人真实经历补充岗位相关内容；如确有相关学习、项目、证书或成果，请写清事实背景、个人职责与实际结果，不要虚构经历或数字。'

function isRiskyAdvice(text: string): boolean {
  return FABRICATION_HINT.test(text) || EXAMPLE_NUMBER.test(text)
}

function hasContradiction(text: string): boolean {
  return CONTRADICTION_PATTERNS.some((p) => p.test(text))
}

export interface JobFitJobContext {
  title: string
  company?: string | null
  description?: string | null
  requirements?: string | null
}

/** 与 @ai-job-print/shared 的 JobFitDecisionSupport 保持同一可选响应契约。 */
export interface JobFitDecisionSupport {
  analysisVersion: 'job_fit_m1_5'
  keywordCoverage?: {
    matched: string[]
    missing: string[]
  }
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
  /** M1.5 可选决策辅助；旧模型不输出时保持缺失。 */
  decisionSupport?: JobFitDecisionSupport
}

export interface JobFitTokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface JobFitLlmResult {
  payload: JobFitPayload
  provider: string
  tokenUsage?: JobFitTokenUsage
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
  if (/(?:符合本科要求|学历符合)[^。；;]{0,40}(?:大专|专科)/.test(text)) return '学历自相矛盾'
  if (/(?:大专|专科)[^。；;]{0,40}(?:符合本科要求|学历符合)/.test(text)) return '学历自相矛盾'
  return null
}

function isUnsafeAdvice(text: string): boolean {
  if (/(?:如|例如|比如)[^。；;，,]{0,40}\d/.test(text)) return true
  if (/(?:替换为|改写为|包装成)[^。；;，,]{0,40}(?:项目|经历|公司|学历|证书|技能)/.test(text)) return true
  if (/删除[^。；;，,]{0,30}(?:行政|工作|经历|描述|学历)/.test(text)) return true
  return false
}

function safeAdviceFallback(): string {
  return '只基于本人真实经历补充岗位相关内容；如确有相关学习、项目、证书或成果，请写清事实背景、个人职责与实际结果，不要虚构经历或数字。'
}

@Injectable()
export class LlmJobFitService {
  private readonly logger = new Logger(LlmJobFitService.name)

  constructor(private readonly config: LlmConfigService) {}

  async analyze(resumeText: string, job: JobFitJobContext): Promise<JobFitLlmResult> {
    const sys =
      '你是求职者本人的简历顾问。基于求职者的简历原文与目标岗位信息，输出「岗位匹配度参考」与定向优化建议。' +
      '这只是给求职者本人修改简历、准备投递用的参考，不是招聘评估，不代表录用结果。' +
      '\n硬性要求：' +
      '\n1. fitLevel 只能是 reference_high / reference_medium / reference_low（参考等级），绝不输出任何百分比、匹配率、录用概率、通过率。' +
      '\n2. matchPoints 中每条的 evidence 必须是简历原文中真实出现的内容（原文摘录），绝不编造。' +
      '\n3. gapPoints 的 suggestion 只谈表达优化与准备方向（如补充量化数据、突出某段经历），绝不虚构求职者没有的经历或技能。' +
      '\n4. 不出现「一键投递/立即投递/平台投递」等表述；投递请引导用户前往岗位来源平台。' +
      '\n5. 不得建议用户删除、替换、包装真实经历来伪装成目标岗位。跨岗位差距较大时，应建议"如确有相关学习/项目/证书，请补充真实经历，否则优先选择更匹配的岗位"。' +
      '\n6. 不得给出无依据的示例数字（如"100份/月""3次/周""提升30%"），只能说"补充你实际处理的数量、频次或结果"。' +
      '\n7. 不得出现自相矛盾判断（如"大专但符合本科要求"）。学历、年限、技能不符合岗位要求时，直接说明差距（如"学历不符合要求：岗位要求本科及以上，当前简历为大专学历"）。' +
      '\n8. decisionSupport 为可选 M1.5 决策辅助；输出时 analysisVersion 必须为 job_fit_m1_5。keywordCoverage.matched 只列简历原文或岗位文本中有依据的关键词；missing 只列该岗位的待补充关键词。' +
      '\n5. 不得建议用户删除、替换、包装真实经历来伪装成目标岗位；跨岗位差距较大时，应建议“如确有相关学习/项目/证书，请补充真实经历，否则优先选择更匹配岗位”。' +
      '\n6. 不得给出无依据的示例数字（例如“100份/月”“3次/周”“提升30%”）；只能说“补充你实际处理的数量、频次或结果”。' +
      '\n7. 不得出现自相矛盾判断，例如“大专但符合本科要求”；学历、年限、技能不符合时要直接说差距。' +
      '\n只输出 JSON（不要 markdown 代码块）：' +
      '{"fitLevel":"reference_high|reference_medium|reference_low","summary":"2-3 句总评（说明这是参考）",' +
      '"matchPoints":[{"point":"与岗位要求的匹配点","evidence":"简历原文摘录(≤60字)"}](2-5 条),' +
      '"gapPoints":[{"gap":"与岗位要求的差距","suggestion":"表达/准备建议"}](1-4 条),' +
      '"targetedSuggestions":["针对该岗位修改简历的具体建议"](2-5 条),' +
      '"decisionSupport":{"analysisVersion":"job_fit_m1_5","keywordCoverage":{"matched":["有依据关键词"],"missing":["岗位待补充关键词"]}}(可选)}'

    const jobText =
      `岗位：${job.title}${job.company ? `（${job.company}）` : ''}\n` +
      (job.description ? `岗位描述：${job.description.slice(0, 1500)}\n` : '') +
      (job.requirements ? `任职要求：${job.requirements.slice(0, 1500)}\n` : '')
    const user = `【目标岗位】\n${jobText}\n【简历原文】\n${resumeText.slice(0, 8000)}`

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const t0 = Date.now()
      const raw = await this.callLlm(sys, user)
      const parsed = this.parse(raw.text)
      const payload = this.validate(parsed, resumeText, job)
      if (!payload) {
        this.logger.warn(`jobfit.invalid attempt=${attempt} ms=${Date.now() - t0}`)
        continue
      }
      // 建议级安全过滤（不触发重试）：诱导编造 / 无依据示例数字 → 过滤或替换为安全兜底
      const sanitized = this.sanitizeAdvice(payload)
      // 全局 violation（触发重试）：禁词 / 百分比 / 自相矛盾判断
      const serialized = JSON.stringify(sanitized)
      const violation = findViolation(serialized)
      if (violation) {
        this.logger.warn(`jobfit.banned attempt=${attempt}`)
        continue
      }
      if (hasContradiction(serialized)) {
        this.logger.warn(`jobfit.contradiction attempt=${attempt}`)
        continue
      }
      this.logger.log(`jobfit.ok ms=${Date.now() - t0} match=${sanitized.matchPoints.length} gap=${sanitized.gapPoints.length}`)
      return { payload: sanitized, provider: raw.provider, tokenUsage: raw.tokenUsage }
    }
    throw new ServiceUnavailableException({
      error: { code: 'AI_JOB_FIT_FAILED', message: '岗位匹配参考生成失败，请稍后重试' },
    })
  }

  /**
   * 建议级安全过滤（Mavis 2D 验收补丁）：
   * - targetedSuggestions：过滤诱导编造 / 无依据示例数字的建议；全被过滤时补安全兜底。
   * - gapPoints.suggestion：命中高风险表达时整条替换为安全兜底。
   * 不触发重试（内容仍可用），但高风险表达绝不直接发给用户。
   */
  private sanitizeAdvice(payload: JobFitPayload): JobFitPayload {
    let filtered = 0
    const targetedSuggestions = payload.targetedSuggestions.filter((sug) => {
      if (isRiskyAdvice(sug)) { filtered += 1; return false }
      return true
    })
    if (targetedSuggestions.length === 0) targetedSuggestions.push(SAFE_FALLBACK_SUGGESTION)
    const gapPoints = payload.gapPoints.map((g) => {
      if (isRiskyAdvice(g.suggestion)) { filtered += 1; return { ...g, suggestion: SAFE_FALLBACK_SUGGESTION } }
      return g
    })
    if (filtered > 0) this.logger.warn(`jobfit.advice_filtered count=${filtered}`)
    return { ...payload, targetedSuggestions, gapPoints }
  }

  // ── 校验 ──────────────────────────────────────────────────────────────────

  private validate(p: Partial<JobFitPayload> | null, resumeText: string, job: JobFitJobContext): JobFitPayload | null {
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
      .map((g) => {
        const suggestion = g.suggestion.trim()
        return {
          gap: g.gap.trim().slice(0, 200),
          suggestion: (isUnsafeAdvice(suggestion) ? safeAdviceFallback() : suggestion).slice(0, 300),
        }
      })
      .slice(0, 4)

    const targetedSuggestions = p.targetedSuggestions
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .filter((s) => !isUnsafeAdvice(s.trim()))
      .map((s) => s.trim().slice(0, 300))
      .slice(0, 5)
    if (targetedSuggestions.length === 0) targetedSuggestions.push(safeAdviceFallback())

    const decisionSupport = this.validateDecisionSupport(p.decisionSupport, resumeText, job)

    return {
      fitLevel: p.fitLevel as JobFitPayload['fitLevel'],
      summary: p.summary.trim().slice(0, 500),
      matchPoints,
      gapPoints,
      targetedSuggestions,
      ...(decisionSupport ? { decisionSupport } : {}),
    }
  }

  /**
   * M1.5 是可选增量：旧模型缺失该对象时不补默认值。matched 是正向匹配结论，
   * 因此必须至少能从简历或岗位文本找到依据；missing 是岗位待补充项，保留模型
   * 基于岗位上下文给出的关键词，不要求出现在简历中。
   */
  private validateDecisionSupport(
    value: unknown,
    resumeText: string,
    job: JobFitJobContext,
  ): JobFitDecisionSupport | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const support = value as { analysisVersion?: unknown; keywordCoverage?: unknown }
    if (support.analysisVersion !== 'job_fit_m1_5') return undefined
    if (!support.keywordCoverage || typeof support.keywordCoverage !== 'object' || Array.isArray(support.keywordCoverage)) {
      return { analysisVersion: 'job_fit_m1_5' }
    }

    const coverage = support.keywordCoverage as { matched?: unknown; missing?: unknown }
    if (!Array.isArray(coverage.matched) || !Array.isArray(coverage.missing)) {
      return { analysisVersion: 'job_fit_m1_5' }
    }

    const cleanKeywords = (keywords: unknown[]): string[] => [
      ...new Set(
        keywords
          .filter((keyword): keyword is string => typeof keyword === 'string' && keyword.trim().length > 0)
          .map((keyword) => keyword.trim().slice(0, 80)),
      ),
    ]
    const sourceText = normalizeForMatch(
      [resumeText, job.title, job.company, job.description, job.requirements]
        .filter((part): part is string => typeof part === 'string')
        .join('\n'),
    )
    const matched = cleanKeywords(coverage.matched).filter((keyword) => {
      const needle = normalizeForMatch(keyword)
      return needle.length > 0 && sourceText.includes(needle)
    })

    return {
      analysisVersion: 'job_fit_m1_5',
      keywordCoverage: {
        matched,
        missing: cleanKeywords(coverage.missing),
      },
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
  private async callLlm(system: string, user: string): Promise<{
    text: string
    provider: string
    tokenUsage?: JobFitTokenUsage
  }> {
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
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
        promptTokens?: number
        completionTokens?: number
        totalTokens?: number
      }
    }
    const reply = data.choices?.[0]?.message?.content?.trim()
    if (!reply) {
      throw new ServiceUnavailableException({ error: { code: 'AI_UNAVAILABLE', message: 'AI 模型未返回内容' } })
    }
    return {
      text: reply,
      provider: `llm:${cfg.vendor}:${cfg.model}`,
      tokenUsage: normalizeTokenUsage(data.usage),
    }
  }
}

function normalizeTokenUsage(usage: {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
} | undefined): JobFitTokenUsage | undefined {
  if (!usage) return undefined
  const promptTokens = toNonNegativeInt(usage.prompt_tokens ?? usage.promptTokens)
  const completionTokens = toNonNegativeInt(usage.completion_tokens ?? usage.completionTokens)
  const totalTokens = toNonNegativeInt(usage.total_tokens ?? usage.totalTokens) || promptTokens + completionTokens
  if (totalTokens <= 0) return undefined
  return { promptTokens, completionTokens, totalTokens }
}

function toNonNegativeInt(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}
