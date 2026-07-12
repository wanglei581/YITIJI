import { ForbiddenException, Injectable } from '@nestjs/common'
import { AiLogService } from '../ai/ai-log.service'
import {
  JobFitService,
  type AuthorizedJobFitParse,
  type JobFitAnalyzeWithUsageResult,
  type JobFitRequester,
} from '../ai/resume/job-fit.service'
import { MemberPrivacyService } from '../member-privacy/member-privacy.service'
import { PrismaService } from '../prisma/prisma.service'
import { JobAiQuotaService, type JobAiQuotaContext, type JobAiQuotaTicket } from './job-ai-quota.service'
import { JobContextService } from './job-context.service'
import type { JobAiRequester, TargetJobContext } from './job-ai.types'

type JobFitInput = {
  taskId: string
  jobId?: string
  manualJob?: { title: string; requirements?: string }
}

type MatchForMemberInput = {
  jobId: string
  resumeTaskId: string
  requester: JobAiRequester
  terminalId: string | null
  quotaContext?: JobAiQuotaContext
}

type SessionRow = {
  id: string
  resumeTaskId: string | null
  operation: string
  status: string
  provider: string | null
  terminalId: string | null
  createdAt: Date
  expiresAt: Date | null
}

type RunResult = {
  session: SessionRow
  response: JobFitAnalyzeWithUsageResult['response']
}

/**
 * 将 Job Fit 的同意、配额、会话与用量治理集中在 JobAiModule。
 *
 * JobFitService 继续负责 parse 归属、岗位上下文、LLM 与结果落库；本服务只沿
 * JobAiModule -> AiModule 的既有依赖方向编排，避免把 JobAi 反向注入 AiModule。
 */
@Injectable()
export class GovernedJobFitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobFit: JobFitService,
    private readonly context: JobContextService,
    private readonly aiLog: AiLogService,
    private readonly privacy: MemberPrivacyService,
    private readonly quota: JobAiQuotaService,
  ) {}

  async analyzeForJobFit(
    input: JobFitInput,
    requester: JobFitRequester,
    quotaContext: JobAiQuotaContext,
  ): Promise<JobFitAnalyzeWithUsageResult['response']> {
    const parse = await this.authorizeForAnalysis(input.taskId, requester)
    const job = input.jobId ? await this.context.buildTargetJobContext(input.jobId) : null
    const run = await this.run({ input, requester, parse, job, terminalId: quotaContext.terminal, quotaContext })
    return run.response
  }

  async matchForMember(input: MatchForMemberInput) {
    if (!input.requester.endUserId) {
      // 与原 JobAiService.matchJob 一样交给会员 consent 服务产生 403；后置 throw
      // 是内存替身不抛错时的 fail-closed 防线。
      await this.privacy.requireActiveConsent(null, 'job_ai')
      throw new ForbiddenException({
        error: { code: 'USER_AI_CONSENT_REQUIRED', message: '请登录并确认 AI 简历分析授权后再使用岗位推荐' },
      })
    }

    const parse = await this.authorizeForAnalysis(input.resumeTaskId, input.requester)
    const job = await this.context.buildTargetJobContext(input.jobId)
    const run = await this.run({
      input: { taskId: input.resumeTaskId, jobId: input.jobId },
      requester: input.requester,
      parse,
      job,
      terminalId: input.terminalId,
      quotaContext: input.quotaContext ?? {
        member: input.requester.endUserId,
        terminal: input.terminalId,
        ip: null,
      },
    })
    return {
      session: this.sessionDto(run.session),
      job,
      jobFit: run.response,
      disclaimer: '仅供参考' as const,
    }
  }

  private async authorizeForAnalysis(taskId: string, requester: JobFitRequester): Promise<AuthorizedJobFitParse> {
    const parse = await this.jobFit.authorizeParseForJobFit(taskId, requester)
    if (parse.endUserId) {
      await this.privacy.requireActiveConsent(parse.endUserId, 'job_ai')
    } else {
      this.jobFit.requireActiveAnonymousJobFitConsent(parse)
    }
    return parse
  }

  private async run(input: {
    input: JobFitInput
    requester: JobFitRequester
    parse: AuthorizedJobFitParse
    job: TargetJobContext | null
    terminalId: string | null
    quotaContext: JobAiQuotaContext
  }): Promise<RunResult> {
    const startedAt = Date.now()
    const { parse } = input
    const session = await this.prisma.jobAiSession.create({
      data: {
        operation: 'match',
        resumeTaskId: input.input.taskId,
        endUserId: parse.endUserId,
        accessTokenHash: parse.accessTokenHash,
        // 手填岗位只保存 title，requirements 可能含敏感求职信息，禁止写入会话。
        intentJson: JSON.stringify(input.input.jobId
          ? { jobId: input.input.jobId }
          : { title: input.input.manualJob?.title?.trim().slice(0, 50) ?? '' }),
        status: 'pending',
        terminalId: input.terminalId,
        expiresAt: parse.expiresAt,
      },
    })

    let ticket: JobAiQuotaTicket | null = null
    try {
      ticket = await this.quota.consume('match', input.quotaContext)
      const result = await this.jobFit.analyzeWithUsage(input.input, input.requester)
      if (result.response.status !== 'completed') {
        const failed = await this.markSessionFailed(session.id, result.provider)
        await this.rollbackQuota(ticket)
        this.record(session.id, 'failed', startedAt, input.parse.endUserId, input.terminalId, result.provider, 'AI_JOB_FIT_FAILED')
        return { session: failed, response: result.response }
      }

      if (input.input.jobId && input.job) await this.createRecommendation(session.id, input.input.jobId, result)
      const completed = await this.prisma.jobAiSession.update({
        where: { id: session.id },
        data: { status: 'completed', provider: result.provider },
      })
      this.record(session.id, 'success', startedAt, input.parse.endUserId, input.terminalId, result.provider, undefined, result.tokenUsage)
      return { session: completed, response: result.response }
    } catch (error) {
      await this.rollbackQuota(ticket)
      await this.markSessionFailed(session.id, 'llm')
      this.record(session.id, 'failed', startedAt, input.parse.endUserId, input.terminalId, 'llm', errorCodeOf(error))
      throw error
    }
  }

  private async createRecommendation(sessionId: string, jobId: string, result: JobFitAnalyzeWithUsageResult): Promise<void> {
    if (result.response.status !== 'completed') return
    await this.prisma.jobAiRecommendation.create({
      data: {
        sessionId,
        jobId,
        rank: 1,
        fitLevel: result.response.fitLevel ?? 'reference_medium',
        summary: result.response.summary ?? '岗位匹配参考已生成，请结合简历和岗位要求自行判断。',
        matchPointsJson: JSON.stringify((result.response.matchPoints ?? []).map((item) => item.point).slice(0, 5)),
        gapPointsJson: JSON.stringify((result.response.gapPoints ?? []).map((item) => item.gap).slice(0, 5)),
        actionChecklistJson: JSON.stringify((result.response.targetedSuggestions ?? []).slice(0, 5)),
      },
    })
  }

  private async markSessionFailed(sessionId: string, provider: string): Promise<SessionRow> {
    return this.prisma.jobAiSession.update({
      where: { id: sessionId },
      data: { status: 'failed', provider },
    })
  }

  private async rollbackQuota(ticket: JobAiQuotaTicket | null): Promise<void> {
    await this.quota.rollback(ticket).catch(() => undefined)
  }

  private record(
    taskId: string,
    status: 'success' | 'failed',
    startedAt: number,
    endUserId: string | null,
    terminalId: string | null,
    provider: string,
    errorCode?: string,
    tokenUsage?: JobFitAnalyzeWithUsageResult['tokenUsage'],
  ): void {
    this.aiLog.record({
      taskId,
      operation: 'jobMatch',
      provider,
      status,
      latencyMs: Math.max(0, Date.now() - startedAt),
      errorCode,
      tokenUsage,
      terminalId,
      endUserId,
    })
  }

  private sessionDto(row: SessionRow) {
    return {
      id: row.id,
      resumeTaskId: row.resumeTaskId,
      operation: 'match' as const,
      status: row.status as 'pending' | 'completed' | 'failed',
      provider: row.provider,
      terminalId: row.terminalId,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
    }
  }
}

function errorCodeOf(error: unknown): string {
  const response = error && typeof error === 'object' && typeof (error as { getResponse?: unknown }).getResponse === 'function'
    ? (error as { getResponse: () => unknown }).getResponse()
    : null
  const nested = response && typeof response === 'object' ? (response as { error?: unknown }).error : null
  return nested && typeof nested === 'object' && typeof (nested as { code?: unknown }).code === 'string'
    ? (nested as { code: string }).code
    : 'JOB_AI_ANALYZE_FAILED'
}
