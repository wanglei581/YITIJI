import { Injectable, NotFoundException } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { FilesService } from '../../files/files.service'
import { signFileUrl } from '../../files/signing'
import { ResumeExtractionService } from './resume-extraction.service'
import { LlmCareerPlanService, type CareerPlanPayload } from './llm-career-plan.service'
import { CareerPlanPdfService } from './career-plan-pdf.service'

// ============================================================
// 2E 职业规划会话服务。
//
// 闭环（user-data-flow-matrix §五）：真实化既有「职业规划」入口 →
// kind=career_plan 进 AI服务记录 → PDF 建议单进我的文档 → 打印进打印订单 →
// 结果页 CTA 串联简历优化/岗位匹配/模拟面试。
//
// 归属：凭 parse 行门禁（会员 endUserId / 匿名 accessToken，对齐 C-2A）；
// 上下文聚合（如实分层）：简历原文必有；最近 job_fit（同 taskId）可选；
// 最近模拟面试表现摘要仅会员可聚合（匿名面试凭证独立，不跨链）。
// 留存：upsert（同 parse 任务保留最近一次），TTL 同 AiResumeResult 治理。
// ============================================================

const RESULT_TTL_HOURS = (() => {
  const raw = Number(process.env['AI_RESUME_RESULT_TTL_HOURS'])
  return Number.isFinite(raw) && raw > 0 ? raw : 24
})()

export interface CareerPlanRequester {
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

interface StoredCareerPlan {
  payload: CareerPlanPayload
  /** 生成时使用的上下文来源（如实展示给用户：基于哪些材料） */
  basedOn: { resume: true; jobFit: string | null; interview: string | null }
  providerName: string
}

@Injectable()
export class CareerPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmCareerPlanService,
    private readonly extraction: ResumeExtractionService,
    private readonly files: FilesService,
    private readonly pdf: CareerPlanPdfService,
    private readonly audit: AuditService,
  ) {}

  async generate(taskId: string, requester: CareerPlanRequester) {
    const parse = await this.loadAuthorizedParse(taskId, requester)

    // 简历原文重提（2B 模式；清理后诚实失败不调 LLM）
    let resumeText: string | undefined
    if (parse.fileId) {
      const extraction = await this.extraction.extractResumeText({ fileId: parse.fileId, endUserId: parse.endUserId })
      if (extraction.ok) resumeText = extraction.text
    }
    if (!resumeText) {
      return {
        taskId,
        status: 'failed' as const,
        failReason: '简历原文已按隐私策略自动清理，请重新上传简历后再生成职业规划',
      }
    }

    // 可选上下文（如实分层，绝不跨归属）：
    // 1) 同 taskId 的最近岗位匹配参考
    let jobFitCtx: { jobTitle: string; fitLevel: string; gaps: string[] } | null = null
    const jobFitRow = await this.prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'job_fit' } } })
    if (jobFitRow && jobFitRow.expiresAt && jobFitRow.expiresAt.getTime() > Date.now()) {
      try {
        const stored = JSON.parse(jobFitRow.payloadJson) as {
          job?: { title?: string }
          payload?: { fitLevel?: string; gapPoints?: Array<{ gap?: string }> }
        }
        if (stored.job?.title && stored.payload?.fitLevel) {
          jobFitCtx = {
            jobTitle: stored.job.title,
            fitLevel: stored.payload.fitLevel,
            gaps: (stored.payload.gapPoints ?? []).map((g) => g.gap ?? '').filter(Boolean).slice(0, 3),
          }
        }
      } catch { /* 损坏行按无上下文处理 */ }
    }
    // 2) 最近模拟面试表现摘要（仅会员；匿名面试凭证独立不跨链）
    let interviewCtx: { position: string; level: string; risks: string[] } | null = null
    if (parse.endUserId) {
      const session = await this.prisma.mockInterviewSession.findFirst({
        where: { endUserId: parse.endUserId, status: 'completed', expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { position: true, report: { select: { payloadJson: true, expiresAt: true } } },
      })
      if (session?.report && session.report.expiresAt.getTime() > Date.now()) {
        try {
          const rep = JSON.parse(session.report.payloadJson) as { overall?: { level?: string }; risks?: string[] }
          if (rep.overall?.level) {
            interviewCtx = { position: session.position, level: rep.overall.level, risks: (rep.risks ?? []).slice(0, 3) }
          }
        } catch { /* 同上 */ }
      }
    }

    const payload = await this.llm.build({ resumeText, jobFit: jobFitCtx, interview: interviewCtx })
    const stored: StoredCareerPlan = {
      payload,
      basedOn: { resume: true, jobFit: jobFitCtx?.jobTitle ?? null, interview: interviewCtx?.position ?? null },
      providerName: 'llm',
    }
    const expiresAt = new Date(Date.now() + RESULT_TTL_HOURS * 60 * 60 * 1000)
    await this.prisma.aiResumeResult.upsert({
      where: { taskId_kind: { taskId, kind: 'career_plan' } },
      update: { status: 'completed', payloadJson: JSON.stringify(stored), expiresAt },
      create: {
        taskId,
        kind: 'career_plan',
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
      action: 'resume.career_plan',
      targetType: 'ai_task',
      targetId: taskId,
      // 仅元数据：不含简历/规划内容
      payload: { hasJobFitCtx: !!jobFitCtx, hasInterviewCtx: !!interviewCtx, hasEndUser: !!parse.endUserId },
      ipAddress: null, userAgent: null, requestId: null,
    })
    return this.toResponse(taskId, stored)
  }

  /** 读回最近一次规划（刷新恢复 / 会员回看）。 */
  async getLatest(taskId: string, requester: CareerPlanRequester) {
    await this.loadAuthorizedParse(taskId, requester)
    const row = await this.prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'career_plan' } } })
    if (!row || !row.expiresAt || row.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException({ error: { code: 'CAREER_PLAN_NOT_FOUND', message: '暂无职业规划记录，请先生成' } })
    }
    return this.toResponse(taskId, JSON.parse(row.payloadJson) as StoredCareerPlan)
  }

  /** 打印版建议单：服务端真实 PDF → FileObject（我的文档）→ 既有打印链路（打印订单）。 */
  async printPlan(taskId: string, requester: CareerPlanRequester) {
    const parse = await this.loadAuthorizedParse(taskId, requester)
    const row = await this.prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'career_plan' } } })
    if (!row || !row.expiresAt || row.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException({ error: { code: 'CAREER_PLAN_NOT_FOUND', message: '暂无职业规划记录，请先生成' } })
    }
    const stored = JSON.parse(row.payloadJson) as StoredCareerPlan
    const { buffer, pageCount } = await this.pdf.render(
      { date: new Date(row.updatedAt).toISOString().slice(0, 10), basedOn: stored.basedOn },
      stored.payload,
    )
    const uploaded = await this.files.upload({
      buffer,
      filename: `职业规划建议单.pdf`,
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      uploaderId: null,
      endUserId: parse.endUserId,
      createdBy: 'career_plan',
    })
    await this.audit.write({
      actorId: null,
      actorRole: parse.endUserId ? 'enduser' : 'kiosk',
      action: 'resume.career_plan_print',
      targetType: 'ai_task',
      targetId: taskId,
      payload: { fileId: uploaded.fileId, pageCount },
      ipAddress: null, userAgent: null, requestId: null,
    })
    return {
      fileId: uploaded.fileId,
      filename: uploaded.filename,
      sizeBytes: uploaded.sizeBytes,
      pageCount,
      signedUrl: uploaded.signedUrl,
      expiresAt: uploaded.signedUrlExpiresAt,
      printFileUrl: signFileUrl(uploaded.fileId).url,
    }
  }

  private toResponse(taskId: string, stored: StoredCareerPlan) {
    return {
      taskId,
      status: 'completed' as const,
      basedOn: stored.basedOn,
      ...stored.payload,
      providerName: stored.providerName,
    }
  }

  /** parse 行门禁（与 2D JobFitService 同语义；拒绝统一 NOT_FOUND）。 */
  private async loadAuthorizedParse(taskId: string, requester: CareerPlanRequester) {
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
