// ============================================================
// JobsExcelService — Excel 导入 / 字段映射规则端点
// N1 拆分子服务：零行为变化。
// ============================================================

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common'
import { Workbook } from 'exceljs'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { JobQualityService } from '../job-ai/job-quality.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import {
  JOB_STANDARD_FIELDS,
  JOB_REQUIRED_FIELDS,
  FAIR_STANDARD_FIELDS,
  FAIR_REQUIRED_FIELDS,
  isSensitiveColumn,
  type FieldMapping,
  type ParsedRow,
} from './dto/excel-import.dto'
import { JOB_WORK_TYPE_VALUES } from './work-type'
import {
  type ExcelPreviewDto,
  type FieldMappingRuleDto,
  buildJobTags,
  mapWorkTypeToCategory,
  normalizeMappedWorkType,
  normalizeOptionalHttpUrl,
  splitMappedList,
  parseMappedNumber,
  parseMappedDate,
  toPreviewRow,
} from './jobs-shared'

@Injectable()
export class JobsExcelService {
  private readonly logger = new Logger(JobsExcelService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jobQuality: JobQualityService,
  ) {}

  private async refreshJobQualitySnapshots(jobIds: string[]): Promise<void> {
    try {
      await this.jobQuality.refreshJobQualitySnapshots(jobIds)
    } catch (error) {
      this.logger.warn(`refresh job quality snapshots failed: ${error instanceof Error ? error.message : 'unknown'}`)
    }
  }

  private async loadExcelRows(buffer: Buffer): Promise<string[][]> {
    const wb = new Workbook()
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer)
    } catch {
      throw new BadRequestException({ error: { code: 'EXCEL_EMPTY', message: 'Excel 文件为空或格式不正确' } })
    }
    const ws = wb.getWorksheet(1)
    if (!ws) {
      throw new BadRequestException({ error: { code: 'EXCEL_EMPTY', message: 'Excel 文件为空或格式不正确' } })
    }
    const colCount = ws.columnCount
    const rows: string[][] = []
    ws.eachRow({ includeEmpty: false }, (row) => {
      rows.push(Array.from({ length: colCount }, (_, i) => row.getCell(i + 1).text))
    })
    return rows
  }

  private async writeSyncLog(args: {
    sourceId: string
    orgId: string
    dataType: 'job' | 'fair'
    syncMode: 'manual' | 'webhook' | 'api' | 'excel'
    addedCount: number
    updatedCount: number
    dupCount: number
    errorCount: number
    errorFields?: string[]
    errorDetail?: string
  }): Promise<string | null> {
    try {
      const result: 'success' | 'partial' | 'failed' =
        args.errorCount === 0 ? 'success' :
        args.addedCount > 0 || args.updatedCount > 0 ? 'partial' : 'failed'
      const log = await this.prisma.syncLog.create({
        data: {
          sourceId: args.sourceId,
          orgId: args.orgId,
          dataType: args.dataType,
          syncMode: args.syncMode,
          totalCount: args.addedCount + args.updatedCount + args.dupCount + args.errorCount,
          addedCount: args.addedCount,
          updatedCount: args.updatedCount,
          dupCount: args.dupCount,
          errorCount: args.errorCount,
          errorFields: JSON.stringify(args.errorFields ?? []),
          errorDetail: args.errorDetail ?? null,
          result,
        },
      })
      return log.id
    } catch (e) {
      this.logger.warn(`writeSyncLog failed: ${(e as Error).message}`)
      return null
    }
  }

  private async saveMappingRule(args: {
    sourceId: string
    orgId: string
    dataType: string
    mappingJson: string
    updatedBy: string
  }): Promise<void> {
    let hasKeys = false
    try {
      const parsed = JSON.parse(args.mappingJson) as unknown
      hasKeys = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0
    } catch {
      hasKeys = false
    }
    if (!hasKeys) return
    try {
      await this.prisma.fieldMappingRule.upsert({
        where: { sourceId_dataType: { sourceId: args.sourceId, dataType: args.dataType } },
        create: {
          sourceId: args.sourceId,
          orgId: args.orgId,
          dataType: args.dataType,
          mappingJson: args.mappingJson,
          updatedBy: args.updatedBy,
        },
        update: {
          mappingJson: args.mappingJson,
          updatedBy: args.updatedBy,
        },
      })
    } catch (e) {
      this.logger.warn(`saveMappingRule failed (non-fatal): sourceId=${args.sourceId} dataType=${args.dataType} ${(e as Error).message}`)
    }
  }

  async parseExcelColumns(buffer: Buffer): Promise<{ columns: string[]; sampleRows: Record<string, string>[] }> {
    const rows = await this.loadExcelRows(buffer)
    if (rows.length < 2) {
      throw new BadRequestException({ error: { code: 'EXCEL_NO_DATA', message: 'Excel 文件缺少数据行（至少需要表头行 + 1 行数据）' } })
    }
    const columns = (rows[0] ?? []).map((c) => c.trim()).filter(Boolean)
    const sensitiveHeaders = columns.filter((c) => isSensitiveColumn(c))
    if (sensitiveHeaders.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'SENSITIVE_COLUMN_DETECTED',
          message: `Excel 包含敏感列，禁止导入求职者个人信息: ${sensitiveHeaders.join(', ')}`,
        },
      })
    }
    const sampleRows = rows.slice(1, 6).map((row) => {
      const obj: Record<string, string> = {}
      columns.forEach((col, i) => { obj[col] = row[i] ?? '' })
      return obj
    })
    return { columns, sampleRows }
  }

  async previewExcelImport(args: {
    buffer: Buffer
    fileName: string
    sourceId: string
    dataType: 'job' | 'fair'
    fieldMapping: FieldMapping
    user: AuthedUser
  }): Promise<ExcelPreviewDto> {
    if (!args.user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const source = await this.prisma.jobSource.findUnique({ where: { id: args.sourceId } })
    if (!source || source.orgId !== args.user.orgId) {
      throw new NotFoundException({ error: { code: 'DATA_SOURCE_NOT_FOUND', message: '数据源不存在' } })
    }
    const allRows = await this.loadExcelRows(args.buffer)
    if (allRows.length < 2) {
      throw new BadRequestException({ error: { code: 'EXCEL_NO_DATA', message: 'Excel 缺少数据行' } })
    }
    const headers = (allRows[0] ?? []).map((h) => h.trim())
    const dataRows = allRows.slice(1)

    const sensitiveHeaders = headers.filter((h) => isSensitiveColumn(h))
    if (sensitiveHeaders.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'SENSITIVE_COLUMN_DETECTED',
          message: `Excel 包含敏感列，禁止导入求职者个人信息: ${sensitiveHeaders.join(', ')}`,
        },
      })
    }
    const sensitiveMapped = Object.values(args.fieldMapping).filter((col) => isSensitiveColumn(col))
    if (sensitiveMapped.length > 0) {
      throw new BadRequestException({
        error: {
          code: 'SENSITIVE_COLUMN_IN_MAPPING',
          message: `字段映射中包含敏感列，禁止导入: ${sensitiveMapped.join(', ')}`,
        },
      })
    }

    const standardFields = args.dataType === 'job' ? JOB_STANDARD_FIELDS : FAIR_STANDARD_FIELDS
    const requiredFields = args.dataType === 'job' ? JOB_REQUIRED_FIELDS : FAIR_REQUIRED_FIELDS

    const illegalFields = Object.keys(args.fieldMapping).filter(
      (f) => !(standardFields as readonly string[]).includes(f),
    )
    if (illegalFields.length > 0) {
      throw new BadRequestException({
        error: { code: 'ILLEGAL_FIELD_MAPPING', message: `字段映射包含非法字段: ${illegalFields.join(', ')}` },
      })
    }

    const orgId = args.user.orgId
    const existingExtIds = new Set<string>()
    if (args.dataType === 'job') {
      const existing = await this.prisma.job.findMany({
        where: { sourceOrgId: orgId },
        select: { externalId: true },
      })
      existing.forEach((j) => existingExtIds.add(j.externalId))
    } else {
      const existing = await this.prisma.jobFair.findMany({
        where: { sourceOrgId: orgId },
        select: { externalId: true },
      })
      existing.forEach((f) => existingExtIds.add(f.externalId))
    }

    const seenInBatch = new Set<string>()
    const parsed: ParsedRow[] = dataRows.map((rawRow, idx) => {
      const rawData: Record<string, string> = {}
      headers.forEach((h, i) => { rawData[h] = (rawRow[i] ?? '').trim() })
      const mapped: Record<string, string> = {}
      for (const [stdField, colName] of Object.entries(args.fieldMapping)) {
        mapped[stdField] = rawData[colName] ?? ''
      }
      const errors: string[] = []
      for (const req of requiredFields) {
        if (!mapped[req] || mapped[req].trim() === '') {
          errors.push(`${req} 不能为空`)
        }
      }
      if (mapped.sourceUrl && !mapped.sourceUrl.startsWith('http')) {
        errors.push('sourceUrl 必须以 http 开头')
      }
      if (mapped.checkinUrl && !mapped.checkinUrl.startsWith('http')) {
        errors.push('checkinUrl 必须以 http 开头')
      }
      if (args.dataType === 'job' && mapped.workType?.trim()) {
        const normalizedWorkType = normalizeMappedWorkType(mapped.workType)
        if (!normalizedWorkType) {
          errors.push(`workType 必须为 ${JOB_WORK_TYPE_VALUES.join('、')} 或常见别名`)
        } else {
          mapped.workType = normalizedWorkType
        }
      }
      if (args.dataType === 'fair') {
        if (mapped.startAt && Number.isNaN(Date.parse(mapped.startAt))) {
          errors.push('startAt 日期格式无效')
        }
        if (mapped.endAt && Number.isNaN(Date.parse(mapped.endAt))) {
          errors.push('endAt 日期格式无效')
        }
      }
      let status: 'ok' | 'invalid' | 'dup' = 'ok'
      if (errors.length > 0) {
        status = 'invalid'
      } else if (mapped.externalId) {
        if (seenInBatch.has(mapped.externalId) || existingExtIds.has(mapped.externalId)) {
          status = 'dup'
        } else {
          seenInBatch.add(mapped.externalId)
        }
      }
      return {
        rowIndex: idx + 2,
        rawData: {},
        mapped,
        status,
        errors,
        externalId: mapped.externalId || undefined,
      }
    })

    const validRows   = parsed.filter((r) => r.status === 'ok').length
    const invalidRows = parsed.filter((r) => r.status === 'invalid').length
    const dupRows     = parsed.filter((r) => r.status === 'dup').length

    const batch = await this.prisma.importBatch.create({
      data: {
        sourceId: args.sourceId,
        orgId,
        dataType: args.dataType,
        fileName: args.fileName,
        totalRows: parsed.length,
        validRows,
        invalidRows,
        dupRows,
        status: 'pending',
        mappingJson: JSON.stringify(args.fieldMapping),
        createdBy: args.user.userId,
      },
    })

    const CHUNK = 50
    for (let i = 0; i < parsed.length; i += CHUNK) {
      await this.prisma.importRecord.createMany({
        data: parsed.slice(i, i + CHUNK).map((r) => ({
          batchId: batch.id,
          rowIndex: r.rowIndex,
          rawDataJson: '{}',
          mappedJson: JSON.stringify(r.mapped),
          status: r.status,
          errorsJson: JSON.stringify(r.errors),
          externalId: r.externalId ?? null,
        })),
      })
    }

    return {
      batchId: batch.id,
      totalRows: parsed.length,
      validRows,
      invalidRows,
      dupRows,
      sampleValid: parsed.filter((r) => r.status === 'ok').slice(0, 5).map(toPreviewRow),
      sampleInvalid: parsed.filter((r) => r.status === 'invalid').slice(0, 5).map(toPreviewRow),
      sampleDup: parsed.filter((r) => r.status === 'dup').slice(0, 5).map(toPreviewRow),
    }
  }

  async confirmExcelImport(batchId: string, user: AuthedUser): Promise<{ imported: number; syncLogId: string | null }> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: { records: { where: { status: 'ok' } } },
    })
    if (!batch || batch.orgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'BATCH_NOT_FOUND', message: '导入批次不存在' } })
    }
    if (batch.status !== 'pending') {
      throw new BadRequestException({
        error: { code: 'BATCH_ALREADY_PROCESSED', message: `批次已处于 ${batch.status} 状态，无法重复确认` },
      })
    }
    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    const sourceOrgId = org.id
    const sourceName  = org.name
    const sync        = new Date()
    const totalValid  = batch.records.length
    const touchedJobIds: string[] = []

    try {
      await this.prisma.$transaction(async (tx) => {
        for (const record of batch.records) {
          const mapped = JSON.parse(record.mappedJson) as Record<string, string>
          if (batch.dataType === 'job') {
            const job = await tx.job.upsert({
              where: { sourceOrgId_externalId: { sourceOrgId, externalId: mapped.externalId } },
              create: {
                sourceOrgId, sourceId: batch.sourceId, externalId: mapped.externalId, sourceName,
                sourceUrl: mapped.sourceUrl ?? '',
                title: mapped.title ?? '', company: mapped.company ?? '', city: mapped.city ?? '',
                salary: mapped.salary || null,
                category: mapped.workType ? mapWorkTypeToCategory(mapped.workType) : undefined,
                description: mapped.description || null, requirements: mapped.requirements || null,
                tagsJson: JSON.stringify(buildJobTags([], mapped.industry)),
                educationRequirement: mapped.educationRequirement || null,
                experienceRequirement: mapped.experienceRequirement || null,
                skillsJson: JSON.stringify(splitMappedList(mapped.skills)),
                benefitsJson: JSON.stringify(splitMappedList(mapped.benefits)),
                salaryMin: parseMappedNumber(mapped.salaryMin),
                salaryMax: parseMappedNumber(mapped.salaryMax),
                salaryUnit: mapped.salaryUnit || null,
                validThrough: parseMappedDate(mapped.validThrough),
                reviewStatus: 'pending', publishStatus: 'draft',
                syncTime: sync,
              },
              update: {
                sourceName, sourceUrl: mapped.sourceUrl ?? '',
                title: mapped.title ?? '', company: mapped.company ?? '', city: mapped.city ?? '',
                salary: mapped.salary || null,
                category: mapped.workType ? mapWorkTypeToCategory(mapped.workType) : undefined,
                description: mapped.description || null, requirements: mapped.requirements || null,
                tagsJson: JSON.stringify(buildJobTags([], mapped.industry)),
                educationRequirement: mapped.educationRequirement || null,
                experienceRequirement: mapped.experienceRequirement || null,
                skillsJson: JSON.stringify(splitMappedList(mapped.skills)),
                benefitsJson: JSON.stringify(splitMappedList(mapped.benefits)),
                salaryMin: parseMappedNumber(mapped.salaryMin),
                salaryMax: parseMappedNumber(mapped.salaryMax),
                salaryUnit: mapped.salaryUnit || null,
                validThrough: parseMappedDate(mapped.validThrough),
                syncTime: sync,
              },
            })
            touchedJobIds.push(job.id)
          } else {
            const startAt = new Date(mapped.startAt)
            const endAt   = new Date(mapped.endAt)
            await tx.jobFair.upsert({
              where: { sourceOrgId_externalId: { sourceOrgId, externalId: mapped.externalId } },
              create: {
                sourceOrgId, externalId: mapped.externalId, sourceName,
                sourceId: batch.sourceId,
                sourceUrl: mapped.sourceUrl ?? '',
                checkinUrl: normalizeOptionalHttpUrl(mapped.checkinUrl, 'checkinUrl'),
                title: mapped.title ?? '',
                theme: mapped.theme || 'general',
                startAt, endAt,
                venue: mapped.venue ?? '', city: mapped.city ?? '',
                address: mapped.address || null,
                description: mapped.description || null,
                companyCount: Number(mapped.companyCount) || 0,
                jobCount: Number(mapped.jobCount) || 0,
                reviewStatus: 'pending', publishStatus: 'draft',
                syncTime: sync,
              },
              update: {
                sourceName, sourceUrl: mapped.sourceUrl ?? '',
                checkinUrl: normalizeOptionalHttpUrl(mapped.checkinUrl, 'checkinUrl'),
                title: mapped.title ?? '',
                theme: mapped.theme || 'general',
                startAt, endAt,
                venue: mapped.venue ?? '', city: mapped.city ?? '',
                address: mapped.address || null,
                description: mapped.description || null,
                syncTime: sync,
              },
            })
          }
        }
      })
    } catch (e) {
      this.logger.error(`confirmExcelImport transaction failed: batchId=${batchId}`, e as Error)
      await this.prisma.importBatch.update({
        where: { id: batchId },
        data: { status: 'failed' },
      })
      throw new InternalServerErrorException({
        error: { code: 'IMPORT_TRANSACTION_FAILED', message: 'Excel 导入事务失败，数据已回滚，请检查数据后重试' },
      })
    }

    const imported = totalValid
    const syncLogId = await this.writeSyncLog({
      sourceId: batch.sourceId,
      orgId: user.orgId,
      dataType: batch.dataType as 'job' | 'fair',
      syncMode: 'excel',
      addedCount: imported,
      updatedCount: 0,
      dupCount: batch.dupRows,
      errorCount: batch.invalidRows,
    })

    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'confirmed', confirmedAt: new Date() },
    })

    if (batch.dataType === 'job') {
      await this.refreshJobQualitySnapshots(touchedJobIds)
    }

    await this.saveMappingRule({
      sourceId: batch.sourceId,
      orgId: batch.orgId,
      dataType: batch.dataType,
      mappingJson: batch.mappingJson,
      updatedBy: user.userId,
    })

    await this.audit.write({
      actorId: user.userId,
      actorRole: 'partner',
      action: 'excel.import.confirm',
      targetType: 'job_source',
      targetId: batch.sourceId,
      payload: { batchId, dataType: batch.dataType, imported, syncLogId },
    })

    this.logger.log(`confirmExcelImport: batchId=${batchId} imported=${imported}`)
    return { imported, syncLogId }
  }

  async getMappingRule(sourceId: string, dataType: 'job' | 'fair', user: AuthedUser): Promise<FieldMappingRuleDto> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const source = await this.prisma.jobSource.findUnique({ where: { id: sourceId } })
    if (!source || source.orgId !== user.orgId) {
      throw new NotFoundException({ error: { code: 'DATA_SOURCE_NOT_FOUND', message: '数据源不存在' } })
    }
    const rule = await this.prisma.fieldMappingRule.findUnique({
      where: { sourceId_dataType: { sourceId, dataType } },
    })
    let mapping: Record<string, string> = {}
    if (rule) {
      try {
        const parsed = JSON.parse(rule.mappingJson) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          mapping = parsed as Record<string, string>
        }
      } catch {
        mapping = {}
      }
    }
    return {
      sourceId,
      dataType,
      mapping,
      updatedAt: rule ? rule.updatedAt.toISOString() : null,
    }
  }
}
