import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { PrismaService } from '../prisma/prisma.service'
import { findJobMaterialTemplate, JOB_MATERIAL_TEMPLATES, listPublishedJobMaterialTemplates } from './job-material-templates'
import { JobMaterialPdfService } from './job-material-pdf.service'
import type {
  GenerateJobMaterialInput,
  JobMaterialAdminSummaryView,
  JobMaterialGenerateView,
  JobMaterialTemplateView,
} from './job-materials.types'

const GENERATED_BY = 'job_material_generate'

@Injectable()
export class JobMaterialsService {
  constructor(
    private readonly files: FilesService,
    private readonly pdf: JobMaterialPdfService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listTemplates(): JobMaterialTemplateView[] {
    return listPublishedJobMaterialTemplates()
  }

  async generate(
    input: GenerateJobMaterialInput,
    ctx: { endUserId: string; ipAddress?: string | null; userAgent?: string | null; requestId?: string | null },
  ): Promise<JobMaterialGenerateView> {
    const template = findJobMaterialTemplate(input.templateId)
    if (!template || template.status !== 'published') {
      throw new NotFoundException({ error: { code: 'JOB_MATERIAL_TEMPLATE_NOT_FOUND', message: '求职材料模板不存在或未发布' } })
    }
    if (template.type === 'resume_template') {
      throw new BadRequestException({ error: { code: 'JOB_MATERIAL_TEMPLATE_UNSUPPORTED', message: '简历模板请先进入简历诊断或优化链路' } })
    }

    const normalized = normalizeInput(input)
    const rendered = await this.pdf.render(template, normalized)
    const uploaded = await this.files.upload({
      buffer: rendered.buffer,
      filename: safePdfFilename(template.outputFilename),
      mimeType: 'application/pdf',
      purpose: 'cover_letter',
      sensitiveLevel: 'sensitive',
      uploaderId: null,
      endUserId: ctx.endUserId,
      assetCategory: 'derived',
      sourceFileId: null,
      actorRole: null,
      actorOrgId: null,
      createdBy: GENERATED_BY,
    })

    await this.audit.write({
      actorId: null,
      actorRole: 'enduser',
      action: 'job_material.generate',
      targetType: 'file_object',
      targetId: uploaded.fileId,
      payload: {
        endUserId: ctx.endUserId,
        templateId: template.id,
        documentType: template.type,
        fileId: uploaded.fileId,
        pageCount: rendered.pageCount,
      },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
    })

    return {
      templateId: template.id,
      templateTitle: template.title,
      documentType: template.type,
      fileId: uploaded.fileId,
      filename: uploaded.filename,
      mimeType: 'application/pdf',
      sizeBytes: uploaded.sizeBytes,
      pageCount: rendered.pageCount,
      signedUrl: uploaded.signedUrl,
      signedUrlExpiresAt: uploaded.signedUrlExpiresAt,
      fileExpiresAt: uploaded.fileExpiresAt,
      previewUrlPath: `/files/${uploaded.fileId}/preview-url`,
      downloadUrlPath: `/files/${uploaded.fileId}/download-url`,
    }
  }

  async adminSummary(now = new Date()): Promise<JobMaterialAdminSummaryView> {
    const { buckets: dayBuckets, startAt: oldestDate } = buildLast7DayBuckets(now)
    const [generatedFileCount, activeGeneratedFileCount, recentRows, generatedByTemplate] = await Promise.all([
      this.prisma.fileObject.count({
        where: { createdBy: GENERATED_BY, purpose: 'cover_letter' },
      }),
      this.prisma.fileObject.count({
        where: { createdBy: GENERATED_BY, purpose: 'cover_letter', status: 'active', deletedAt: null },
      }),
      this.prisma.fileObject.findMany({
        where: { createdBy: GENERATED_BY, purpose: 'cover_letter', createdAt: { gte: oldestDate } },
        select: { createdAt: true },
      }),
      this.countGeneratedByTemplate(),
    ])

    for (const row of recentRows) {
      const key = toLocalDateKey(row.createdAt)
      if (dayBuckets.has(key)) dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + 1)
    }

    return {
      templateCount: JOB_MATERIAL_TEMPLATES.length,
      publishedTemplateCount: listPublishedJobMaterialTemplates().length,
      generatedFileCount,
      activeGeneratedFileCount,
      last7DaysGenerated: [...dayBuckets.entries()].map(([date, count]) => ({ date, count })),
      templates: JOB_MATERIAL_TEMPLATES.map((template) => ({
        id: template.id,
        type: template.type,
        title: template.title,
        status: template.status,
        generatedCount: generatedByTemplate.get(template.id) ?? 0,
      })),
    }
  }

  private async countGeneratedByTemplate(): Promise<Map<string, number>> {
    const entries = await Promise.all(
      JOB_MATERIAL_TEMPLATES.map(async (template) => {
        const count = await this.prisma.auditLog.count({
          where: { action: 'job_material.generate', payloadJson: { contains: `"templateId":"${template.id}"` } },
        })
        return [template.id, count] as const
      }),
    )
    return new Map(entries)
  }
}

function normalizeInput(input: GenerateJobMaterialInput): GenerateJobMaterialInput {
  return {
    templateId: input.templateId.trim(),
    applicantName: input.applicantName.trim(),
    targetRole: input.targetRole.trim(),
    targetOrganization: trimOptional(input.targetOrganization),
    keyStrengths: trimOptional(input.keyStrengths),
    notes: trimOptional(input.notes),
  }
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function safePdfFilename(filename: string): string {
  const trimmed = filename.trim().replace(/[\\/:*?"<>|]/g, '-')
  return trimmed.toLowerCase().endsWith('.pdf') ? trimmed : `${trimmed || '求职材料'}.pdf`
}

function buildLast7DayBuckets(now: Date): { buckets: Map<string, number>; startAt: Date } {
  const buckets = new Map<string, number>()
  let startAt = startOfLocalDay(now)
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = localDayWithOffset(now, -offset)
    if (offset === 6) startAt = date
    buckets.set(toLocalDateKey(date), 0)
  }
  return { buckets, startAt }
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function localDayWithOffset(date: Date, offsetDays: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays)
}

function toLocalDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
