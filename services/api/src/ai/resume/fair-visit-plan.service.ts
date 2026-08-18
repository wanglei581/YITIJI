import { Injectable, NotFoundException } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { FilesService } from '../../files/files.service'
import { signFileUrl } from '../../files/signing'
import { ResumeExtractionService } from './resume-extraction.service'
import { FairVisitPlanPdfService } from './fair-visit-plan-pdf.service'
import { LlmFairVisitPlanService, type FairVisitPlanContext, type FairVisitPlanMode, type FairVisitPlanPayload } from './llm-fair-visit-plan.service'
import { AiLogService, AiUsageAccumulator, aiErrorCodeOf } from '../ai-log.service'

const RESULT_TTL_HOURS = (() => {
  const raw = Number(process.env['AI_RESUME_RESULT_TTL_HOURS'])
  return Number.isFinite(raw) && raw > 0 ? raw : 24
})()

export interface FairVisitPlanRequester {
  endUserId: string | null
  accessToken: string | null
}

interface StoredFairVisitPlan {
  fair: FairVisitPlanContext['fair']
  payload: FairVisitPlanPayload
  providerName: string
  basedOn: { resume: true; fairId: string; fairName: string; companyCount: number; positionCount: number }
}

/**
 * 招聘会结束与否决定这条链产出什么。判定只看 endAt，与 deriveFairStatus 同构。
 * 单独抽出来是因为**读取路径也要用**：活动结束前生成的准备单，
 * 一周后拿旧链接 / 旧二维码回来读或打印时必须按「现在」重新判定。
 */
export function resolveFairVisitMode(endAt: Date | string, now = new Date()): FairVisitPlanMode {
  const end = endAt instanceof Date ? endAt : new Date(endAt)
  return Number.isFinite(end.getTime()) && end.getTime() < now.getTime() ? 'review' : 'preparation'
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

function companyIndustry(value: string | null): string | null {
  return value && value.trim() ? value.trim() : null
}

@Injectable()
export class FairVisitPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmFairVisitPlanService,
    private readonly extraction: ResumeExtractionService,
    private readonly files: FilesService,
    private readonly pdf: FairVisitPlanPdfService,
    private readonly audit: AuditService,
    private readonly aiLog: AiLogService,
  ) {}

  async generate(fairId: string, taskId: string, requester: FairVisitPlanRequester) {
    const parse = await this.loadAuthorizedParse(taskId, requester)
    const fairContext = await this.loadFairContext(fairId)

    let resumeText: string | undefined
    if (parse.fileId) {
      const extraction = await this.extraction.extractResumeText({ fileId: parse.fileId, endUserId: parse.endUserId })
      if (extraction.ok) resumeText = extraction.text
    }
    if (!resumeText) {
      return {
        taskId,
        status: 'failed' as const,
        failReason: '简历原文已按隐私策略自动清理，请重新上传简历后再生成参会准备单',
      }
    }

    // A-6 成本可见性：本能力此前完全不落 AiServiceLog，Admin 看不到调用量与成本。
    // 用量按重试累计；成功/失败都落一条（失败也真实花钱）。
    const usage = new AiUsageAccumulator()
    const startedAt = Date.now()
    let payload: FairVisitPlanPayload
    try {
      payload = await this.llm.build({ resumeText, ...fairContext, onLlmCall: usage.add })
    } catch (error) {
      this.recordAiLog(taskId, usage, startedAt, 'failed', parse.endUserId, aiErrorCodeOf(error, 'AI_FAIR_VISIT_PLAN_FAILED'))
      throw error
    }
    this.recordAiLog(taskId, usage, startedAt, 'success', parse.endUserId)
    const stored = this.buildStored(fairContext, payload)
    const expiresAt = new Date(Date.now() + RESULT_TTL_HOURS * 60 * 60 * 1000)
    await this.prisma.aiResumeResult.upsert({
      where: { taskId_kind: { taskId, kind: 'fair_visit_plan' } },
      update: { status: 'completed', payloadJson: JSON.stringify(stored), expiresAt },
      create: {
        taskId,
        kind: 'fair_visit_plan',
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
      action: 'fair.visit_plan',
      targetType: 'ai_task',
      targetId: taskId,
      payload: {
        fairId,
        companyCount: stored.basedOn.companyCount,
        positionCount: stored.basedOn.positionCount,
        hasEndUser: !!parse.endUserId,
      },
      ipAddress: null,
      userAgent: null,
      requestId: null,
    })
    return this.toResponse(
      taskId,
      stored,
      stored.payload.mode === 'review' ? await this.loadLocalRecords(fairId, parse.endUserId) : undefined,
    )
  }

  async getLatest(fairId: string, taskId: string, requester: FairVisitPlanRequester) {
    await this.loadAuthorizedParse(taskId, requester)
    const row = await this.prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'fair_visit_plan' } } })
    if (!row || !row.expiresAt || row.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException({ error: { code: 'FAIR_VISIT_PLAN_NOT_FOUND', message: '暂无参会准备单，请先生成' } })
    }
    const stored = JSON.parse(row.payloadJson) as StoredFairVisitPlan
    if (stored.basedOn.fairId !== fairId) {
      throw new NotFoundException({ error: { code: 'FAIR_VISIT_PLAN_NOT_FOUND', message: '暂无该招聘会的参会准备单' } })
    }
    this.assertModeStillValid(stored)
    return this.toResponse(
      taskId,
      stored,
      stored.payload.mode === 'review' ? await this.loadLocalRecords(fairId, requester.endUserId) : undefined,
    )
  }

  async printPlan(fairId: string, taskId: string, requester: FairVisitPlanRequester) {
    const parse = await this.loadAuthorizedParse(taskId, requester)
    const row = await this.prisma.aiResumeResult.findUnique({ where: { taskId_kind: { taskId, kind: 'fair_visit_plan' } } })
    if (!row || !row.expiresAt || row.expiresAt.getTime() < Date.now()) {
      throw new NotFoundException({ error: { code: 'FAIR_VISIT_PLAN_NOT_FOUND', message: '暂无参会准备单，请先生成' } })
    }
    const stored = JSON.parse(row.payloadJson) as StoredFairVisitPlan
    if (stored.basedOn.fairId !== fairId) {
      throw new NotFoundException({ error: { code: 'FAIR_VISIT_PLAN_NOT_FOUND', message: '暂无该招聘会的参会准备单' } })
    }
    // 纸是带走的：过期形态必须在**抵达渲染器之前**就被拒，不能靠后面的环节意外报错。
    this.assertModeStillValid(stored)
    const { buffer, pageCount } = await this.pdf.render(
      {
        date: new Date(row.updatedAt).toISOString().slice(0, 10),
        fairName: stored.fair.title,
        sourceName: stored.fair.sourceName,
        venue: stored.fair.venue,
        sourceUrl: stored.fair.sourceUrl,
      },
      stored.payload,
    )
    const uploaded = await this.files.upload({
      buffer,
      filename: `招聘会参会准备单.pdf`,
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      uploaderId: null,
      endUserId: parse.endUserId,
      createdBy: 'fair_visit_plan',
    })
    await this.audit.write({
      actorId: null,
      actorRole: parse.endUserId ? 'enduser' : 'kiosk',
      action: 'fair.visit_plan_print',
      targetType: 'ai_task',
      targetId: taskId,
      payload: { fairId, fileId: uploaded.fileId, pageCount },
      ipAddress: null,
      userAgent: null,
      requestId: null,
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

  /**
   * 存量结果的形态必须与「现在」的活动状态一致。
   *
   * 覆盖两条真实路径：直接敲 URL / 收藏里的旧链接（getLatest），
   * 以及活动结束前生成、结束后才去打印的旧二维码（printPlan）。
   * 只改前端守卫挡不住这两条，所以判定放在服务端且**先于**任何渲染。
   */
  private assertModeStillValid(stored: StoredFairVisitPlan): void {
    const currentMode = resolveFairVisitMode(stored.fair.endAt)
    // 旧结果没有 mode 字段的，按其形态推断（历史数据一律是 preparation）。
    const storedMode = stored.payload.mode ?? 'preparation'
    if (storedMode === currentMode) return
    throw new NotFoundException({
      error: {
        code: 'FAIR_VISIT_PLAN_STALE_MODE',
        message:
          currentMode === 'review'
            ? '该招聘会已结束，此前生成的参会准备单不再适用，请重新生成参会回顾'
            : '该招聘会状态已变化，请重新生成',
      },
    })
  }

  /**
   * A-6：落 AiServiceLog（仅元数据）。
   * 一次都没打到模型（如 AI_NOT_CONFIGURED 直接抛错）时不落，避免污染失败率告警。
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
      operation: 'fairVisitPlan',
      provider: usage.provider ?? 'llm',
      status,
      latencyMs: Math.max(0, Date.now() - startedAt),
      tokenUsage: usage.tokenUsage,
      errorCode,
      endUserId,
      terminalId: null,
    })
  }

  private buildStored(
    ctx: Omit<FairVisitPlanContext, 'resumeText'>,
    payload: FairVisitPlanPayload,
  ): StoredFairVisitPlan {
    const positionCount = ctx.fairCompanies.reduce((sum, company) => sum + company.positions.length, 0)
    return {
      fair: ctx.fair,
      // mode 是服务端按 endAt 判定的事实，不采信模型回传值：
      // 形态决定了纸上印什么、以及存量结果日后还能不能被读出，
      // 不能让模型（或任何桩）有机会左右它。
      payload: { ...payload, mode: ctx.mode } as FairVisitPlanPayload,
      providerName: 'llm',
      basedOn: {
        resume: true,
        fairId: ctx.fair.id,
        fairName: ctx.fair.title,
        companyCount: ctx.fairCompanies.length,
        positionCount,
      },
    }
  }

  private toResponse(
    taskId: string,
    stored: StoredFairVisitPlan,
    localRecords?: { openedCompanySourceEntries: string[]; requiresLogin: boolean },
  ) {
    return {
      taskId,
      status: 'completed' as const,
      basedOn: stored.basedOn,
      fair: stored.fair,
      ...stored.payload,
      ...(localRecords ? { localRecords } : {}),
      providerName: stored.providerName,
    }
  }

  /**
   * 回顾态的「本机记录」事实区。**不经过 LLM**，也**绝不并进 LLM 上下文**。
   *
   * 只取一类信号：本人在本机打开过来源投递入口的参展企业（fair_company +
   * external_apply，其 externalId 存的就是所属招聘会 id）。
   * 刻意不取「打开过签到入口」——那既不代表到场（compliance-boundary §4.4
   * 明确不记录签到入场状态），又最容易被读成「你去过」。
   */
  private async loadLocalRecords(
    fairId: string,
    endUserId: string | null,
  ): Promise<{ openedCompanySourceEntries: string[]; requiresLogin: boolean }> {
    if (!endUserId) return { openedCompanySourceEntries: [], requiresLogin: true }
    const rows = await this.prisma.externalJumpLog.findMany({
      where: { endUserId, targetType: 'fair_company', action: 'external_apply', externalId: fairId },
      orderBy: { createdAt: 'desc' },
      select: { targetTitle: true },
      take: 50,
    })
    const names: string[] = []
    for (const row of rows) {
      const name = row.targetTitle?.trim()
      if (name && !names.includes(name)) names.push(name)
    }
    return { openedCompanySourceEntries: names.slice(0, 12), requiresLogin: false }
  }

  private async loadFairContext(fairId: string): Promise<Omit<FairVisitPlanContext, 'resumeText'>> {
    const fair = await this.prisma.jobFair.findFirst({
      where: { id: fairId, reviewStatus: 'approved', publishStatus: 'published' },
      include: {
        companies: {
          orderBy: { jobsCount: 'desc' },
          include: { positions: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    })
    if (!fair) {
      throw new NotFoundException({ error: { code: 'FAIR_NOT_FOUND', message: '招聘会不存在或未发布' } })
    }
    return {
      // ⚠️ 只由 endAt 判定，调用方无从指定；且**不含任何到场信号**（见 FairVisitPlanContext 注释）。
      mode: resolveFairVisitMode(fair.endAt),
      fair: {
        id: fair.id,
        title: fair.title,
        sourceName: fair.sourceName,
        sourceUrl: fair.sourceUrl,
        startAt: fair.startAt.toISOString(),
        endAt: fair.endAt.toISOString(),
        venue: fair.venue,
        city: fair.city,
      },
      fairCompanies: fair.companies.map((company) => ({
        companyName: company.name,
        industry: companyIndustry(company.industry),
        sourceUrl: company.sourceUrl,
        positions: company.positions.map((position) => ({
          title: position.title,
          requirements: position.requirements,
          education: position.education,
          location: position.location,
        })),
      })),
    }
  }

  private async loadAuthorizedParse(taskId: string, requester: FairVisitPlanRequester) {
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
    } catch {
      // fileId 缺失时生成路径会诚实失败。
    }
    return { endUserId: row.endUserId, accessTokenHash: row.accessTokenHash, fileId }
  }
}
