import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { ResumeExtractionService } from './resume-extraction.service'
import { LlmJobFitService, type JobFitPayload, type JobFitTokenUsage } from './llm-job-fit.service'

// ============================================================
// 2D 岗位匹配参考会话服务。
//
// 归属（对齐 C-2A）：凭 parse 行门禁（会员 endUserId 本人 / 匿名 accessToken），
// 任何拒绝统一 AI_TASK_NOT_FOUND。job_fit 行继承 parse 行归属与 TTL 范式。
// 岗位上下文：系统内已发布岗位（approved+published，附来源信息引导「去来源平台
// 投递」）或用户手填岗位。简历原文按 2B 模式凭 fileId 重提，不落库。
// 留存：结果 upsert（同一 parse 任务保留最近一次分析），expiresAt 同 AiResumeResult 治理。
// ============================================================

const RESULT_TTL_HOURS = (() => {
  const raw = Number(process.env['AI_RESUME_RESULT_TTL_HOURS'])
  return Number.isFinite(raw) && raw > 0 ? raw : 24
})()

export interface JobFitRequester {
  endUserId: string | null
  accessToken: string | null
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

function tokenMatches(token: string | null, expectedHash: string | null): boolean {
  if (!token || !expectedHash) return false
  const actual = Buffer.from(hashToken(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

interface StoredJobFit {
  job: { title: string; company: string | null; sourceName: string | null; sourceUrl: string | null; externalId: string | null }
  payload: JobFitPayload
  providerName: string
}

type JobFitCompletedResponse = {
  taskId: string
  status: 'completed'
  job: StoredJobFit['job']
  providerName: string
} & JobFitPayload

export interface JobFitAnalyzeWithUsageResult {
  response: JobFitCompletedResponse | {
    taskId: string
    status: 'failed'
    failReason: string
  }
  provider: string
  tokenUsage?: JobFitTokenUsage
}

@Injectable()
export class JobFitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmJobFitService,
    private readonly extraction: ResumeExtractionService,
    private readonly audit: AuditService,
  ) {}

  async analyze(
    input: { taskId: string; jobId?: string; manualJob?: { title: string; requirements?: string } },
    requester: JobFitRequester,
  ) {
    const result = await this.analyzeWithUsage(input, requester)
    return result.response
  }

  async analyzeWithUsage(
    input: { taskId: string; jobId?: string; manualJob?: { title: string; requirements?: string } },
    requester: JobFitRequester,
  ): Promise<JobFitAnalyzeWithUsageResult> {
    const parse = await this.loadAuthorizedParse(input.taskId, requester)

    // 岗位上下文：二选一
    let jobCtx: { title: string; company: string | null; description: string | null; requirements: string | null }
    let jobInfo: StoredJobFit['job']
    if (input.jobId) {
      const job = await this.prisma.job.findFirst({
        where: { id: input.jobId, reviewStatus: 'approved', publishStatus: 'published' },
        select: { title: true, company: true, description: true, requirements: true, sourceName: true, sourceUrl: true, externalId: true },
      })
      if (!job) {
        throw new NotFoundException({ error: { code: 'JOB_NOT_FOUND', message: '岗位不存在或未发布' } })
      }
      jobCtx = { title: job.title, company: job.company, description: job.description, requirements: job.requirements }
      jobInfo = { title: job.title, company: job.company, sourceName: job.sourceName, sourceUrl: job.sourceUrl, externalId: job.externalId }
    } else if (input.manualJob?.title?.trim()) {
      const title = input.manualJob.title.trim().slice(0, 50)
      const requirements = input.manualJob.requirements?.trim().slice(0, 2000) || null
      jobCtx = { title, company: null, description: null, requirements }
      jobInfo = { title, company: null, sourceName: null, sourceUrl: null, externalId: null }
    } else {
      throw new BadRequestException({ error: { code: 'JOB_FIT_TARGET_MISSING', message: '请选择系统内岗位或填写目标岗位' } })
    }

    // 简历原文重提（2B 模式；文件按 TTL 清理后诚实失败）
    let resumeText: string | undefined
    if (parse.fileId) {
      const extraction = await this.extraction.extractResumeText({ fileId: parse.fileId, endUserId: parse.endUserId })
      if (extraction.ok) resumeText = extraction.text
    }
    if (!resumeText) {
      return {
        response: {
          taskId: input.taskId,
          status: 'failed' as const,
          failReason: '简历原文已按隐私策略自动清理，请重新上传简历后再分析',
        },
        provider: 'llm',
      }
    }

    const llmResult = await this.llm.analyze(resumeText, jobCtx)
    const payload = llmResult.payload
    const stored: StoredJobFit = { job: jobInfo, payload, providerName: 'llm' }
    const expiresAt = new Date(Date.now() + RESULT_TTL_HOURS * 60 * 60 * 1000)
    // 同一 parse 任务保留最近一次分析（unique(taskId,kind) → upsert 覆盖）
    await this.prisma.aiResumeResult.upsert({
      where: { taskId_kind: { taskId: input.taskId, kind: 'job_fit' } },
      update: { status: 'completed', payloadJson: JSON.stringify(stored), expiresAt },
      create: {
        taskId: input.taskId,
        kind: 'job_fit',
        status: 'completed',
        provider: 'llm',
        payloadJson: JSON.stringify(stored),
        endUserId: parse.endUserId,
        accessTokenHash: parse.accessTokenHash,
        expiresAt,
      },
    })
    await this.audit.write({
      actorId: null,
      actorRole: parse.endUserId ? 'enduser' : 'kiosk',
      action: 'resume.job_fit',
      targetType: 'ai_task',
      targetId: input.taskId,
      // 仅元数据：不含简历/岗位/输出内容
      payload: { mode: input.jobId ? 'job' : 'manual', fitLevel: payload.fitLevel, hasEndUser: !!parse.endUserId },
      ipAddress: null, userAgent: null, requestId: null,
    })
    return {
      response: this.toResponse(input.taskId, stored),
      provider: llmResult.provider,
      tokenUsage: llmResult.tokenUsage,
    }
  }

  /** 读回最近一次分析（刷新恢复 / 会员回看）。 */
  async getLatest(taskId: string, requester: JobFitRequester) {
    await this.loadAuthorizedParse(taskId, requester)
    const row = await this.prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'job_fit' } } })
    if (!row || !row.expiresAt || row.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException({ error: { code: 'JOB_FIT_NOT_FOUND', message: '暂无分析结果，请先发起岗位匹配参考' } })
    }
    return this.toResponse(taskId, JSON.parse(row.payloadJson) as StoredJobFit)
  }

  private toResponse(taskId: string, stored: StoredJobFit): JobFitCompletedResponse {
    return {
      taskId,
      status: 'completed' as const,
      job: stored.job,
      ...stored.payload,
      providerName: stored.providerName,
    }
  }

  /** parse 行门禁（对齐 AiService.loadAuthorizedResult 语义；拒绝统一 NOT_FOUND）。 */
  private async loadAuthorizedParse(taskId: string, requester: JobFitRequester) {
    const row = await this.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId, kind: 'parse' } },
      select: { endUserId: true, accessTokenHash: true, expiresAt: true, payloadJson: true },
    })
    const notFound = () =>
      new NotFoundException({ error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请重新提交简历' } })
    if (!row || !row.expiresAt || row.expiresAt.getTime() < Date.now()) throw notFound()
    if (row.endUserId) {
      if (requester.endUserId !== row.endUserId) throw notFound()
    } else {
      if (!row.accessTokenHash || !tokenMatches(requester.accessToken, row.accessTokenHash)) throw notFound()
    }
    let fileId: string | null = null
    try {
      fileId = (JSON.parse(row.payloadJson) as { fileId?: string }).fileId ?? null
    } catch { /* fileId 缺失走诚实失败分支 */ }
    return { endUserId: row.endUserId, accessTokenHash: row.accessTokenHash, fileId }
  }
}
