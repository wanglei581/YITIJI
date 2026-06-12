import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { LlmConfigService } from '../llm/llm-config.service'

// ============================================================
// 2E 职业规划建议（真实化既有「职业规划」入口）。
//
// 合规（硬约束，双层防线）：
// - 仅供本人参考：不承诺薪资、录用、Offer、通过率；不判断人格/心理/敏感属性；
//   不向企业推荐候选人。
// - 防编造（对齐 2B/2D 契约）：currentSnapshot 现状画像每条 evidence 必须出自
//   简历原文（归一化子串）；方向/技能建议只谈发展路径与可执行行动，不虚构经历。
// - 输出扫描：禁词 / 数字百分比 / 薪资数字承诺 / 诱导编造 / 无依据示例数字 →
//   建议级过滤或整体重试 → 连续命中诚实失败。
// - 简历原文/上下文/输出不写日志（仅元数据）。
// ============================================================

const BANNED = [
  '保过', '通过率', '录用概率', '录用率', 'Offer 概率', 'Offer概率', '保录用', '保面试',
  '保证拿', '精准命中', '内部题库', '一键投递', '立即投递', '平台投递', '推荐给企业',
] as const

/** 薪资数字承诺（如「月薪可达 15k」「年薪 30 万没问题」）：规划只谈方向，不承诺收入。 */
const SALARY_PROMISE = /(月薪|年薪|薪资|工资)[^。；;]{0,12}(可达|能到|达到|不低于|保底)[^。；;]{0,8}\d/

/** 诱导编造（沿用 2D 口径）。 */
const FABRICATION_HINT =
  /(替换为|改写为|包装成|伪装成)[^。；;]{0,30}(项目|经历|公司|学历|证书|技能)|删除[^。；;]{0,20}(行政|工作|经历|描述|学历)/

/** 无依据示例数字（沿用 2D 口径）。 */
const EXAMPLE_NUMBER = /(?:如|例如|比如)[^。；;，,]{0,40}\d/

const SAFE_FALLBACK_ACTION =
  '只基于本人真实经历与确有的学习计划制定行动；如确有相关学习、项目、证书或成果，请写清事实背景与实际结果，不要虚构经历或数字。'

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
  return null
}

function isRiskyAdvice(text: string): boolean {
  return FABRICATION_HINT.test(text) || EXAMPLE_NUMBER.test(text)
}

export interface CareerPlanContext {
  /** 简历原文（必有） */
  resumeText: string
  /** 最近一次岗位匹配参考（可选；有则规划更聚焦目标岗位） */
  jobFit?: { jobTitle: string; fitLevel: string; gaps: string[] } | null
  /** 最近一次模拟面试表现（可选，仅会员可聚合；只用元数据级摘要） */
  interview?: { position: string; level: string; risks: string[] } | null
}

export interface CareerPlanPayload {
  /** 现状画像：每条 evidence 出自简历原文（服务端校验） */
  currentSnapshot: Array<{ point: string; evidence: string }>
  /** 发展方向建议（1-3 个，参考性质） */
  directions: Array<{ title: string; why: string; firstStep: string }>
  /** 技能提升计划（行动 + 阶段，如「1-3 个月」） */
  skillPlan: Array<{ skill: string; action: string; timeframe: string }>
  /** 近期行动清单（可勾选执行） */
  actionChecklist: string[]
  summary: string
}

@Injectable()
export class LlmCareerPlanService {
  private readonly logger = new Logger(LlmCareerPlanService.name)

  constructor(private readonly config: LlmConfigService) {}

  async build(ctx: CareerPlanContext): Promise<CareerPlanPayload> {
    const sys =
      '你是求职者本人的职业发展顾问。基于简历原文（以及可选的岗位匹配参考、模拟面试表现摘要），' +
      '输出一份「职业规划建议」。这只是给本人参考的发展建议，不是任何就业承诺。' +
      '\n硬性要求：' +
      '\n1. currentSnapshot 现状画像每条的 evidence 必须是简历原文真实出现的内容（原文摘录），绝不编造。' +
      '\n2. 不承诺薪资数字、录用、Offer、通过率；不输出任何百分比；不判断人格、心理或其他敏感属性。' +
      '\n3. 不得建议删除、替换、包装真实经历伪装目标岗位；行动建议只能基于真实学习与积累路径。' +
      '\n4. 不给无依据的示例数字（如"每月完成100份"），只能说"补充你实际的数量与结果"。' +
      '\n5. 方向建议要立足简历现状的合理延伸（含当前赛道深耕与相邻转型），写明第一步行动。' +
      '\n只输出 JSON（不要 markdown 代码块）：' +
      '{"summary":"2-3 句总览（说明仅供参考）",' +
      '"currentSnapshot":[{"point":"现状要点","evidence":"简历原文摘录(≤60字)"}](2-4 条),' +
      '"directions":[{"title":"方向名","why":"为什么适合（基于现状）","firstStep":"第一步行动"}](1-3 个),' +
      '"skillPlan":[{"skill":"要提升的能力","action":"具体行动","timeframe":"阶段，如 1-3 个月"}](2-4 条),' +
      '"actionChecklist":["近期可执行行动"](3-6 条)}'

    const parts: string[] = [`【简历原文】\n${ctx.resumeText.slice(0, 8000)}`]
    if (ctx.jobFit) {
      parts.push(
        `【最近岗位匹配参考】目标岗位「${ctx.jobFit.jobTitle}」，参考等级 ${ctx.jobFit.fitLevel}；` +
        `主要差距：${ctx.jobFit.gaps.slice(0, 3).join('；').slice(0, 400)}`,
      )
    }
    if (ctx.interview) {
      parts.push(
        `【最近模拟面试表现摘要】岗位「${ctx.interview.position}」，练习等级 ${ctx.interview.level}；` +
        `主要改进点：${ctx.interview.risks.slice(0, 3).join('；').slice(0, 400)}`,
      )
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const t0 = Date.now()
      const raw = await this.callLlm(sys, parts.join('\n\n'))
      const parsed = this.parse(raw)
      const payload = this.validate(parsed, ctx.resumeText)
      if (!payload) {
        this.logger.warn(`careerplan.invalid attempt=${attempt} ms=${Date.now() - t0}`)
        continue
      }
      const sanitized = this.sanitizeAdvice(payload)
      const violation = findViolation(JSON.stringify(sanitized))
      if (violation) {
        this.logger.warn(`careerplan.banned attempt=${attempt}`)
        continue
      }
      this.logger.log(`careerplan.ok ms=${Date.now() - t0} dirs=${sanitized.directions.length}`)
      return sanitized
    }
    throw new ServiceUnavailableException({
      error: { code: 'AI_CAREER_PLAN_FAILED', message: '职业规划生成失败，请稍后重试' },
    })
  }

  /** 建议级安全过滤（沿用 2D 口径）：高风险行动建议过滤/替换为安全兜底，不直接发给用户。 */
  private sanitizeAdvice(p: CareerPlanPayload): CareerPlanPayload {
    let filtered = 0
    const actionChecklist = p.actionChecklist.filter((a) => {
      if (isRiskyAdvice(a)) { filtered += 1; return false }
      return true
    })
    if (actionChecklist.length === 0) actionChecklist.push(SAFE_FALLBACK_ACTION)
    const skillPlan = p.skillPlan.map((sp) =>
      isRiskyAdvice(sp.action) ? (filtered += 1, { ...sp, action: SAFE_FALLBACK_ACTION }) : sp,
    )
    const directions = p.directions.map((d) =>
      isRiskyAdvice(d.firstStep) ? (filtered += 1, { ...d, firstStep: SAFE_FALLBACK_ACTION }) : d,
    )
    if (filtered > 0) this.logger.warn(`careerplan.advice_filtered count=${filtered}`)
    return { ...p, actionChecklist, skillPlan, directions }
  }

  private validate(p: Partial<CareerPlanPayload> | null, resumeText: string): CareerPlanPayload | null {
    if (!p || typeof p.summary !== 'string' || !p.summary.trim()) return null
    if (!Array.isArray(p.currentSnapshot) || !Array.isArray(p.directions) || !Array.isArray(p.skillPlan) || !Array.isArray(p.actionChecklist)) return null

    const normResume = normalizeForMatch(resumeText)
    const currentSnapshot = p.currentSnapshot
      .filter((m): m is { point: string; evidence: string } =>
        !!m && typeof m.point === 'string' && typeof m.evidence === 'string' && m.point.trim().length > 0 && m.evidence.trim().length > 0)
      .map((m) => ({ point: m.point.trim().slice(0, 200), evidence: m.evidence.trim().slice(0, 120) }))
      .filter((m) => {
        const needle = normalizeForMatch(m.evidence)
        return needle.length >= 4 && normResume.includes(needle)
      })
      .slice(0, 4)
    if (currentSnapshot.length === 0) return null // 一条真实现状都给不出 → 无效输出

    const directions = p.directions
      .filter((d): d is { title: string; why: string; firstStep: string } =>
        !!d && typeof d.title === 'string' && typeof d.why === 'string' && typeof d.firstStep === 'string' && d.title.trim().length > 0)
      .map((d) => ({ title: d.title.trim().slice(0, 60), why: d.why.trim().slice(0, 300), firstStep: d.firstStep.trim().slice(0, 300) }))
      .slice(0, 3)
    if (directions.length === 0) return null

    const skillPlan = p.skillPlan
      .filter((s): s is { skill: string; action: string; timeframe: string } =>
        !!s && typeof s.skill === 'string' && typeof s.action === 'string' && typeof s.timeframe === 'string' && s.skill.trim().length > 0)
      .map((s) => ({ skill: s.skill.trim().slice(0, 60), action: s.action.trim().slice(0, 300), timeframe: s.timeframe.trim().slice(0, 30) }))
      .slice(0, 4)

    const actionChecklist = p.actionChecklist
      .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
      .map((a) => a.trim().slice(0, 200))
      .slice(0, 6)
    if (actionChecklist.length === 0) return null

    return { summary: p.summary.trim().slice(0, 500), currentSnapshot, directions, skillPlan, actionChecklist }
  }

  private parse(raw: string): Partial<CareerPlanPayload> | null {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    try {
      return JSON.parse(cleaned) as Partial<CareerPlanPayload>
    } catch {
      const a = cleaned.indexOf('{')
      const b = cleaned.lastIndexOf('}')
      if (a >= 0 && b > a) {
        try { return JSON.parse(cleaned.slice(a, b + 1)) as Partial<CareerPlanPayload> } catch { return null }
      }
      return null
    }
  }

  /** 复用 resume_optimize 功能位（同"基于简历的定向输出"链路；密钥仅服务端）。 */
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
      this.logger.error('careerplan.llm network_error')
      throw new ServiceUnavailableException({ error: { code: 'AI_UNAVAILABLE', message: 'AI 模型连接失败，请稍后重试' } })
    }
    if (!res.ok) {
      this.logger.error(`careerplan.llm upstream_non_2xx status=${res.status}`)
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
