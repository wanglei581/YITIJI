import { ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { AiLogService } from '../ai/ai-log.service'
import { ResumeExtractionService } from '../ai/resume/resume-extraction.service'
import { JobFitService } from '../ai/resume/job-fit.service'
import { MemberPrivacyService } from '../member-privacy/member-privacy.service'
import type { MemberPageQuery } from '../common/utils/member-page'
import { buildMemberPage, memberPageArgs } from '../common/utils/member-page'
import { JobAiLlmService } from './job-ai-llm.service'
import { JobContextService } from './job-context.service'
import { JobAiQuotaService } from './job-ai-quota.service'
import type { JobAiQuotaContext, JobAiQuotaTicket } from './job-ai-quota.service'
import type {
  JobAiOperation,
  JobAiRequester,
  JobAiSessionDTO,
  JobAiSessionListItem,
  JobRecommendationInput,
  JobAiRecommendationDTO,
  TargetJobContext,
} from './job-ai.types'

const RESULT_TTL_HOURS = (() => {
  const raw = Number(process.env['AI_RESUME_RESULT_TTL_HOURS'])
  return Number.isFinite(raw) && raw > 0 ? raw : 24
})()
const PUBLISHED_JOB_WHERE = { reviewStatus: 'approved', publishStatus: 'published' } as const

type CandidateJob = TargetJobContext & { score: number }

@Injectable()
export class JobAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: JobAiLlmService,
    private readonly context: JobContextService,
    private readonly extraction: ResumeExtractionService,
    private readonly jobFit: JobFitService,
    private readonly aiLog: AiLogService,
    private readonly privacy: MemberPrivacyService,
    private readonly quota: JobAiQuotaService,
  ) {}

  async recommendations(input: JobRecommendationInput, requester: JobAiRequester, quotaContext?: JobAiQuotaContext) {
    const startedAt = Date.now()
    const parse = await this.loadAuthorizedParse(input.resumeTaskId, requester)
    await this.assertResumeAiConsent(parse.endUserId)
    const session = await this.createSession({
      operation: 'recommend',
      resumeTaskId: input.resumeTaskId,
      endUserId: parse.endUserId,
      accessTokenHash: parse.accessTokenHash,
      intent: { intent: input.intent ?? {}, filters: input.filters ?? {}, limit: input.limit ?? null },
      terminalId: input.terminalId ?? null,
      expiresAt: parse.expiresAt,
    })
    let quotaTicket: JobAiQuotaTicket | null = null

    try {
      const resumeText = await this.loadResumeText(parse.fileId, parse.endUserId)
      const candidates = await this.findCandidateJobs(input)
      if (candidates.length === 0) {
        await this.prisma.jobAiSession.update({ where: { id: session.id }, data: { status: 'completed', provider: 'llm' } })
        this.recordAiServiceLog(session.id, 'jobRecommend', 'success', startedAt, parse.endUserId, input.terminalId ?? null)
        return { session: this.sessionDto({ ...session, status: 'completed', provider: 'llm' }), recommendations: [], disclaimer: '仅供参考' as const }
      }

      quotaTicket = await this.consumeJobAiQuota('recommend', parse.endUserId, input.terminalId ?? null, quotaContext)
      const payload = await this.llm.recommend(resumeText, candidates)
      const byJob = new Map(payload.map((item) => [item.jobId, item]))
      const rows = candidates
        .filter((job) => byJob.has(job.jobId))
        .map((job, index) => {
          const item = byJob.get(job.jobId)!
          return {
            sessionId: session.id,
            jobId: job.jobId,
            rank: index + 1,
            fitLevel: item.fitLevel,
            summary: item.summary,
            matchPointsJson: JSON.stringify(item.matchPoints),
            gapPointsJson: JSON.stringify(item.gapPoints),
            actionChecklistJson: JSON.stringify(item.actionChecklist),
          }
        })
      if (rows.length > 0) await this.prisma.jobAiRecommendation.createMany({ data: rows })
      const updated = await this.prisma.jobAiSession.update({ where: { id: session.id }, data: { status: 'completed', provider: 'llm' } })
      this.recordAiServiceLog(session.id, 'jobRecommend', 'success', startedAt, parse.endUserId, input.terminalId ?? null)
      const contextById = new Map(candidates.map((job) => [job.jobId, job]))
      return {
        session: this.sessionDto(updated),
        recommendations: rows.map((row) => this.recommendationDto(row, contextById.get(row.jobId)!)),
        disclaimer: '仅供参考' as const,
      }
    } catch (error) {
      await this.rollbackJobAiQuota(quotaTicket)
      await this.markSessionFailed(session.id, error)
      this.recordAiServiceLog(session.id, 'jobRecommend', 'failed', startedAt, parse.endUserId, input.terminalId ?? null, errorCodeOf(error))
      throw error
    }
  }

  async explainJob(
    jobId: string,
    requester: JobAiRequester,
    terminalId: string | null = null,
    quotaContext?: JobAiQuotaContext,
  ) {
    const startedAt = Date.now()
    this.assertMemberAiRequester(requester.endUserId)
    const job = await this.context.buildTargetJobContext(jobId)
    const session = await this.createSession({
      operation: 'explain',
      resumeTaskId: null,
      endUserId: requester.endUserId,
      accessTokenHash: null,
      intent: { jobId },
      terminalId,
      expiresAt: expiresAtFromNow(),
    })
    let quotaTicket: JobAiQuotaTicket | null = null
    try {
      quotaTicket = await this.consumeJobAiQuota('explain', requester.endUserId, terminalId, quotaContext)
      const payload = await this.llm.explain(job)
      const updated = await this.prisma.jobAiSession.update({ where: { id: session.id }, data: { status: 'completed', provider: 'llm' } })
      this.recordAiServiceLog(session.id, 'jobExplain', 'success', startedAt, requester.endUserId, terminalId)
      return {
        session: this.sessionDto(updated),
        job,
        ...payload,
        dataQualityWarning: this.dataQualityWarning(job),
        disclaimer: '仅供参考' as const,
      }
    } catch (error) {
      await this.rollbackJobAiQuota(quotaTicket)
      await this.markSessionFailed(session.id, error)
      this.recordAiServiceLog(session.id, 'jobExplain', 'failed', startedAt, requester.endUserId, terminalId, errorCodeOf(error))
      throw error
    }
  }

  async matchJob(
    jobId: string,
    resumeTaskId: string,
    requester: JobAiRequester,
    terminalId: string | null = null,
    quotaContext?: JobAiQuotaContext,
  ) {
    const startedAt = Date.now()
    const parse = await this.loadAuthorizedParse(resumeTaskId, requester)
    await this.assertResumeAiConsent(parse.endUserId)
    const job = await this.context.buildTargetJobContext(jobId)
    const session = await this.createSession({
      operation: 'match',
      resumeTaskId,
      endUserId: parse.endUserId,
      accessTokenHash: parse.accessTokenHash,
      intent: { jobId },
      terminalId,
      expiresAt: parse.expiresAt,
    })
    let quotaTicket: JobAiQuotaTicket | null = null
    try {
      quotaTicket = await this.consumeJobAiQuota('match', parse.endUserId, terminalId, quotaContext)
      const result = await this.jobFit.analyze({ taskId: resumeTaskId, jobId }, requester)
      if (result.status !== 'completed') {
        const updated = await this.prisma.jobAiSession.update({
          where: { id: session.id },
          data: { status: 'failed', provider: 'llm', intentJson: JSON.stringify({ jobId, failReason: result.failReason }) },
        })
        this.recordAiServiceLog(session.id, 'jobMatch', 'failed', startedAt, parse.endUserId, terminalId, 'AI_JOB_FIT_FAILED')
        await this.rollbackJobAiQuota(quotaTicket)
        return {
          session: this.sessionDto(updated),
          job,
          jobFit: result,
          disclaimer: '仅供参考' as const,
        }
      }
      const fitLevel = typeof result.fitLevel === 'string' ? result.fitLevel : 'reference_medium'
      await this.prisma.jobAiRecommendation.create({
        data: {
          sessionId: session.id,
          jobId,
          rank: 1,
          fitLevel,
          summary: typeof result.summary === 'string' ? result.summary : '岗位匹配参考已生成，请结合简历和岗位要求自行判断。',
          matchPointsJson: JSON.stringify(Array.isArray(result.matchPoints) ? result.matchPoints.map((m) => m.point).slice(0, 5) : []),
          gapPointsJson: JSON.stringify(Array.isArray(result.gapPoints) ? result.gapPoints.map((g) => g.gap).slice(0, 5) : []),
          actionChecklistJson: JSON.stringify(Array.isArray(result.targetedSuggestions) ? result.targetedSuggestions.slice(0, 5) : []),
        },
      })
      const updated = await this.prisma.jobAiSession.update({ where: { id: session.id }, data: { status: 'completed', provider: 'llm' } })
      this.recordAiServiceLog(session.id, 'jobMatch', 'success', startedAt, parse.endUserId, terminalId)
      return {
        session: this.sessionDto(updated),
        job,
        jobFit: result,
        disclaimer: '仅供参考' as const,
      }
    } catch (error) {
      await this.rollbackJobAiQuota(quotaTicket)
      await this.markSessionFailed(session.id, error)
      this.recordAiServiceLog(session.id, 'jobMatch', 'failed', startedAt, parse.endUserId, terminalId, errorCodeOf(error))
      throw error
    }
  }

  async listMine(endUserId: string, page: MemberPageQuery) {
    const where = {
      endUserId,
      expiresAt: { gt: new Date() },
      recommendations: { some: { job: { is: PUBLISHED_JOB_WHERE } } },
    }
    const total = await this.prisma.jobAiSession.count({ where })
    const rows = await this.prisma.jobAiSession.findMany({
      where,
      include: {
        _count: { select: { recommendations: { where: { job: { is: PUBLISHED_JOB_WHERE } } } } },
        recommendations: {
          where: { job: { is: PUBLISHED_JOB_WHERE } },
          orderBy: { rank: 'asc' },
          take: 1,
          include: { job: true },
        },
      },
      ...memberPageArgs(page),
    })
    return buildMemberPage(rows, page, total, (row): JobAiSessionListItem => ({
      session: this.sessionDto(row),
      job: row.recommendations[0]?.job ? rowToTargetJobContext(row.recommendations[0].job) : undefined,
      recommendationCount: row._count.recommendations,
    }))
  }

  async deleteMine(endUserId: string, id: string): Promise<{ deleted: true }> {
    const row = await this.prisma.jobAiSession.findFirst({ where: { id, endUserId }, select: { id: true } })
    if (!row) throw new NotFoundException({ error: { code: 'JOB_AI_SESSION_NOT_FOUND', message: '记录不存在或已删除' } })
    await this.prisma.jobAiSession.delete({ where: { id } })
    return { deleted: true }
  }

  private async loadAuthorizedParse(taskId: string, requester: JobAiRequester) {
    const row = await this.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId, kind: 'parse' } },
      select: { endUserId: true, accessTokenHash: true, expiresAt: true, payloadJson: true },
    })
    const notFound = () =>
      new NotFoundException({ error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请重新提交简历' } })
    if (!row || !row.expiresAt || row.expiresAt.getTime() < Date.now()) throw notFound()
    if (row.endUserId) {
      if (requester.endUserId !== row.endUserId) throw notFound()
    } else if (!row.accessTokenHash || !tokenMatches(requester.accessToken, row.accessTokenHash)) {
      throw notFound()
    }
    let fileId: string | null = null
    try {
      fileId = (JSON.parse(row.payloadJson) as { fileId?: string }).fileId ?? null
    } catch { /* fileId 缺失会走诚实失败 */ }
    return { endUserId: row.endUserId, accessTokenHash: row.accessTokenHash, expiresAt: row.expiresAt, fileId }
  }

  private async loadResumeText(fileId: string | null, endUserId: string | null): Promise<string> {
    if (!fileId) throw unavailable('AI_RESUME_SOURCE_EXPIRED', '简历原文已按隐私策略自动清理，请重新上传简历后再推荐')
    const extracted = await this.extraction.extractResumeText({ fileId, endUserId })
    const text = extracted.ok ? extracted.text?.trim() ?? '' : ''
    if (!text) {
      throw unavailable('AI_RESUME_SOURCE_EXPIRED', '简历原文已按隐私策略自动清理，请重新上传简历后再推荐')
    }
    return text
  }

  private assertMemberAiRequester(endUserId: string | null): void {
    if (!endUserId) {
      throw new ForbiddenException({
        error: {
          code: 'END_USER_AUTH_REQUIRED',
          message: '请登录后使用岗位 AI 解读',
        },
      })
    }
  }

  private async assertResumeAiConsent(endUserId: string | null): Promise<void> {
    await this.privacy.requireActiveConsent(endUserId, 'job_ai')
  }

  private async consumeJobAiQuota(
    operation: JobAiOperation,
    endUserId: string | null,
    terminalId: string | null,
    quotaContext?: JobAiQuotaContext,
  ): Promise<JobAiQuotaTicket> {
    // JOB_AI_QUOTA_EXCEEDED 由 JobAiQuotaService 统一抛出，业务层只负责传入真实维度。
    return this.quota.consume(operation, {
      member: endUserId,
      terminal: terminalId ?? quotaContext?.terminal ?? null,
      ip: quotaContext?.ip ?? null,
    })
  }

  private async rollbackJobAiQuota(ticket: JobAiQuotaTicket | null): Promise<void> {
    await this.quota.rollback(ticket).catch(() => undefined)
  }

  private async findCandidateJobs(input: JobRecommendationInput): Promise<CandidateJob[]> {
    const limit = Math.min(10, Math.max(1, input.limit ?? 6))
    const filters = input.filters ?? {}
    const where = {
      reviewStatus: 'approved',
      publishStatus: 'published',
      ...(filters.city ? { city: filters.city } : {}),
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.sourceOrgId ? { sourceOrgId: filters.sourceOrgId } : {}),
    }
    const rows = await this.prisma.job.findMany({
      where,
      select: {
        id: true,
        title: true,
        company: true,
        sourceName: true,
        sourceUrl: true,
        externalId: true,
        description: true,
        requirements: true,
        skillsJson: true,
        city: true,
        category: true,
      },
      orderBy: { syncTime: 'desc' },
      take: 100,
    })
    const intentKeywords = [
      input.intent?.targetTitle,
      input.intent?.industry,
      ...(input.intent?.keywords ?? []),
      ...(filters.skills ?? []),
    ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    return rows
      .map((row) => {
        const job = rowToTargetJobContext(row)
        return { ...job, score: scoreJob(job, input, intentKeywords) }
      })
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'zh-Hans-CN'))
      .slice(0, limit)
  }

  private async createSession(input: {
    operation: JobAiOperation
    resumeTaskId: string | null
    endUserId: string | null
    accessTokenHash: string | null
    intent: unknown
    terminalId: string | null
    expiresAt: Date | null
  }) {
    return this.prisma.jobAiSession.create({
      data: {
        operation: input.operation,
        resumeTaskId: input.resumeTaskId,
        endUserId: input.endUserId,
        accessTokenHash: input.accessTokenHash,
        intentJson: JSON.stringify(input.intent ?? {}),
        status: 'pending',
        terminalId: input.terminalId,
        expiresAt: input.expiresAt ?? expiresAtFromNow(),
      },
    })
  }

  private async markSessionFailed(sessionId: string, error: unknown): Promise<void> {
    await this.prisma.jobAiSession.update({
      where: { id: sessionId },
      data: {
        status: 'failed',
        provider: 'llm',
        intentJson: JSON.stringify({ errorCode: errorCodeOf(error) }),
      },
    }).catch(() => undefined)
  }

  private recordAiServiceLog(
    taskId: string,
    operation: 'jobRecommend' | 'jobExplain' | 'jobMatch',
    status: 'success' | 'failed',
    startedAt: number,
    endUserId: string | null,
    terminalId: string | null,
    errorCode?: string,
  ): void {
    this.aiLog.record({
      taskId,
      operation,
      provider: 'llm',
      status,
      latencyMs: Math.max(0, Date.now() - startedAt),
      errorCode,
      tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      estimatedCostCny: 0,
      terminalId,
      endUserId,
    })
  }

  private recommendationDto(
    row: {
      rank: number
      fitLevel: string
      summary: string | null
      matchPointsJson: string
      gapPointsJson: string
      actionChecklistJson: string
    },
    job: TargetJobContext,
  ): JobAiRecommendationDTO {
    return {
      job,
      rank: row.rank,
      fitLevel: row.fitLevel as JobAiRecommendationDTO['fitLevel'],
      summary: row.summary ?? '仅供参考，请结合岗位来源信息自行判断。',
      matchPoints: safeJsonList(row.matchPointsJson),
      gapPoints: safeJsonList(row.gapPointsJson),
      actionChecklist: safeJsonList(row.actionChecklistJson),
      createdAt: new Date().toISOString(),
    }
  }

  private sessionDto(row: {
    id: string
    resumeTaskId: string | null
    operation: string
    status: string
    provider: string | null
    terminalId: string | null
    createdAt: Date
    expiresAt: Date | null
  }): JobAiSessionDTO {
    return {
      id: row.id,
      resumeTaskId: row.resumeTaskId,
      operation: row.operation as JobAiOperation,
      status: row.status as JobAiSessionDTO['status'],
      provider: row.provider,
      terminalId: row.terminalId,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    }
  }

  private dataQualityWarning(job: TargetJobContext): string | undefined {
    if (!job.description && !job.requirements) return '来源平台未提供岗位描述或任职要求，AI 解读仅能基于标题和基础字段。'
    if (job.skills.length === 0) return '来源平台未提供技能标签，AI 解读可能不够完整。'
    return undefined
  }
}

function hashAccessToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function tokenMatches(token: string | null, expectedHash: string | null): boolean {
  if (!token || !expectedHash) return false
  const actual = Buffer.from(hashAccessToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function unavailable(code: string, message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({ error: { code, message } })
}

function expiresAtFromNow(): Date {
  return new Date(Date.now() + RESULT_TTL_HOURS * 60 * 60 * 1000)
}

function rowToTargetJobContext(row: {
  id: string
  title: string
  company: string
  sourceName: string
  sourceUrl: string
  externalId: string
  description: string | null
  requirements: string | null
  skillsJson: string
  city: string
  category: string | null
}): TargetJobContext {
  return {
    jobId: row.id,
    title: row.title,
    company: row.company,
    sourceName: row.sourceName,
    sourceUrl: row.sourceUrl,
    externalId: row.externalId,
    description: row.description ?? undefined,
    requirements: row.requirements ?? undefined,
    skills: safeJsonList(row.skillsJson),
    city: row.city,
    category: row.category ?? undefined,
  }
}

function safeJsonList(value: string | null | undefined): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()).slice(0, 10)
      : []
  } catch {
    return []
  }
}

function scoreJob(job: TargetJobContext, input: JobRecommendationInput, keywords: string[]): number {
  let score = 0
  if (input.intent?.city && job.city === input.intent.city) score += 5
  if (input.intent?.targetTitle && job.title.includes(input.intent.targetTitle)) score += 6
  for (const keyword of keywords) {
    if (job.title.includes(keyword)) score += 4
    if (job.company.includes(keyword)) score += 1
    if ((job.description ?? '').includes(keyword)) score += 2
    if ((job.requirements ?? '').includes(keyword)) score += 2
    if (job.skills.some((skill) => skill.includes(keyword) || keyword.includes(skill))) score += 3
  }
  return score
}

function errorCodeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { error?: { code?: string } } }).response
    if (response?.error?.code) return response.error.code
  }
  return error instanceof Error ? error.name : 'JOB_AI_FAILED'
}
