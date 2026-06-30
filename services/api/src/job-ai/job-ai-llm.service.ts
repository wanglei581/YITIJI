import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { LlmConfigService } from '../ai/llm/llm-config.service'
import type {
  JobAiExplanationPayload,
  JobAiRecommendationPayload,
  TargetJobContext,
} from './job-ai.types'

const UNSAFE_TERMS = [
  '录用概率',
  '录用率',
  '通过率',
  '保过',
  '保录用',
  '保面试',
  '匹配率',
  'AI匹配率',
  '一键投递',
  '立即投递',
  '平台投递',
  '候选人筛选',
  '面试邀约',
  'Offer',
] as const

const LLM_TIMEOUT_MS = (() => {
  const raw = Number(process.env['AI_JOB_LLM_TIMEOUT_MS'])
  return Number.isFinite(raw) && raw >= 5_000 ? Math.min(raw, 60_000) : 45_000
})()

@Injectable()
export class JobAiLlmService {
  private readonly logger = new Logger(JobAiLlmService.name)

  constructor(private readonly config: LlmConfigService) {}

  async recommend(resumePlainText: string, jobs: TargetJobContext[]): Promise<JobAiRecommendationPayload[]> {
    const system =
      '你是求职者本人的岗位筛选助手。只基于简历原文和真实已发布岗位信息，输出岗位推荐参考。' +
      '输出仅供求职者本人参考，不代表录用结果，不做企业候选人筛选。' +
      '禁止出现百分比、匹配率、录用概率、通过率、保面试、保录用、一键投递、立即投递、平台投递等表述。' +
      '只能输出 JSON 数组，不要 markdown 代码块。数组元素格式：' +
      '{"jobId":"岗位ID","fitLevel":"reference_high|reference_medium|reference_low","summary":"1-2句参考说明",' +
      '"matchPoints":["匹配点"],"gapPoints":["差距"],"actionChecklist":["准备动作"]}'
    const jobLines = jobs.map((job, index) => [
      `#${index + 1} jobId=${job.jobId}`,
      `岗位=${job.title}`,
      `公司=${job.company}`,
      `城市=${job.city}`,
      `类别=${job.category ?? '来源平台未提供'}`,
      `技能=${job.skills.join('、') || '来源平台未提供'}`,
      `描述=${(job.description ?? '').slice(0, 600)}`,
      `要求=${(job.requirements ?? '').slice(0, 600)}`,
    ].join('\n')).join('\n\n')
    const user = `【简历原文】\n${resumePlainText.slice(0, 6000)}\n\n【候选岗位】\n${jobLines}`
    const raw = await this.callLlm(system, user, 'jobRecommend')
    const parsed = parseJson(raw)
    if (!Array.isArray(parsed)) throw unavailable('AI_JOB_RECOMMEND_FAILED', '岗位推荐生成失败，请稍后重试')
    const allowed = new Set(jobs.map((job) => job.jobId))
    const payload = parsed
      .map((item) => this.sanitizeRecommendation(item, allowed))
      .filter((item): item is JobAiRecommendationPayload => item !== null)
      .slice(0, jobs.length)
    if (payload.length === 0) throw unavailable('AI_JOB_RECOMMEND_FAILED', '岗位推荐生成失败，请稍后重试')
    return payload
  }

  async explain(job: TargetJobContext): Promise<JobAiExplanationPayload> {
    const system =
      '你是求职者本人的岗位解读助手。只解读真实岗位信息，帮助求职者理解职责、硬性要求、加分项和准备事项。' +
      '输出仅供参考；禁止出现百分比、录用概率、通过率、保面试、保录用、一键投递、立即投递、平台投递。' +
      '只输出 JSON，不要 markdown 代码块，格式：' +
      '{"responsibilities":["职责"],"mustHaveRequirements":["硬性要求"],"niceToHaveRequirements":["加分项"],"preparationTips":["准备建议"]}'
    const user = [
      `岗位=${job.title}`,
      `公司=${job.company}`,
      `城市=${job.city}`,
      `来源=${job.sourceName}`,
      `描述=${(job.description ?? '').slice(0, 1200)}`,
      `要求=${(job.requirements ?? '').slice(0, 1200)}`,
      `技能=${job.skills.join('、') || '来源平台未提供'}`,
    ].join('\n')
    const raw = await this.callLlm(system, user, 'jobExplain')
    const parsed = parseJson(raw)
    const payload = this.sanitizeExplanation(parsed)
    if (!payload) throw unavailable('AI_JOB_EXPLAIN_FAILED', '岗位解读生成失败，请稍后重试')
    return payload
  }

  sanitize(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, 300)
  }

  findUnsafeOutputReason(text: string): string | null {
    const normalized = text.toLowerCase()
    for (const term of UNSAFE_TERMS) {
      if (normalized.includes(term.toLowerCase())) return term
    }
    const pct = text.match(/\d+(?:\.\d+)?\s*%/)
    return pct ? pct[0] : null
  }

  private sanitizeRecommendation(item: unknown, allowedJobIds: Set<string>): JobAiRecommendationPayload | null {
    if (!item || typeof item !== 'object') return null
    const input = item as Record<string, unknown>
    const jobId = typeof input['jobId'] === 'string' ? input['jobId'] : ''
    const fitLevel = typeof input['fitLevel'] === 'string' ? input['fitLevel'] : ''
    if (!allowedJobIds.has(jobId)) return null
    if (!['reference_high', 'reference_medium', 'reference_low'].includes(fitLevel)) return null
    const candidate: JobAiRecommendationPayload = {
      jobId,
      fitLevel: fitLevel as JobAiRecommendationPayload['fitLevel'],
      summary: this.sanitize(String(input['summary'] ?? '仅供参考，请结合岗位来源信息自行判断。')),
      matchPoints: toSafeList(input['matchPoints'], this),
      gapPoints: toSafeList(input['gapPoints'], this),
      actionChecklist: toSafeList(input['actionChecklist'], this),
    }
    return this.findUnsafeOutputReason(JSON.stringify(candidate)) ? null : candidate
  }

  private sanitizeExplanation(input: unknown): JobAiExplanationPayload | null {
    if (!input || typeof input !== 'object') return null
    const source = input as Record<string, unknown>
    const candidate: JobAiExplanationPayload = {
      responsibilities: toSafeList(source['responsibilities'], this),
      mustHaveRequirements: toSafeList(source['mustHaveRequirements'], this),
      niceToHaveRequirements: toSafeList(source['niceToHaveRequirements'], this),
      preparationTips: toSafeList(source['preparationTips'], this),
    }
    if (candidate.responsibilities.length === 0 && candidate.mustHaveRequirements.length === 0) return null
    return this.findUnsafeOutputReason(JSON.stringify(candidate)) ? null : candidate
  }

  private async callLlm(system: string, user: string, operation: 'jobRecommend' | 'jobExplain'): Promise<string> {
    const apiKey = this.config.getApiKey('resume_optimize')
    const cfg = this.config.getConfig('resume_optimize')
    if (!apiKey || !cfg.enabled) {
      throw unavailable('AI_NOT_CONFIGURED', 'AI 服务暂未启用，请联系管理员配置')
    }
    const startedAt = Date.now()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
    try {
      const res = await fetch(`${cfg.baseURL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: Math.min(0.4, cfg.temperature),
          stream: false,
        }),
      })
      if (!res.ok) {
        this.logger.warn(`${operation}.upstream_non_2xx status=${res.status}`)
        throw unavailable('AI_UNAVAILABLE', `AI 模型返回错误 (${res.status})`)
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      const reply = data.choices?.[0]?.message?.content?.trim()
      if (!reply) throw unavailable('AI_UNAVAILABLE', 'AI 模型未返回内容')
      return reply
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.warn(`${operation}.timeout ms=${Date.now() - startedAt}`)
        throw unavailable('AI_TIMEOUT', 'AI 模型响应超时，请稍后重试')
      }
      this.logger.warn(`${operation}.network_error ms=${Date.now() - startedAt}`)
      throw unavailable('AI_UNAVAILABLE', 'AI 模型连接失败，请稍后重试')
    } finally {
      clearTimeout(timeout)
    }
  }
}

function unavailable(code: string, message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({ error: { code, message } })
}

function parseJson(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const arrayStart = cleaned.indexOf('[')
    const first = arrayStart >= 0 && (start < 0 || arrayStart < start) ? arrayStart : start
    const end = first === arrayStart ? cleaned.lastIndexOf(']') : cleaned.lastIndexOf('}')
    if (first >= 0 && end > first) {
      try {
        return JSON.parse(cleaned.slice(first, end + 1))
      } catch {
        throw unavailable('AI_OUTPUT_INVALID', 'AI 模型输出格式异常，请稍后重试')
      }
    }
    throw unavailable('AI_OUTPUT_INVALID', 'AI 模型输出格式异常，请稍后重试')
  }
}

function toSafeList(value: unknown, service: JobAiLlmService): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => service.sanitize(item))
    .filter((item) => item.length > 0 && !service.findUnsafeOutputReason(item))
    .slice(0, 5)
}
