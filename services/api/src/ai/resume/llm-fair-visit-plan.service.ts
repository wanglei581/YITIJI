import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { LlmConfigService } from '../llm/llm-config.service'

// 招聘会 AI 参会准备单。
// 合规：仅供本人参会准备参考，不包含任何就业结果承诺，不向企业传递候选人信息。

const BLOCKED = [
  '保录用',
  '保面试',
  '通过率',
  '录用概率',
  '录用率',
  'Offer概率',
  '一键投递',
  '立即投递',
  '平台投递',
  '推荐给企业',
] as const

const percentPattern = new RegExp('\\d{1,3}\\s*' + '%')

export interface FairVisitPlanContext {
  resumeText: string
  fair: {
    id: string
    title: string
    sourceName: string
    sourceUrl: string
    startAt: string
    endAt: string
    venue: string
    city: string
  }
  fairCompanies: Array<{
    companyName: string
    industry: string | null
    sourceUrl: string | null
    positions: Array<{ title: string; requirements: string | null; education: string | null; location: string | null }>
  }>
}

export interface FairVisitPlanPayload {
  summary: string
  fairHighlights: string[]
  priorityCompanies: Array<{ companyName: string; reason: string; sourceUrl: string | null }>
  preparationChecklist: string[]
  questionsToAsk: string[]
  onsiteTips: string[]
}

interface RawPriorityCompany {
  companyName?: unknown
  reason?: unknown
}

function findBlocked(text: string): string | null {
  for (const term of BLOCKED) {
    if (text.includes(term)) return term
  }
  return percentPattern.test(text) ? 'percent' : null
}

function cleanList(value: unknown, limit: number, itemLimit: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().slice(0, itemLimit))
    .slice(0, limit)
}

@Injectable()
export class LlmFairVisitPlanService {
  private readonly logger = new Logger(LlmFairVisitPlanService.name)

  constructor(private readonly config: LlmConfigService) {}

  async build(ctx: FairVisitPlanContext): Promise<FairVisitPlanPayload> {
    const system =
      '你是求职者本人的招聘会参会准备顾问。基于本人简历原文与已发布招聘会公开信息，输出一份参会准备单。' +
      '\n硬性要求：' +
      '\n1. 仅供本人参会准备参考，不承诺就业结果，不输出任何分数、比例或排序理由。' +
      '\n2. 只使用输入里的招聘会、企业和岗位信息，不编造企业、岗位、联系人或现场安排。' +
      '\n3. 不输出平台内办理动作；涉及岗位办理时只能提醒前往来源平台。' +
      '\n4. priorityCompanies 只是现场优先查看建议，不能表达企业对求职者有意向。' +
      '\n5. 只输出 JSON，不要 markdown 代码块。' +
      '{"summary":"2-3 句总览，包含仅供本人参会准备参考",' +
      '"fairHighlights":["本场活动真实看点"],' +
      '"priorityCompanies":[{"companyName":"企业名","reason":"为什么适合现场优先了解","sourceUrl":null}],' +
      '"preparationChecklist":["参会前准备动作"],' +
      '"questionsToAsk":["现场可向来源平台或企业展位咨询的问题"],' +
      '"onsiteTips":["现场路线、资料、打印等提醒"]}'

    const user = [
      `【简历原文】\n${ctx.resumeText.slice(0, 8000)}`,
      `【招聘会】\n${JSON.stringify(ctx.fair)}`,
      `【fairCompanies】\n${JSON.stringify(ctx.fairCompanies.slice(0, 40)).slice(0, 9000)}`,
    ].join('\n\n')

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const t0 = Date.now()
      const raw = await this.callLlm(system, user)
      const parsed = this.parse(raw)
      const payload = this.validate(parsed, ctx)
      if (!payload) {
        this.logger.warn(`fairvisit.invalid attempt=${attempt} ms=${Date.now() - t0}`)
        continue
      }
      const blocked = findBlocked(JSON.stringify(payload))
      if (blocked) {
        this.logger.warn(`fairvisit.blocked attempt=${attempt} reason=${blocked}`)
        continue
      }
      this.logger.log(`fairvisit.ok ms=${Date.now() - t0} companies=${payload.priorityCompanies.length}`)
      return payload
    }
    throw new ServiceUnavailableException({
      error: { code: 'AI_FAIR_VISIT_PLAN_FAILED', message: '参会准备单生成失败，请稍后重试' },
    })
  }

  private validate(raw: Partial<FairVisitPlanPayload> | null, ctx: FairVisitPlanContext): FairVisitPlanPayload | null {
    if (!raw || typeof raw.summary !== 'string' || !raw.summary.trim()) return null
    const allowedCompanies = new Set(ctx.fairCompanies.map((c) => c.companyName))
    const rawPriorityCompanies = Array.isArray(raw.priorityCompanies) ? raw.priorityCompanies as RawPriorityCompany[] : []
    const priorityCompanies = rawPriorityCompanies
          .filter((item): item is { companyName: string; reason: string } =>
            !!item &&
            typeof item.companyName === 'string' &&
            allowedCompanies.has(item.companyName) &&
            typeof item.reason === 'string' &&
            item.reason.trim().length > 0)
          .map((item) => {
            const company = ctx.fairCompanies.find((c) => c.companyName === item.companyName)
            return {
              companyName: item.companyName,
              reason: item.reason.trim().slice(0, 240),
              sourceUrl: company?.sourceUrl ?? null,
            }
          })
          .slice(0, 6)
    return {
      summary: raw.summary.trim().slice(0, 500),
      fairHighlights: cleanList(raw.fairHighlights, 5, 180),
      priorityCompanies,
      preparationChecklist: cleanList(raw.preparationChecklist, 8, 180),
      questionsToAsk: cleanList(raw.questionsToAsk, 8, 180),
      onsiteTips: cleanList(raw.onsiteTips, 6, 180),
    }
  }

  private parse(raw: string): Partial<FairVisitPlanPayload> | null {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    try {
      return JSON.parse(cleaned) as Partial<FairVisitPlanPayload>
    } catch {
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      if (start >= 0 && end > start) {
        try { return JSON.parse(cleaned.slice(start, end + 1)) as Partial<FairVisitPlanPayload> } catch { return null }
      }
      return null
    }
  }

  private async callLlm(system: string, user: string): Promise<string> {
    const apiKey = this.config.getApiKey('resume_optimize')
    const cfg = this.config.getConfig('resume_optimize')
    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException({ error: { code: 'AI_NOT_CONFIGURED', message: 'AI 服务暂未启用，请联系管理员配置' } })
    }
    let res: Response
    try {
      res = await fetch(`${cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
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
      this.logger.error('fairvisit.llm network_error')
      throw new ServiceUnavailableException({ error: { code: 'AI_UNAVAILABLE', message: 'AI 模型连接失败，请稍后重试' } })
    }
    if (!res.ok) {
      this.logger.error(`fairvisit.llm upstream_non_2xx status=${res.status}`)
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
