import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { ResumeExtractionService } from './resume-extraction.service'
import { LlmJobMasterService, type JobMasterPayload } from './llm-job-master.service'

// ============================================================
// 岗位大师（岗位决策分析台）M1 会话服务。
// 契约源：packages/shared/src/types/ai.ts（JobMasterResponse）。
//
// 闭环（设计 §四/§6.3）：选岗（站内单岗 approved+published 或手填）→ 简历原文重提
// → 单次 LLM 分析（适配度+路径+风险）→ 薪资透传来源方文本 → 竖屏四段结果 →
// kind=job_master 进 AI服务记录（报告 PDF / 打印为 M1 里程碑 3）。
//
// 归属（对齐 C-2A / job-fit）：凭 parse 行门禁（会员 endUserId 本人 / 匿名
// accessToken），任何拒绝统一 AI_TASK_NOT_FOUND。job_master 行继承 parse 行归属与 TTL。
// 简历原文按 2B 模式凭 fileId 重提，不落库、不写日志原文。岗位数据只读。
// 留存：upsert（同一 parse 任务保留最近一次），expiresAt 同 AiResumeResult 治理。
// ============================================================

const RESULT_TTL_HOURS = (() => {
  const raw = Number(process.env['AI_RESUME_RESULT_TTL_HOURS'])
  return Number.isFinite(raw) && raw > 0 ? raw : 24
})()

export interface JobMasterRequester {
  endUserId: string | null
  accessToken: string | null
}

/** 导出以便 controller 公有方法的返回类型可命名（TS4053）。契约源 packages/shared JobMasterSalaryRef。 */
export interface JobMasterSalaryRef {
  sourceText: string | null
  internalStats: null
  note: string
}

interface StoredJobMaster {
  job: { title: string; company: string | null; sourceName: string | null; sourceUrl: string | null; externalId: string | null }
  salary: JobMasterSalaryRef
  payload: JobMasterPayload
  providerName: string
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

/** 薪资参考（M1 只透传来源方文本；站内统计留 M2）。 */
function buildSalaryRef(sourceText: string | null): JobMasterSalaryRef {
  const text = sourceText?.trim() || null
  return {
    sourceText: text,
    internalStats: null,
    note: text ? '薪资由来源方提供，仅供参考' : '来源平台未提供薪资信息，建议到来源平台核实',
  }
}

@Injectable()
export class JobMasterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmJobMasterService,
    private readonly extraction: ResumeExtractionService,
    private readonly audit: AuditService,
  ) {}

  async analyze(
    input: { taskId: string; jobId?: string; manualJob?: { title: string; requirements?: string } },
    requester: JobMasterRequester,
  ) {
    const parse = await this.loadAuthorizedParse(input.taskId, requester)

    // 岗位上下文：二选一（站内已发布岗位 或 手填）
    let jobCtx: { title: string; company: string | null; description: string | null; requirements: string | null }
    let jobInfo: StoredJobMaster['job']
    let salary: JobMasterSalaryRef
    if (input.jobId) {
      const job = await this.prisma.job.findFirst({
        where: { id: input.jobId, reviewStatus: 'approved', publishStatus: 'published' },
        select: { title: true, company: true, description: true, requirements: true, salary: true, sourceName: true, sourceUrl: true, externalId: true },
      })
      if (!job) {
        throw new NotFoundException({ error: { code: 'JOB_NOT_FOUND', message: '岗位不存在或未发布' } })
      }
      jobCtx = { title: job.title, company: job.company, description: job.description, requirements: job.requirements }
      jobInfo = { title: job.title, company: job.company, sourceName: job.sourceName, sourceUrl: job.sourceUrl, externalId: job.externalId }
      salary = buildSalaryRef(job.salary)
    } else if (input.manualJob?.title?.trim()) {
      const title = input.manualJob.title.trim().slice(0, 50)
      const requirements = input.manualJob.requirements?.trim().slice(0, 2000) || null
      jobCtx = { title, company: null, description: null, requirements }
      jobInfo = { title, company: null, sourceName: null, sourceUrl: null, externalId: null }
      salary = buildSalaryRef(null)
    } else {
      throw new BadRequestException({ error: { code: 'JOB_MASTER_TARGET_MISSING', message: '请选择系统内岗位或填写目标岗位' } })
    }

    // 简历原文重提（2B 模式；文件按 TTL 清理后诚实失败，不调 LLM）
    let resumeText: string | undefined
    if (parse.fileId) {
      const extraction = await this.extraction.extractResumeText({ fileId: parse.fileId, endUserId: parse.endUserId })
      if (extraction.ok) resumeText = extraction.text
    }
    if (!resumeText) {
      return {
        taskId: input.taskId,
        status: 'failed' as const,
        failReason: '简历原文已按隐私策略自动清理，请重新上传简历后再分析',
      }
    }

    const payload = await this.llm.analyze(resumeText, jobCtx)
    const stored: StoredJobMaster = { job: jobInfo, salary, payload, providerName: 'llm' }
    const expiresAt = new Date(Date.now() + RESULT_TTL_HOURS * 60 * 60 * 1000)
    // 同一 parse 任务保留最近一次分析（unique(taskId,kind) → upsert 覆盖）
    await this.prisma.aiResumeResult.upsert({
      where: { taskId_kind: { taskId: input.taskId, kind: 'job_master' } },
      update: { status: 'completed', payloadJson: JSON.stringify(stored), expiresAt },
      create: {
        taskId: input.taskId,
        kind: 'job_master',
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
      action: 'resume.job_master',
      targetType: 'ai_task',
      targetId: input.taskId,
      // 仅元数据：不含简历/岗位/输出内容
      payload: {
        mode: input.jobId ? 'job' : 'manual',
        fitLevel: payload.fit.level,
        riskCount: payload.risks.length,
        hasSalary: !!stored.salary.sourceText,
        hasEndUser: !!parse.endUserId,
      },
      ipAddress: null, userAgent: null, requestId: null,
    })
    return this.toResponse(input.taskId, stored)
  }

  /** 读回最近一次分析（刷新恢复 / 会员回看）。 */
  async getLatest(taskId: string, requester: JobMasterRequester) {
    await this.loadAuthorizedParse(taskId, requester)
    const row = await this.prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'job_master' } } })
    if (!row || !row.expiresAt || row.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException({ error: { code: 'JOB_MASTER_NOT_FOUND', message: '暂无岗位决策分析，请先发起分析' } })
    }
    return this.toResponse(taskId, JSON.parse(row.payloadJson) as StoredJobMaster)
  }

  private toResponse(taskId: string, stored: StoredJobMaster) {
    return {
      taskId,
      status: 'completed' as const,
      job: stored.job,
      salary: stored.salary,
      fit: stored.payload.fit,
      careerPath: stored.payload.careerPath,
      risks: stored.payload.risks,
      providerName: stored.providerName,
    }
  }

  /** parse 行门禁（与 2D JobFitService 同语义；拒绝统一 NOT_FOUND）。 */
  private async loadAuthorizedParse(taskId: string, requester: JobMasterRequester) {
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
