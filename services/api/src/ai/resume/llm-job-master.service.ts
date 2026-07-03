import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { LlmConfigService } from '../llm/llm-config.service'

// ============================================================
// 岗位大师（岗位决策分析台）M1 —— 单次结构化 LLM 调用。
// 契约源（SSOT）：packages/shared/src/types/ai.ts（JobMasterFit / JobMasterCareerPath /
// JobMasterRiskItem）。设计：docs/superpowers/specs/2026-07-02-job-master-design.md。
//
// 一次调用输出三段：适配度（fit）+ 晋升路径（careerPath）+ 风险（risks）。
// 薪资不进 LLM（M1 只透传来源方文本，由编排层组装）。
//
// 合规（硬约束，双层防线，沿用 job-fit/career-plan 口径）：
// - fit.level 只能是 reference_high/medium/low（参考等级），绝不输出百分比、匹配率、
//   录用概率、通过率、「精准命中」。
// - 防编造：fit.matchedSkills 与 careerPath.current 的 evidence 必须能在简历原文中
//   找到（归一化子串匹配）；找不到的匹配点丢弃，一条都给不出 → 视为无效重试。
// - gapSkills / firstStep 只谈准备方向与表达，不诱导删除/替换/包装真实经历、不给
//   无依据示例数字（建议级过滤 → 安全兜底，不触发重试）。
// - 风险只用定性三档（level）+ reason + basis；薪资承诺、百分比、禁词 → 全局重试。
// - 简历原文/岗位文本/输出不写日志（仅元数据）；连续命中诚实失败（fail-closed），不产假结果。
// ============================================================

const BANNED = [
  '录用概率', '录用率', '通过率', '保过', '保录用', '保面试', '保证拿', '精准命中',
  'AI匹配率', '匹配率', 'Offer概率', 'Offer 概率', '内部题库',
  '一键投递', '立即投递', '平台投递', '推荐给企业',
] as const

/** 薪资数字承诺（如「月薪可达 15k」）：风险/路径只谈方向，不承诺收入。 */
const SALARY_PROMISE = /(月薪|年薪|薪资|工资)[^。；;]{0,12}(可达|能到|达到|不低于|保底)[^。；;]{0,8}\d/

/** 学历自相矛盾判断（如「符合本科要求…大专」）：全局重试。(?<!不) 避免误伤正确的差距表述。 */
const CONTRADICTION_PATTERNS: RegExp[] = [
  /(?<!不)符合[^。；;]{0,12}本科[^。；;]{0,24}(大专|专科)/,
  /(大专|专科)[^。；;]{0,24}(?<!不)符合[^。；;]{0,12}本科/,
  /学历符合[^。；;]{0,24}(大专|专科)/,
]

/** 诱导编造经历（沿用 2D 口径）：建议级过滤。 */
const FABRICATION_HINT =
  /(替换为|改写为|包装成|伪装成)[^。；;]{0,30}(项目|经历|公司|学历|证书|技能)|删除[^。；;]{0,20}(行政|工作|经历|描述|学历)/

/** 无依据示例数字（沿用 2D 口径）：建议级过滤。 */
const EXAMPLE_NUMBER = /(?:如|例如|比如)[^。；;，,]{0,40}\d/

/** 高风险建议被过滤后的安全兜底（不诱导编造、不给示例数字）。 */
const SAFE_FALLBACK =
  '只基于本人真实经历补充岗位相关内容；如确有相关学习、项目、证书或成果，请写清事实背景、个人职责与实际结果，不要虚构经历或数字。'

const FIT_LEVELS = ['reference_high', 'reference_medium', 'reference_low'] as const
const RISK_LEVELS = ['low', 'medium', 'high'] as const

export interface JobMasterJobContext {
  title: string
  company?: string | null
  description?: string | null
  requirements?: string | null
}

export interface JobMasterPayload {
  fit: {
    level: (typeof FIT_LEVELS)[number]
    summary: string
    matchedSkills: Array<{ skill: string; evidence: string }>
    gapSkills: Array<{ skill: string; suggestion: string; learningDirection?: string; firstStep?: string }>
    keywordCoverage?: { matched: string[]; missing: string[] }
  }
  careerPath: {
    current: { title: string; evidence: string }
    next: { title: string; skillsToBuild: string[]; firstStep: string; rationale?: string }
    target: { title: string; skillsToBuild: string[]; rationale?: string; firstStep?: string }
  }
  risks: Array<{ level: (typeof RISK_LEVELS)[number]; title: string; reason: string; basis: string }>
  interviewPrep?: Array<{ question: string; whyAsked: string; prepHint: string }>
  resumeRewrite?: Array<{ area: string; suggestion: string }>
}

/** 归一化（与 2B/2D 一致）：去空白与常见标点后做子串匹配。 */
function normalizeForMatch(text: string): string {
  return text.replace(/[\s\u3000,，.。;；:：、·\-—()（）]/g, '')
}

function findViolation(text: string): string | null {
  for (const term of BANNED) {
    if (text.includes(term)) return term
  }
  const pct = text.match(/\d{1,3}\s*%/)
  if (pct) return pct[0]
  if (SALARY_PROMISE.test(text)) return 'salary_promise'
  if (CONTRADICTION_PATTERNS.some((p) => p.test(text))) return '学历自相矛盾'
  return null
}

function isRiskyAdvice(text: string): boolean {
  return FABRICATION_HINT.test(text) || EXAMPLE_NUMBER.test(text)
}

function cleanStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function cleanStrArray(v: unknown, max: number, cap: number): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim().slice(0, max)).slice(0, cap)
}

@Injectable()
export class LlmJobMasterService {
  private readonly logger = new Logger(LlmJobMasterService.name)

  constructor(private readonly config: LlmConfigService) {}

  async analyze(resumeText: string, job: JobMasterJobContext): Promise<JobMasterPayload> {
    const sys =
      '你是求职者本人的岗位决策顾问。基于求职者的简历原文与目标岗位信息，输出一份「岗位决策参考」，' +
      '包含岗位适配度、锚定该岗位的晋升路径模拟、以及职业风险提示。这只是给求职者本人参考的决策依据，' +
      '不是招聘评估，不代表任何录用结果或薪酬承诺。' +
      '\n硬性要求：' +
      '\n1. fit.level 只能是 reference_high / reference_medium / reference_low（参考等级），绝不输出任何百分比、匹配率、录用概率、通过率。' +
      '\n2. fit.matchedSkills 每条的 evidence、careerPath.current 的 evidence 必须是简历原文中真实出现的内容（原文摘录），绝不编造。' +
      '\n3. fit.gapSkills 的 suggestion、careerPath.next.firstStep 只谈准备方向与表达优化，绝不虚构求职者没有的经历或技能，绝不建议删除/替换/包装真实经历。' +
      '\n4. careerPath 为「当前 → 1-3年 → 3-5年」三节点，锚定目标岗位向上模拟；next/target 各给 2-3 项待补技能。' +
      '\n5. risks 每条为「level（low/medium/high 定性三档）+ title（风险类别）+ reason + basis（依据出处，如岗位要求原文或信息缺失说明）」；' +
      '只做可解释判断，绝不输出「自动化替代概率N%」「离职概率」等强预测数字；岗位关键信息缺失时提示到来源平台核实。' +
      '\n6. 不承诺薪资数字、Offer、通过率；不出现「一键投递/立即投递/平台投递」等表述。' +
      '\n7. 不得出现自相矛盾判断（如「大专但符合本科要求」）；学历/年限不符合时直接说明差距。' +
      '\n8. fit.gapSkills 每条可加 learningDirection（学习/补强方向，只谈方向，不点名任何具体机构、课程、品牌）与 firstStep（可执行的第一步，不虚构经历）。' +
      '\n9. fit.keywordCoverage：matched=岗位要求关键词且在简历原文出现的；missing=岗位要求出现但简历没有的；只列词，绝不算任何百分比/匹配率。' +
      '\n10. interviewPrep（0-4 条）：该岗位可能被追问的点，question+whyAsked（为什么问）+prepHint（准备提示）；只做练习准备，不承诺通过、不出现「保过/通过率」。' +
      '\n11. resumeRewrite（0-5 条）：针对该岗位的简历表达改写，area（简历哪块）+suggestion（怎么改）；只谈表达，不诱导删除/替换/包装真实经历。' +
      '\n只输出 JSON（不要 markdown 代码块）：' +
      '{"fit":{"level":"reference_high|reference_medium|reference_low","summary":"2-3 句总评（说明这是参考）",' +
      '"matchedSkills":[{"skill":"匹配技能/经验","evidence":"简历原文摘录(≤60字)"}](1-5 条),' +
      '"gapSkills":[{"skill":"建议补足项","suggestion":"准备方向","learningDirection":"学习/补强方向(不点名机构课程)","firstStep":"第一步行动"}](0-4 条),' +
      '"keywordCoverage":{"matched":["岗位要求且简历原文出现的关键词"],"missing":["岗位要求但简历没有的关键词"]}},' +
      '"careerPath":{"current":{"title":"当前定位","evidence":"简历原文摘录(≤60字)"},' +
      '"next":{"title":"1-3年进阶方向","skillsToBuild":["待补技能"],"firstStep":"第一步行动","rationale":"为什么这样走(基于现状)"},' +
      '"target":{"title":"3-5年目标方向","skillsToBuild":["待补技能"],"rationale":"依据","firstStep":"行动"}},' +
      '"risks":[{"level":"low|medium|high","title":"风险类别","reason":"原因","basis":"依据出处"}](0-4 条),' +
      '"interviewPrep":[{"question":"可能被追问的问题","whyAsked":"为什么问","prepHint":"准备提示"}](0-4 条),' +
      '"resumeRewrite":[{"area":"简历哪块","suggestion":"针对该岗位怎么改"}](0-5 条)}'

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
        this.logger.warn(`jobmaster.invalid attempt=${attempt} ms=${Date.now() - t0}`)
        continue
      }
      // 建议级过滤（不触发重试）：诱导编造 / 无依据示例数字 → 替换安全兜底
      const sanitized = this.sanitizeAdvice(payload)
      // 全局 violation（触发重试）：禁词 / 百分比 / 薪资承诺 / 学历自相矛盾
      const violation = findViolation(JSON.stringify(sanitized))
      if (violation) {
        this.logger.warn(`jobmaster.banned attempt=${attempt}`)
        continue
      }
      this.logger.log(
        `jobmaster.ok ms=${Date.now() - t0} match=${sanitized.fit.matchedSkills.length} risk=${sanitized.risks.length}`,
      )
      return sanitized
    }
    throw new ServiceUnavailableException({
      error: { code: 'AI_JOB_MASTER_FAILED', message: '岗位决策分析生成失败，请稍后重试' },
    })
  }

  /**
   * 建议级安全过滤（不触发重试）：诱导编造 / 无依据示例数字 → 安全兜底。
   * 覆盖 gapSkills 的 suggestion/learningDirection/firstStep、careerPath.next.firstStep、resumeRewrite.suggestion。
   */
  private sanitizeAdvice(p: JobMasterPayload): JobMasterPayload {
    let filtered = 0
    const gapSkills = p.fit.gapSkills.map((g) => {
      let item = g
      if (isRiskyAdvice(item.suggestion)) { filtered += 1; item = { ...item, suggestion: SAFE_FALLBACK } }
      if (item.learningDirection && isRiskyAdvice(item.learningDirection)) { filtered += 1; item = { ...item, learningDirection: SAFE_FALLBACK } }
      if (item.firstStep && isRiskyAdvice(item.firstStep)) { filtered += 1; item = { ...item, firstStep: SAFE_FALLBACK } }
      return item
    })
    const next = isRiskyAdvice(p.careerPath.next.firstStep)
      ? (filtered += 1, { ...p.careerPath.next, firstStep: SAFE_FALLBACK })
      : p.careerPath.next
    const resumeRewrite = p.resumeRewrite?.map((it) =>
      isRiskyAdvice(it.suggestion) ? (filtered += 1, { ...it, suggestion: SAFE_FALLBACK }) : it,
    )
    if (filtered > 0) this.logger.warn(`jobmaster.advice_filtered count=${filtered}`)
    return { ...p, fit: { ...p.fit, gapSkills }, careerPath: { ...p.careerPath, next }, ...(resumeRewrite ? { resumeRewrite } : {}) }
  }

  private validate(p: unknown, resumeText: string): JobMasterPayload | null {
    if (!p || typeof p !== 'object') return null
    const obj = p as Record<string, unknown>
    const fitRaw = obj['fit'] as Record<string, unknown> | undefined
    const pathRaw = obj['careerPath'] as Record<string, unknown> | undefined
    if (!fitRaw || !pathRaw) return null

    // ── 适配度 ──
    const level = fitRaw['level']
    if (typeof level !== 'string' || !FIT_LEVELS.includes(level as never)) return null
    const summary = cleanStr(fitRaw['summary'], 500)
    if (!summary) return null

    const normResume = normalizeForMatch(resumeText)
    const evidenceInResume = (evidence: string): boolean => {
      const needle = normalizeForMatch(evidence)
      return needle.length >= 4 && normResume.includes(needle)
    }

    const matchedSkills = (Array.isArray(fitRaw['matchedSkills']) ? fitRaw['matchedSkills'] : [])
      .map((m) => (m && typeof m === 'object' ? (m as Record<string, unknown>) : {}))
      .map((m) => ({ skill: cleanStr(m['skill'], 200), evidence: cleanStr(m['evidence'], 120) }))
      .filter((m) => m.skill.length > 0 && m.evidence.length > 0 && evidenceInResume(m.evidence))
      .slice(0, 5)
    if (matchedSkills.length === 0) return null // 一条真实匹配点都给不出 → 无效输出

    const gapSkills = (Array.isArray(fitRaw['gapSkills']) ? fitRaw['gapSkills'] : [])
      .map((g) => (g && typeof g === 'object' ? (g as Record<string, unknown>) : {}))
      .map((g) => {
        const item: JobMasterPayload['fit']['gapSkills'][number] = { skill: cleanStr(g['skill'], 200), suggestion: cleanStr(g['suggestion'], 300) }
        const ld = cleanStr(g['learningDirection'], 200); if (ld) item.learningDirection = ld
        const fs = cleanStr(g['firstStep'], 200); if (fs) item.firstStep = fs
        return item
      })
      .filter((g) => g.skill.length > 0 && g.suggestion.length > 0)
      .slice(0, 4)

    // ── 关键词覆盖（M1.5）：matched 必须出自简历原文（防编造）；missing 保留 ──
    const kcRaw = (fitRaw['keywordCoverage'] ?? {}) as Record<string, unknown>
    const kcMatched = cleanStrArray(kcRaw['matched'], 40, 12).filter((w) => evidenceInResume(w))
    const kcMissing = cleanStrArray(kcRaw['missing'], 40, 12).filter((w) => !kcMatched.includes(w))
    const keywordCoverage = (kcMatched.length || kcMissing.length) ? { matched: kcMatched, missing: kcMissing } : undefined

    // ── 晋升路径三节点 ──
    const curRaw = (pathRaw['current'] ?? {}) as Record<string, unknown>
    const nextRaw = (pathRaw['next'] ?? {}) as Record<string, unknown>
    const tgtRaw = (pathRaw['target'] ?? {}) as Record<string, unknown>
    const current = { title: cleanStr(curRaw['title'], 60), evidence: cleanStr(curRaw['evidence'], 120) }
    if (!current.title || !current.evidence || !evidenceInResume(current.evidence)) return null // current 必有真实依据
    const next: JobMasterPayload['careerPath']['next'] = {
      title: cleanStr(nextRaw['title'], 60),
      skillsToBuild: cleanStrArray(nextRaw['skillsToBuild'], 60, 3),
      firstStep: cleanStr(nextRaw['firstStep'], 300),
    }
    const nextRationale = cleanStr(nextRaw['rationale'], 300); if (nextRationale) next.rationale = nextRationale
    const target: JobMasterPayload['careerPath']['target'] = { title: cleanStr(tgtRaw['title'], 60), skillsToBuild: cleanStrArray(tgtRaw['skillsToBuild'], 60, 3) }
    const tgtRationale = cleanStr(tgtRaw['rationale'], 300); if (tgtRationale) target.rationale = tgtRationale
    const tgtFirstStep = cleanStr(tgtRaw['firstStep'], 300); if (tgtFirstStep) target.firstStep = tgtFirstStep
    if (!next.title || !next.firstStep || !target.title) return null

    // ── 风险（0-4 条，空数组合法） ──
    const risks = (Array.isArray(obj['risks']) ? obj['risks'] : [])
      .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : {}))
      .map((r) => ({
        level: r['level'],
        title: cleanStr(r['title'], 60),
        reason: cleanStr(r['reason'], 300),
        basis: cleanStr(r['basis'], 300),
      }))
      .filter(
        (r): r is JobMasterPayload['risks'][number] =>
          typeof r.level === 'string' && RISK_LEVELS.includes(r.level as never) && !!r.title && !!r.reason && !!r.basis,
      )
      .slice(0, 4)

    // ── 面试预判 / 简历改写要点（M1.5，可选，空则不带） ──
    const interviewPrep = (Array.isArray(obj['interviewPrep']) ? obj['interviewPrep'] : [])
      .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
      .map((x) => ({ question: cleanStr(x['question'], 200), whyAsked: cleanStr(x['whyAsked'], 200), prepHint: cleanStr(x['prepHint'], 300) }))
      .filter((x) => x.question.length > 0 && x.prepHint.length > 0)
      .slice(0, 4)
    const resumeRewrite = (Array.isArray(obj['resumeRewrite']) ? obj['resumeRewrite'] : [])
      .map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}))
      .map((x) => ({ area: cleanStr(x['area'], 60), suggestion: cleanStr(x['suggestion'], 300) }))
      .filter((x) => x.area.length > 0 && x.suggestion.length > 0)
      .slice(0, 5)

    const result: JobMasterPayload = { fit: { level: level as JobMasterPayload['fit']['level'], summary, matchedSkills, gapSkills }, careerPath: { current, next, target }, risks }
    if (keywordCoverage) result.fit.keywordCoverage = keywordCoverage
    if (interviewPrep.length) result.interviewPrep = interviewPrep
    if (resumeRewrite.length) result.resumeRewrite = resumeRewrite
    return result
  }

  private parse(raw: string): unknown {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    try {
      return JSON.parse(cleaned)
    } catch {
      const a = cleaned.indexOf('{')
      const b = cleaned.lastIndexOf('}')
      if (a >= 0 && b > a) {
        try { return JSON.parse(cleaned.slice(a, b + 1)) } catch { return null }
      }
      return null
    }
  }

  /** 复用 resume_optimize 功能位（同一条「基于简历的定向输出」链路；密钥仅服务端）。 */
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
      this.logger.error('jobmaster.llm network_error')
      throw new ServiceUnavailableException({ error: { code: 'AI_UNAVAILABLE', message: 'AI 模型连接失败，请稍后重试' } })
    }
    if (!res.ok) {
      this.logger.error(`jobmaster.llm upstream_non_2xx status=${res.status}`)
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
