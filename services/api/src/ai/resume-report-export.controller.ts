import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Throttle } from '@nestjs/throttler'
import { AuditService } from '../audit/audit.service'
import { resolveOptionalEndUser } from '../common/auth/optional-end-user'
import { RedisService } from '../common/redis/redis.service'
import { FilesService } from '../files/files.service'
import { signFileUrl } from '../files/signing'
import { PrismaService } from '../prisma/prisma.service'
import { AiService, type AiResultRequester } from './ai.service'
import type { OptimizeResumeOutput, ParseResumeOutput } from './interfaces/ai-provider.interface'
import {
  DiagnosisReportPdfService,
  type ResumeReportExportKind,
} from './resume/diagnosis-report-pdf.service'

interface ReqLike {
  headers: Record<string, string | string[] | undefined>
}

function headerOf(req: ReqLike, name: string): string | undefined {
  const value = req.headers[name]
  if (typeof value === 'string') return value
  return Array.isArray(value) ? value[0] : undefined
}

@Controller('resume/records')
export class ResumeReportExportController {
  constructor(
    private readonly ai: AiService,
    private readonly pdf: DiagnosisReportPdfService,
    private readonly files: FilesService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Post(':taskId/export')
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async export(
    @Param('taskId') taskId: string,
    @Body() body: { kind?: string } | undefined,
    @Req() req: ReqLike,
  ) {
    if (body?.kind !== 'diagnosis_report' && body?.kind !== 'change_list') {
      throw new BadRequestException({
        error: { code: 'AI_EXPORT_KIND_INVALID', message: '导出类型仅支持诊断报告或修改清单' },
      })
    }
    return this.exportAuthorized(taskId, body.kind as ResumeReportExportKind, await this.requesterOf(req))
  }

  private async exportAuthorized(taskId: string, kind: ResumeReportExportKind, requester: AiResultRequester) {
    const parse = await this.ai.getResumeRecord(taskId, requester)
    if (parse.status !== 'completed' || !parse.report) {
      throw new ConflictException({
        error: { code: 'AI_RESULT_NOT_READY', message: '诊断结果尚未完成，暂时无法导出' },
      })
    }

    const row = await this.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId, kind: 'parse' } },
      select: { endUserId: true, accessTokenHash: true, expiresAt: true },
    })
    if (!row || !row.expiresAt || row.expiresAt.getTime() < Date.now()) throw this.notFound()

    const optimize = await this.loadExistingOptimize(taskId, row)
    const generatedAt = new Date()
    const rendered = await this.pdf.render({
      taskId,
      kind,
      report: parse.report,
      extractionNotice: parse.extractionNotice,
      optimizeModules: optimize?.modules,
      generatedAt,
    })
    const sourceFileId = await this.resolveSourceFileId(parse, row.endUserId)
    const uploaded = await this.files.upload({
      buffer: rendered.buffer,
      filename: this.filename(kind, optimize, generatedAt),
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      sensitiveLevel: 'highly_sensitive',
      uploaderId: null,
      endUserId: row.endUserId,
      assetCategory: 'derived',
      sourceFileId,
      createdBy: 'ai_resume_diagnosis_export',
    })

    await this.audit.write({
      actorId: null,
      actorRole: row.endUserId ? 'enduser' : 'kiosk',
      action: 'resume.diagnosis_exported',
      targetType: 'file',
      targetId: uploaded.fileId,
      payload: {
        taskId,
        kind,
        pageCount: rendered.pageCount,
        sizeBytes: uploaded.sizeBytes,
        savedToDocuments: Boolean(row.endUserId),
      },
      ipAddress: null,
      userAgent: null,
      requestId: null,
    })

    return {
      fileId: uploaded.fileId,
      filename: uploaded.filename,
      mimeType: 'application/pdf' as const,
      sizeBytes: uploaded.sizeBytes,
      pageCount: rendered.pageCount,
      signedUrl: uploaded.signedUrl,
      expiresAt: uploaded.signedUrlExpiresAt,
      printFileUrl: signFileUrl(uploaded.fileId).url,
      savedToDocuments: Boolean(row.endUserId),
      aiGenerated: true as const,
    }
  }

  private async requesterOf(req: ReqLike): Promise<AiResultRequester> {
    const member = await resolveOptionalEndUser(headerOf(req, 'authorization'), this.jwt, this.redis, this.prisma)
    if (member) return { endUserId: member.endUserId, accessToken: null }
    return { endUserId: null, accessToken: headerOf(req, 'x-resume-access-token')?.trim() || null }
  }

  private async loadExistingOptimize(
    taskId: string,
    parseOwner: { endUserId: string | null; accessTokenHash: string | null },
  ): Promise<OptimizeResumeOutput | null> {
    const row = await this.prisma.aiResumeResult.findUnique({
      where: { taskId_kind: { taskId, kind: 'optimize' } },
      select: { status: true, payloadJson: true, endUserId: true, accessTokenHash: true, expiresAt: true },
    })
    if (
      !row || row.status !== 'completed' || !row.expiresAt || row.expiresAt.getTime() < Date.now() ||
      row.endUserId !== parseOwner.endUserId || row.accessTokenHash !== parseOwner.accessTokenHash
    ) return null
    try {
      return JSON.parse(row.payloadJson) as OptimizeResumeOutput
    } catch {
      return null
    }
  }

  private async resolveSourceFileId(parse: ParseResumeOutput, endUserId: string | null): Promise<string | null> {
    if (!parse.fileId) return null
    const source = await this.prisma.fileObject.findUnique({
      where: { id: parse.fileId },
      select: { id: true, endUserId: true },
    })
    if (!source || source.endUserId !== endUserId) return null
    return source.id
  }

  private filename(kind: ResumeReportExportKind, optimize: OptimizeResumeOutput | null, generatedAt: Date): string {
    const rawName = optimize?.optimizedResume?.basic.name
    const safeName = rawName?.replace(/[\\/:*?"<>|\s]/g, '').slice(0, 20)
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(generatedAt)
    const datePart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
    const suffix = safeName || `${datePart('year')}${datePart('month')}${datePart('day')}`
    return `${kind === 'diagnosis_report' ? 'AI诊断报告' : '修改清单'}_${suffix}.pdf`
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      error: { code: 'AI_TASK_NOT_FOUND', message: '任务不存在，请重新提交简历' },
    })
  }
}
