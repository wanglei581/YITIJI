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
import { maskUserTextForLlmText } from '../../common/pii/llm-input-mask'

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
  /**
   * 由服务端按招聘会 endAt 判定，不接受调用方随意指定。
   *
   * ⚠️ 合规红线：**绝不允许把任何「用户是否到场」的信号并进本 context**。
   * 系统只记录「浏览」和「打开来源平台入口」两类行为（activity.types.ts），
   * 打开签到入口 ≠ 到场；把这类信号喂给模型会诱导它写出
   * 「你在现场应该已经……」这类系统根本无从知道的句子。
   */
  mode: FairVisitPlanMode
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
  /**
   * A-6 成本可见性：每次真实 LLM 调用（含失败重试）回调一次元数据，
   * 由调用方累计后落 AiServiceLog。只传 provider/token 元数据，不含任何正文。
   */
  onLlmCall?: AiLlmCallSink
}

/**
 * 参会准备（未结束） / 参会回顾（已结束）。
 *
 * 分两态不是文案差异：已结束场次下「参会前准备清单 / 现场可咨询问题 / 现场提醒」
 * 这三段是**语义坏了**——改字解决不了「现场提醒」在活动结束后的存在问题。
 */
export type FairVisitPlanMode = 'preparation' | 'review'

export interface FairVisitPlanPayloadBase {
  summary: string
  fairHighlights: string[]
  priorityCompanies: Array<{ companyName: string; reason: string; sourceUrl: string | null }>
}

export interface FairVisitPreparationPayload extends FairVisitPlanPayloadBase {
  mode: 'preparation'
  preparationChecklist: string[]
  questionsToAsk: string[]
  onsiteTips: string[]
}

export interface FairVisitReviewPayload extends FairVisitPlanPayloadBase {
  mode: 'review'
  /** 现在就能做的跟进动作（企业在招聘会结束后通常仍在招人）。 */
  followUpActions: string[]
  /** 下次参加同类活动可以提前准备的问题（不是现场提问）。 */
  nextTimeQuestions: string[]
}

export type FairVisitPlanPayload = FairVisitPreparationPayload | FairVisitReviewPayload

/** 模型原始输出：两态字段都可能出现，validate 按 mode 只取该态的键。 */
type RawPlanFields = Partial<
  FairVisitPlanPayloadBase & {
    preparationChecklist: unknown
    questionsToAsk: unknown
    onsiteTips: unknown
    followUpActions: unknown
    nextTimeQuestions: unknown
  }
>

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

/**
 * 真正送给模型的 system prompt。抽成纯函数是为了让门禁能直接断言这段文本
 * ——尤其是「回顾态不得暗示到场」这条，只有对着真实 prompt 断言才算数。
 */
export function buildSystemPrompt(mode: FairVisitPlanMode): string {
  const common =
    '\n- 仅供求职者本人参考，不承诺就业结果，不输出任何分数、比例或排序理由。' +
    '\n- 只使用输入里的招聘会、企业和岗位信息，不编造企业、岗位、联系人或安排。' +
    '\n- 不输出平台内办理动作；涉及岗位办理时只能提醒前往来源平台。' +
    '\n- priorityCompanies 不能表达企业对求职者有意向。' +
    '\n- 只输出 JSON，不要 markdown 代码块。'

  if (mode === 'review') {
    return (
      '你是求职者本人的求职跟进顾问。**这场招聘会已经结束。**' +
      '基于本人简历原文与该场招聘会的公开企业/岗位信息，输出一份「参会回顾与后续跟进」。' +
      '\n硬性要求：' +
      '\n- 活动已经结束：不得输出任何「出发前」「现场」「参会当天」的动作或提醒。' +
      '\n- **你不知道用户是否到过现场、是否与任何企业接触过、是否取得任何材料。' +
      '一律不得假设、不得暗示，禁止使用「你在现场应该已经…」「你拿到的资料…」这类句式。**' +
      '\n- 参展企业在活动结束后通常仍在招聘：priorityCompanies 输出「仍值得继续跟进的企业」，' +
      '理由只能基于简历方向与该企业公开岗位信息的匹配点。' +
      common +
      '{"summary":"2-3 句回顾总览，说明这场活动已结束、以下为后续跟进参考",' +
      '"fairHighlights":["这场活动的真实概况（过去式）"],' +
      '"priorityCompanies":[{"companyName":"企业名","reason":"为什么仍值得继续跟进","sourceUrl":null}],' +
      '"followUpActions":["现在就能做的跟进动作，如去来源平台查看该企业在招岗位、按方向补充简历材料"],' +
      '"nextTimeQuestions":["下次参加同类活动可以提前准备的问题"]}'
    )
  }

  return (
    '你是求职者本人的招聘会参会准备顾问。基于本人简历原文与已发布招聘会公开信息，输出一份参会准备单。' +
    '\n硬性要求：' +
    '\n- 仅供本人参会准备参考。' +
    common +
    '{"summary":"2-3 句总览，包含仅供本人参会准备参考",' +
    '"fairHighlights":["本场活动真实看点"],' +
    '"priorityCompanies":[{"companyName":"企业名","reason":"为什么适合现场优先了解","sourceUrl":null}],' +
    '"preparationChecklist":["参会前准备动作"],' +
    '"questionsToAsk":["现场可向来源平台或企业展位咨询的问题"],' +
    '"onsiteTips":["现场路线、资料、打印等提醒"]}'
  )
}

@Injectable()
export class LlmFairVisitPlanService {
  private readonly logger = new Logger(LlmFairVisitPlanService.name)

  constructor(private readonly config: LlmConfigService) {}

  async build(ctx: FairVisitPlanContext): Promise<FairVisitPlanPayload> {
    const system = buildSystemPrompt(ctx.mode)

    // S0-2 / 风险 R2：简历先截断再遮盖高置信 PII 才送模型。
    // 参会准备单不依赖姓名 / 手机 / 身份证 / 邮箱 / 住址，遮盖不影响结论质量。
    const user = [
      `【简历原文】\n${maskUserTextForLlmText(ctx.resumeText.slice(0, 8000), 'fair_visit_plan')}`,
      `【招聘会】\n${JSON.stringify(ctx.fair)}`,
      `【fairCompanies】\n${JSON.stringify(ctx.fairCompanies.slice(0, 40)).slice(0, 9000)}`,
    ].join('\n\n')

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const t0 = Date.now()
      const raw = await this.callLlm(system, user, ctx.onLlmCall)
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

  private validate(raw: RawPlanFields | null, ctx: FairVisitPlanContext): FairVisitPlanPayload | null {
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
    const base = {
      summary: raw.summary.trim().slice(0, 500),
      fairHighlights: cleanList(raw.fairHighlights, 5, 180),
      priorityCompanies,
    }
    // 按 mode 只取该形态的键。模型即使多吐了另一态的字段也一律丢弃 ——
    // 否则「已结束场次带出现场提醒」会从模型侧漏回来。
    if (ctx.mode === 'review') {
      const rawReview = raw as Partial<FairVisitReviewPayload>
      return {
        ...base,
        mode: 'review',
        followUpActions: cleanList(rawReview.followUpActions, 8, 180),
        nextTimeQuestions: cleanList(rawReview.nextTimeQuestions, 8, 180),
      }
    }
    const rawPrep = raw as Partial<FairVisitPreparationPayload>
    return {
      ...base,
      mode: 'preparation',
      preparationChecklist: cleanList(rawPrep.preparationChecklist, 8, 180),
      questionsToAsk: cleanList(rawPrep.questionsToAsk, 8, 180),
      onsiteTips: cleanList(rawPrep.onsiteTips, 6, 180),
    }
  }

  private parse(raw: string): RawPlanFields | null {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    try {
      return JSON.parse(cleaned) as RawPlanFields
    } catch {
      const start = cleaned.indexOf('{')
      const end = cleaned.lastIndexOf('}')
      if (start >= 0 && end > start) {
        try { return JSON.parse(cleaned.slice(start, end + 1)) as RawPlanFields } catch { return null }
      }
      return null
    }
  }

  // S0-3：独立 feature key 'fair_visit_plan'（未单独配置时继承 resume_optimize，行为不变）。
  // A-6 成本可见性：每次 callLlm 执行完毕（无论成功或失败前）都回调 onLlmCall。
  private async callLlm(system: string, user: string, onLlmCall?: AiLlmCallSink): Promise<string> {
    const apiKey = this.config.getApiKey('fair_visit_plan')
    const cfg = this.config.getConfig('fair_visit_plan')
    if (!apiKey || !cfg.enabled) {
      throw new ServiceUnavailableException({ error: { code: 'AI_NOT_CONFIGURED', message: 'AI 服务暂未启用，请联系管理员配置' } })
    }
    const providerLabel = `llm:${cfg.vendor}:${cfg.model}`
    let res: Awaited<ReturnType<typeof llmFetchJson>>
    try {
      res = await llmFetchJson(
        `${cfg.baseURL.replace(/\/$/, '')}/chat/completions`,
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
        this.logger.warn(`fairvisit.llm busy limit=${error.limit}`)
        throw new ServiceUnavailableException({ error: { code: 'AI_BUSY', message: LLM_BUSY_MESSAGE } })
      }
      if (error instanceof LlmTimeoutError) {
        // 超时：请求已发出、上游可能已计费 → 与既有 network_error 分支一样要落账。
        this.logger.warn(`fairvisit.llm timeout ms=${error.timeoutMs}`)
        onLlmCall?.({ provider: providerLabel })
        throw new ServiceUnavailableException({
          error: { code: 'AI_FAIR_VISIT_PLAN_TIMEOUT', message: llmTimeoutMessage('AI 参会准备单', error.timeoutMs) },
        })
      }
      this.logger.error('fairvisit.llm network_error')
      onLlmCall?.({ provider: providerLabel })
      throw llmUnreachableError('AI 参会准备单服务')
    }
    if (!res.ok) {
      this.logger.error(`fairvisit.llm upstream_non_2xx status=${res.status}`)
      onLlmCall?.({ provider: providerLabel })
      throw llmUpstreamStatusError('AI 参会准备单服务', res.status)
    }
    const data = res.data as { choices?: Array<{ message?: { content?: string } }>; usage?: RawLlmUsage } | null
    onLlmCall?.({ provider: providerLabel, tokenUsage: normalizeLlmUsage(data?.usage) })
    const reply = data?.choices?.[0]?.message?.content?.trim()
    if (!reply) {
      throw llmEmptyResponseError('AI 参会准备单服务')
    }
    return reply
  }
}
