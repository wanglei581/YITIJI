import { Injectable, NotFoundException } from '@nestjs/common'
import { createHash, timingSafeEqual } from 'crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditService } from '../../audit/audit.service'
import { FilesService } from '../../files/files.service'
import { ResumeExtractionService } from './resume-extraction.service'
import { FairVisitPlanPdfService } from './fair-visit-plan-pdf.service'
import { LlmFairVisitPlanService, type FairVisitPlanContext, type FairVisitPlanPayload } from './llm-fair-visit-plan.service'

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

    const payload = await this.llm.build({ resumeText, ...fairContext })
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
    return this.toResponse(taskId, stored)
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
    return this.toResponse(taskId, stored)
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
    }
  }

  private buildStored(
    ctx: Omit<FairVisitPlanContext, 'resumeText'>,
    payload: FairVisitPlanPayload,
  ): StoredFairVisitPlan {
    const positionCount = ctx.fairCompanies.reduce((sum, company) => sum + company.positions.length, 0)
    return {
      fair: ctx.fair,
      payload,
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

  private toResponse(taskId: string, stored: StoredFairVisitPlan) {
    return {
      taskId,
      status: 'completed' as const,
      basedOn: stored.basedOn,
      fair: stored.fair,
      ...stored.payload,
      providerName: stored.providerName,
    }
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
