import { Inject, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { FilesService } from '../../files/files.service'
import { signFileUrl } from '../../files/signing'
import { ResumeExtractionService } from './resume-extraction.service'
import { LlmCareerPlanService, type CareerPlanPayload } from './llm-career-plan.service'
import { CareerPlanPdfService } from './career-plan-pdf.service'
import { CareerPlanDegradedPdfService, DEGRADED_PDF_FILENAME } from './career-plan-degraded-pdf.service'
import {
  CAREER_PLAN_JOB_REQUIREMENT_STATS,
  type CareerPlanJobRequirementStatsPort,
  type DegradedCareerPlanContent,
  type DegradedJobRequirementStats,
  type DegradedSelfAssessmentDimension,
} from './career-plan-degraded'
import { AiLogService, AiUsageAccumulator, aiErrorCodeOf } from '../ai-log.service'

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
  basedOn: {
    resume: true
    jobFit: string | null
    interview: string | null
    /** self_assessment 仅作可选上下文 hint，不参与签名门禁 / 校验 / 配额。 */
    selfAssessment: string | null
  }
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
    private readonly aiLog: AiLogService,
    private readonly degradedPdf: CareerPlanDegradedPdfService,
    /**
     * 岗位要求计数（E2）。PR #636 合入前本 token 不注册 —— 拿不到就在纸上如实写
     * 「本次未取到」，绝不留白或编一张空表。见 career-plan-degraded.ts 的接线说明。
     */
    @Optional()
    @Inject(CAREER_PLAN_JOB_REQUIREMENT_STATS)
    private readonly jobRequirementStats?: CareerPlanJobRequirementStatsPort,
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

    // 3) 最近自我探索（仅作 hint，不参与签名门禁 / 配额 / 校验；
    //    服务端按本人 endUserId 读取，匿名 parse 不强制要求，仅尝试按 accessTokenHash 匹配）。
    //    §1.7: 只读 dimensions,LLM 上轮拒答 summary 不注入下游(防跨轮污染)。
    const selfAssessmentDims = await this.loadSelfAssessmentDimensions(parse)
    const selfAssessmentCtx: { dimensions: Array<{ key: string; label: string; strength: number }> } | null =
      selfAssessmentDims.length > 0 ? { dimensions: [...selfAssessmentDims] } : null

    // A-6 成本可见性：本能力此前完全不落 AiServiceLog，Admin 看不到调用量与成本。
    // 用量按重试累计；成功/失败都落一条（失败也真实花钱）。
    const usage = new AiUsageAccumulator()
    const startedAt = Date.now()
    let payload: CareerPlanPayload
    try {
      payload = await this.llm.build({ resumeText, jobFit: jobFitCtx, interview: interviewCtx, selfAssessment: selfAssessmentCtx, onLlmCall: usage.add })
    } catch (error) {
      this.recordAiLog(taskId, usage, startedAt, 'failed', parse.endUserId, aiErrorCodeOf(error, 'AI_CAREER_PLAN_FAILED'))
      throw error
    }
    this.recordAiLog(taskId, usage, startedAt, 'success', parse.endUserId)
    const stored: StoredCareerPlan = {
      payload,
      basedOn: {
        resume: true,
        jobFit: jobFitCtx?.jobTitle ?? null,
        interview: interviewCtx?.position ?? null,
        selfAssessment: selfAssessmentCtx?.dimensions.length ? 'self_assessment' : null,
      },
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

  /**
   * 打印版建议单：服务端真实 PDF → FileObject（我的文档）→ 既有打印链路（打印订单）。
   *
   * 两套版式，按「是否有已落库的 AI plan」二选一：
   *
   *   有 plan  → `variant:'ai'`，走原来的 AI 版式，行为与本次改动前**逐字一致**。
   *   无 plan  → `variant:'degraded'`，走降级版式（未含 AI 规划），内容只有
   *              用户自己填的记分（E1）+ 通用自检项 + 岗位要求计数（E2）。
   *
   * 为什么不再抛 CAREER_PLAN_NOT_FOUND：
   *   AI 挂掉时页面按降级规则①照常展示通用自检项与岗位要求计数，但这里一抛错，
   *   用户在一台**打印终端**上一张纸也拿不走 —— 降级路径只做了一半。
   *   降级态本身不是错误状态，不该用 404 表达。
   */
  async printPlan(taskId: string, requester: CareerPlanRequester) {
    const parse = await this.loadAuthorizedParse(taskId, requester)
    const row = await this.prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'career_plan' } } })
    const hasPlan = !!row && !!row.expiresAt && row.expiresAt.getTime() >= Date.now()

    const rendered = hasPlan
      ? await this.renderAiPlanPdf(row!)
      : await this.renderDegradedPdf(parse, row ? 'expired' : 'never_generated')

    const uploaded = await this.files.upload({
      buffer: rendered.buffer,
      filename: rendered.filename,
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
      // variant 让审计能区分「用户拿走的是 AI 版还是降级版」——两张纸内容完全不同。
      payload: { fileId: uploaded.fileId, pageCount: rendered.pageCount, variant: rendered.variant },
      ipAddress: null, userAgent: null, requestId: null,
    })
    return {
      fileId: uploaded.fileId,
      filename: uploaded.filename,
      sizeBytes: uploaded.sizeBytes,
      pageCount: rendered.pageCount,
      signedUrl: uploaded.signedUrl,
      expiresAt: uploaded.signedUrlExpiresAt,
      printFileUrl: signFileUrl(uploaded.fileId).url,
      /** 新增只读字段（加字段不改既有字段语义）：前端据此如实提示用户这次拿到的是哪一版。 */
      variant: rendered.variant,
    }
  }

  /** AI 版式。逻辑与改动前一致，只是抽成方法。 */
  private async renderAiPlanPdf(row: { payloadJson: string; updatedAt: Date }) {
    const stored = JSON.parse(row.payloadJson) as StoredCareerPlan
    const { buffer, pageCount } = await this.pdf.render(
      { date: new Date(row.updatedAt).toISOString().slice(0, 10), basedOn: stored.basedOn },
      stored.payload,
    )
    return { buffer, pageCount, filename: `职业规划建议单.pdf`, variant: 'ai' as const }
  }

  /**
   * 降级版式。内容只允许来自「不经过模型」的三个来源，任何一项拿不到就如实说没有。
   *
   * `why` 只描述本机可观测的真实状态，不猜 AI 为什么挂：
   *   never_generated 这个任务从没成功生成过规划
   *   expired         生成过，但已按 TTL 到期清理
   */
  private async renderDegradedPdf(
    parse: { endUserId: string | null; accessTokenHash: string | null },
    why: 'never_generated' | 'expired',
  ) {
    const content: DegradedCareerPlanContent = {
      date: new Date().toISOString().slice(0, 10),
      reason: {
        text: why === 'expired'
          ? '此前生成的 AI 规划建议已按隐私留存策略到期清理，本次没有可打印的 AI 内容。'
          : '本次没有可用的 AI 规划建议（本任务尚未成功生成过）。',
      },
      selfAssessment: await this.loadSelfAssessmentDimensions(parse),
      jobRequirementStats: await this.loadJobRequirementStats(),
    }
    const { buffer, pageCount } = await this.degradedPdf.render(content)
    return { buffer, pageCount, filename: DEGRADED_PDF_FILENAME, variant: 'degraded' as const }
  }

  /**
   * 岗位要求计数（E2）。端口没注册（PR #636 未合入）或读取失败时返回 null，
   * 由版式如实印「本次未取到」—— 绝不因为这一节拿不到就让整张纸印不出来。
   */
  private async loadJobRequirementStats(): Promise<DegradedJobRequirementStats | null> {
    if (!this.jobRequirementStats) return null
    try {
      const { data } = await this.jobRequirementStats.getStats({})
      return data
    } catch {
      return null
    }
  }

  /**
   * 自我探索的**确定性记分**（E1）。
   *
   * 只读 key / label / strength：`scoreSelfAssessment` 是固定权重累加的纯函数，不经过模型。
   * 刻意不读 `note` / `summary` —— 那两个字段由 LLM 生成，把它们印进一份自称
   * 「未含 AI 规划」的纸里会让这张纸的自我标识失真。
   * （§1.7 同款口径：LLM 上轮拒答的 summary 也不注入下游。）
   *
   * 撤回（withdraw）会把 dimensions 物理清空，因此撤回后这里自然返回 []。
   */
  private async loadSelfAssessmentDimensions(
    parse: { endUserId: string | null; accessTokenHash: string | null },
  ): Promise<DegradedSelfAssessmentDimension[]> {
    const where = parse.endUserId
      ? { endUserId: parse.endUserId, kind: 'self_assessment' as const, expiresAt: { gt: new Date() } }
      : { accessTokenHash: parse.accessTokenHash, kind: 'self_assessment' as const, expiresAt: { gt: new Date() } }
    const row = await this.prisma.aiResumeResult.findFirst({ where, orderBy: { createdAt: 'desc' } })
    if (!row) return []
    try {
      // self-assessment payloadJson 顶层就是 dimensions/summary(StoredSelfAssessment),
      // 不是 { payload: { ... } }。配套 §1.7 修复:沿用正确 schema 仅读 dimensions。
      const stored = JSON.parse(row.payloadJson) as {
        dimensions?: Array<{ key: string; label: string; strength: number }>
      }
      return (stored.dimensions ?? [])
        .map((d) => ({ key: String(d.key ?? ''), label: String(d.label ?? ''), strength: Number(d.strength ?? 0) }))
        .filter((d) => d.key && d.label)
    } catch {
      return [] // 损坏行按无上下文处理
    }
  }

  /**
   * A-6：落 AiServiceLog（仅元数据）。
   *
   * 一次都没打到模型（如 AI_NOT_CONFIGURED 直接抛错）时不落，避免把配置缺失
   * 记成"AI 调用失败"污染失败率告警。
   */
  private recordAiLog(
    taskId: string,
    usage: AiUsageAccumulator,
    startedAt: number,
    status: 'success' | 'failed',
    endUserId: string | null,
    errorCode?: string,
  ): void {
    if (usage.callCount === 0) return
    this.aiLog.record({
      taskId,
      operation: 'careerPlan',
      provider: usage.provider ?? 'llm',
      status,
      latencyMs: Math.max(0, Date.now() - startedAt),
      tokenUsage: usage.tokenUsage,
      errorCode,
      endUserId,
      terminalId: null,
    })
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
