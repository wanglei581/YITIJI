import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { signFileUrl } from '../files/signing'
import { PrismaService } from '../prisma/prisma.service'
import { Prisma } from '../generated/prisma/client'
import { JOB_MATERIAL_TEMPLATES } from './job-material-templates'
import { JobMaterialPdfService } from './job-material-pdf.service'
import type {
  GenerateJobMaterialInput,
  JobMaterialAdminSummaryView,
  JobMaterialGenerateView,
  JobMaterialTemplateAdminView,
  JobMaterialTemplateAdminWriteInput,
  JobMaterialTemplateField,
  JobMaterialTemplateStatus,
  JobMaterialTemplateType,
  JobMaterialTemplateView,
  ResumeTemplateLayoutPreset,
} from './job-materials.types'

const GENERATED_BY = 'job_material_generate'

/** 与 JobMaterialTemplateStatus 口径一致：published=已发布，disabled=未发布/已下架。 */
const PUBLISHED: JobMaterialTemplateStatus = 'published'
const DISABLED: JobMaterialTemplateStatus = 'disabled'

const TEMPLATE_ID_PREFIX = 'jmt_'

/** prisma Json 列的数据库行形状（运行时 JSON 已被驱动解码为 JS 值）。 */
interface JobMaterialTemplateRow {
  id: string
  type: string
  title: string
  description: string
  tags: Prisma.JsonValue
  status: string
  recommendedFor: string
  outputFilename: string
  fields: Prisma.JsonValue
  resumeLayoutPreset: Prisma.JsonValue | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  updatedByUserId: string | null
}

@Injectable()
export class JobMaterialsService {
  /** 空库种子只跑一次；失败允许重试，成功后本进程不再重复 count。 */
  private seedTask: Promise<void> | null = null

  constructor(
    private readonly files: FilesService,
    private readonly pdf: JobMaterialPdfService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService
  ) {}

  /**
   * 模板以库为准：库为空时用 JOB_MATERIAL_TEMPLATES 常量按 id 幂等 upsert 种子化一次；
   * 之后所有读走库，重启不覆盖运营在后台做的编辑 / 发布状态（count>0 即跳过种子）。
   */
  private ensureSeeded(): Promise<void> {
    if (!this.seedTask) {
      this.seedTask = this.seedTemplatesIfEmpty().catch((error: unknown) => {
        this.seedTask = null
        throw error
      })
    }
    return this.seedTask
  }

  private async seedTemplatesIfEmpty(): Promise<void> {
    const existing = await this.prisma.jobMaterialTemplate.count()
    if (existing > 0) return
    for (const [index, template] of JOB_MATERIAL_TEMPLATES.entries()) {
      await this.prisma.jobMaterialTemplate.upsert({
        where: { id: template.id },
        update: {},
        create: {
          id: template.id,
          type: template.type,
          title: template.title,
          description: template.description,
          tags: template.tags,
          status: template.status,
          recommendedFor: template.recommendedFor,
          outputFilename: template.outputFilename,
          fields: toJsonValue(template.fields),
          ...(template.resumeLayoutPreset
            ? { resumeLayoutPreset: toJsonValue(template.resumeLayoutPreset) }
            : {}),
          sortOrder: index,
          updatedByUserId: null,
        },
      })
    }
  }

  async listTemplates(): Promise<JobMaterialTemplateView[]> {
    await this.ensureSeeded()
    const rows = await this.prisma.jobMaterialTemplate.findMany({
      where: { status: PUBLISHED },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    return rows.map(mapTemplateView)
  }

  /** 管理员列表：含未发布 / 已下架，按 sortOrder 稳定排序。 */
  async adminListTemplates(): Promise<JobMaterialTemplateAdminView[]> {
    await this.ensureSeeded()
    const rows = await this.prisma.jobMaterialTemplate.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    })
    return rows.map(mapTemplateAdminView)
  }

  async adminCreateTemplate(
    input: JobMaterialTemplateAdminWriteInput,
    actorUserId: string
  ): Promise<JobMaterialTemplateAdminView> {
    await this.ensureSeeded()
    assertResumePreset(input.type, input.resumeLayoutPreset)
    const row = await this.prisma.jobMaterialTemplate.create({
      data: {
        id: `${TEMPLATE_ID_PREFIX}${randomUUID().replace(/-/g, '')}`,
        type: input.type,
        title: input.title,
        description: input.description,
        tags: input.tags,
        status: DISABLED,
        recommendedFor: input.recommendedFor,
        outputFilename: input.outputFilename,
        fields: toJsonValue(input.fields),
        ...(input.resumeLayoutPreset
          ? { resumeLayoutPreset: toJsonValue(input.resumeLayoutPreset) }
          : {}),
        sortOrder: input.sortOrder,
        updatedByUserId: actorUserId,
      },
    })
    await this.writeTemplateAudit(actorUserId, 'job_material.template.create', row, {
      action: 'create',
    })
    return mapTemplateAdminView(row)
  }

  async adminUpdateTemplate(
    id: string,
    patch: Partial<JobMaterialTemplateAdminWriteInput>,
    actorUserId: string
  ): Promise<JobMaterialTemplateAdminView> {
    await this.ensureSeeded()
    const existing = await this.prisma.jobMaterialTemplate.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException({
        error: { code: 'JOB_MATERIAL_TEMPLATE_NOT_FOUND', message: '求职材料模板不存在' },
      })
    }

    const nextType = patch.type ?? (existing.type as JobMaterialTemplateType)
    const presetProvided = patch.resumeLayoutPreset !== undefined
    const nextPreset = presetProvided
      ? patch.resumeLayoutPreset
      : (existing.resumeLayoutPreset as ResumeTemplateLayoutPreset | null)
    assertResumePreset(nextType, nextPreset)

    const row = await this.prisma.jobMaterialTemplate.update({
      where: { id },
      data: {
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(patch.recommendedFor !== undefined ? { recommendedFor: patch.recommendedFor } : {}),
        ...(patch.outputFilename !== undefined ? { outputFilename: patch.outputFilename } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        ...(patch.fields !== undefined ? { fields: toJsonValue(patch.fields) } : {}),
        // type 最终不是 resume_template 时清空版式预置，避免脏数据残留。
        ...(nextType === 'resume_template'
          ? presetProvided && patch.resumeLayoutPreset
            ? { resumeLayoutPreset: toJsonValue(patch.resumeLayoutPreset) }
            : {}
          : { resumeLayoutPreset: Prisma.DbNull }),
        updatedByUserId: actorUserId,
      },
    })
    await this.writeTemplateAudit(actorUserId, 'job_material.template.update', row, {
      action: 'update',
    })
    return mapTemplateAdminView(row)
  }

  async adminSetTemplatePublish(
    id: string,
    action: 'publish' | 'unpublish',
    actorUserId: string
  ): Promise<JobMaterialTemplateAdminView> {
    await this.ensureSeeded()
    const existing = await this.prisma.jobMaterialTemplate.findUnique({ where: { id } })
    if (!existing) {
      throw new NotFoundException({
        error: { code: 'JOB_MATERIAL_TEMPLATE_NOT_FOUND', message: '求职材料模板不存在' },
      })
    }
    const toStatus = action === 'publish' ? PUBLISHED : DISABLED
    const row = await this.prisma.jobMaterialTemplate.update({
      where: { id },
      data: { status: toStatus, updatedByUserId: actorUserId },
    })
    await this.writeTemplateAudit(actorUserId, 'job_material.template.publish', row, {
      action,
      fromStatus: existing.status,
      toStatus,
    })
    return mapTemplateAdminView(row)
  }

  async generate(
    input: GenerateJobMaterialInput,
    ctx: {
      endUserId: string
      ipAddress?: string | null
      userAgent?: string | null
      requestId?: string | null
    }
  ): Promise<JobMaterialGenerateView> {
    await this.ensureSeeded()
    const template = await this.findPublishedTemplate(input.templateId)
    if (!template) {
      throw new NotFoundException({
        error: { code: 'JOB_MATERIAL_TEMPLATE_NOT_FOUND', message: '求职材料模板不存在或未发布' },
      })
    }
    if (template.type === 'resume_template') {
      throw new BadRequestException({
        error: {
          code: 'JOB_MATERIAL_TEMPLATE_UNSUPPORTED',
          message: '简历模板请先进入简历诊断或优化链路',
        },
      })
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
      printFileUrl: signFileUrl(uploaded.fileId).url,
      signedUrlExpiresAt: uploaded.signedUrlExpiresAt,
      fileExpiresAt: uploaded.fileExpiresAt,
      previewUrlPath: `/files/${uploaded.fileId}/preview-url`,
      downloadUrlPath: `/files/${uploaded.fileId}/download-url`,
    }
  }

  async adminSummary(now = new Date()): Promise<JobMaterialAdminSummaryView> {
    await this.ensureSeeded()
    const { buckets: dayBuckets, startAt: oldestDate } = buildLast7DayBuckets(now)
    const [templateRows, generatedFileCount, activeGeneratedFileCount, recentRows] =
      await Promise.all([
        this.prisma.jobMaterialTemplate.findMany({
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        this.prisma.fileObject.count({
          where: { createdBy: GENERATED_BY, purpose: 'cover_letter' },
        }),
        this.prisma.fileObject.count({
          where: {
            createdBy: GENERATED_BY,
            purpose: 'cover_letter',
            status: 'active',
            deletedAt: null,
          },
        }),
        this.prisma.fileObject.findMany({
          where: {
            createdBy: GENERATED_BY,
            purpose: 'cover_letter',
            createdAt: { gte: oldestDate },
          },
          select: { createdAt: true },
        }),
      ])
    const generatedByTemplate = await this.countGeneratedByTemplate(templateRows)

    for (const row of recentRows) {
      const key = toLocalDateKey(row.createdAt)
      if (dayBuckets.has(key)) dayBuckets.set(key, (dayBuckets.get(key) ?? 0) + 1)
    }

    return {
      templateCount: templateRows.length,
      publishedTemplateCount: templateRows.filter((template) => template.status === PUBLISHED)
        .length,
      generatedFileCount,
      activeGeneratedFileCount,
      last7DaysGenerated: [...dayBuckets.entries()].map(([date, count]) => ({ date, count })),
      templates: templateRows.map((template) => ({
        id: template.id,
        type: template.type as JobMaterialTemplateType,
        title: template.title,
        status: template.status as JobMaterialTemplateStatus,
        generatedCount: generatedByTemplate.get(template.id) ?? 0,
      })),
    }
  }

  private async findPublishedTemplate(id: string): Promise<JobMaterialTemplateView | null> {
    const row = await this.prisma.jobMaterialTemplate.findUnique({ where: { id } })
    if (!row || row.status !== PUBLISHED) return null
    return mapTemplateView(row)
  }

  private async countGeneratedByTemplate(
    templateRows: JobMaterialTemplateRow[]
  ): Promise<Map<string, number>> {
    const entries = await Promise.all(
      templateRows.map(async (template) => {
        const count = await this.prisma.auditLog.count({
          where: {
            action: 'job_material.generate',
            payloadJson: { contains: `"templateId":"${template.id}"` },
          },
        })
        return [template.id, count] as const
      })
    )
    return new Map(entries)
  }

  private async writeTemplateAudit(
    actorUserId: string,
    action: string,
    row: JobMaterialTemplateRow,
    extra: Record<string, unknown>
  ): Promise<void> {
    await this.audit.write({
      actorId: actorUserId,
      actorRole: 'admin',
      action,
      targetType: 'job_material_template',
      targetId: row.id,
      payload: {
        templateId: row.id,
        type: row.type,
        title: row.title,
        status: row.status,
        ...extra,
      },
    })
  }
}

/** resume_template 必须带版式预置（与种子常量口径一致）；其余类型不得携带。 */
function assertResumePreset(
  type: JobMaterialTemplateType,
  preset: ResumeTemplateLayoutPreset | null | undefined
): void {
  if (type === 'resume_template' && !preset) {
    throw new BadRequestException({
      error: {
        code: 'JOB_MATERIAL_TEMPLATE_RESUME_PRESET_REQUIRED',
        message: '简历模板必须提供 resumeLayoutPreset（版式预置）',
      },
    })
  }
}

/** 结构化 JSON 值写 prisma Json 列（interface 无隐式索引签名，需经此处收敛）。 */
function toJsonValue<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue
}

function mapTemplateView(row: JobMaterialTemplateRow): JobMaterialTemplateView {
  return {
    id: row.id,
    type: row.type as JobMaterialTemplateType,
    title: row.title,
    description: row.description,
    tags: asStringArray(row.tags),
    status: row.status as JobMaterialTemplateStatus,
    recommendedFor: row.recommendedFor,
    outputFilename: row.outputFilename,
    fields: asFields(row.fields),
    resumeLayoutPreset: row.resumeLayoutPreset ? asPreset(row.resumeLayoutPreset) : undefined,
  }
}

function mapTemplateAdminView(row: JobMaterialTemplateRow): JobMaterialTemplateAdminView {
  return {
    ...mapTemplateView(row),
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    updatedByUserId: row.updatedByUserId,
  }
}

function asStringArray(value: Prisma.JsonValue): string[] {
  return Array.isArray(value) ? (value as unknown as string[]) : []
}

function asFields(value: Prisma.JsonValue): JobMaterialTemplateField[] {
  return Array.isArray(value) ? (value as unknown as JobMaterialTemplateField[]) : []
}

function asPreset(value: Prisma.JsonValue): ResumeTemplateLayoutPreset {
  return value as unknown as ResumeTemplateLayoutPreset
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
