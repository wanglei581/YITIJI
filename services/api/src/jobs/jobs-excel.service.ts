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
import { assertDataSourceCapability, assertPartnerDataTypeCapability } from './partner-capabilities'
import {
  importSyncModeOf,
  loadPartnerImportRows,
  PARTNER_IMPORT_MAX_DATA_ROWS,
  PARTNER_IMPORT_MAX_FILE_BYTES,
} from './partner-import-file'
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

  private async loadExcelRows(buffer: Buffer, fileName: string): Promise<string[][]> {
    try {
      return await loadPartnerImportRows(buffer, fileName)
    } catch (error) {
      if ((error as Error).message === 'IMPORT_FILE_TOO_LARGE') {
        throw new BadRequestException({
          error: { code: 'EXCEL_FILE_TOO_LARGE', message: `Excel/CSV 文件不能超过 ${PARTNER_IMPORT_MAX_FILE_BYTES / 1024 / 1024}MB` },
        })
      }
      if ((error as Error).message === 'IMPORT_ROW_LIMIT_EXCEEDED') {
        throw new BadRequestException({
          error: { code: 'EXCEL_TOO_MANY_ROWS', message: `Excel/CSV 文件最多包含 ${PARTNER_IMPORT_MAX_DATA_ROWS} 行数据` },
        })
      }
      if ((error as Error).message === 'IMPORT_XLSX_ARCHIVE_LIMIT_EXCEEDED') {
        throw new BadRequestException({
          error: { code: 'EXCEL_ARCHIVE_TOO_LARGE', message: 'Excel 解压后内容过大或结构过于复杂，请精简后重试' },
        })
      }
      // 「格式不受支持」必须和「文件为空/内容坏了」分开报。
      //
      // 数据源的 accessMode 闸门放行 ['excel','csv','json'](见本文件 previewExcelImport /
      // confirmExcelImport),但解析器 loadPartnerImportRows 只认 .xlsx 与 .csv。
      // 于是一个 accessMode='json' 的源上传 .json 时,底层抛 UNSUPPORTED_FILE_FORMAT ——
      // 这一档此前没有 catch 分支,统一落到 EXCEL_EMPTY「文件为空或格式不正确」。
      // 运营会照着这句话去查文件是不是空的,而真实原因是**这个格式压根没有解析器**,
      // 且没有任何地方告诉他受支持的是哪两种。错误必须说清实情,否则等于把
      // 「能力缺失」伪装成「用户的文件有问题」。
      if ((error as Error).message === 'UNSUPPORTED_FILE_FORMAT') {
        throw new BadRequestException({
          error: {
            code: 'UNSUPPORTED_FILE_FORMAT',
            message: '文件格式不受支持：当前仅支持 .xlsx 与 .csv 两种格式，请另存为后重新上传。',
          },
        })
      }
      throw new BadRequestException({ error: { code: 'EXCEL_EMPTY', message: 'Excel/CSV 文件为空或格式不正确' } })
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

  async parseExcelColumns(buffer: Buffer, fileName: string): Promise<{ columns: string[]; sampleRows: Record<string, string>[] }> {
    const rows = await this.loadExcelRows(buffer, fileName)
    if (rows.length < 1) {
      throw new BadRequestException({ error: { code: 'EXCEL_NO_HEADER', message: 'Excel/CSV 文件缺少表头行' } })
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
    const source = await this.prisma.jobSource.findUnique({ where: { id: args.sourceId }, include: { org: true } })
    if (!source || source.orgId !== args.user.orgId) {
      throw new NotFoundException({ error: { code: 'DATA_SOURCE_NOT_FOUND', message: '数据源不存在' } })
    }
    if (!source.enabled || !source.org.enabled) {
      throw new BadRequestException({ error: { code: 'DATA_SOURCE_DISABLED', message: '数据源或所属机构已停用' } })
    }
    if (!['excel', 'csv', 'json'].includes(source.accessMode)) {
      throw new BadRequestException({ error: { code: 'DATA_SOURCE_FILE_MODE_REQUIRED', message: '该数据源不是文件导入模式' } })
    }
    assertDataSourceCapability(source.org.type, source.accessMode, source.sourceKind)
    assertPartnerDataTypeCapability(source.org.type, args.dataType)
    const allRows = await this.loadExcelRows(args.buffer, args.fileName)
    if (allRows.length < 1) {
      throw new BadRequestException({ error: { code: 'EXCEL_NO_HEADER', message: 'Excel/CSV 文件缺少表头行' } })
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
    if (batch.records.length === 0) {
      throw new BadRequestException({
        error: { code: 'BATCH_NO_VALID_ROWS', message: '批次没有可导入的有效行，请返回检查文件与字段映射' },
      })
    }
    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' } })
    }
    assertPartnerDataTypeCapability(org.type, batch.dataType as 'job' | 'fair')
    const source = await this.prisma.jobSource.findUnique({ where: { id: batch.sourceId } })
    if (!source || source.orgId !== user.orgId || !source.enabled) {
      throw new BadRequestException({ error: { code: 'DATA_SOURCE_DISABLED', message: '数据源已停用，不能确认导入' } })
    }
    if (!['excel', 'csv', 'json'].includes(source.accessMode)) {
      throw new BadRequestException({ error: { code: 'DATA_SOURCE_FILE_MODE_REQUIRED', message: '该数据源不是文件导入模式' } })
    }
    assertDataSourceCapability(org.type, source.accessMode, source.sourceKind)
    const sourceOrgId = org.id
    const sourceName  = org.name
    const sync        = new Date()
    const totalValid  = batch.records.length
    const touchedJobIds: string[] = []
    let syncLogId: string | null = null

    try {
      await this.prisma.$transaction(async (tx) => {
        const claim = await tx.importBatch.updateMany({
          where: { id: batchId, orgId: sourceOrgId, status: 'pending' },
          data: { status: 'processing' },
        })
        if (claim.count !== 1) throw new Error('IMPORT_BATCH_ALREADY_CLAIMED')
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
                headcount: parseMappedNumber(mapped.headcount),
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
                headcount: parseMappedNumber(mapped.headcount),
                // Excel 确认导入一律回 pending+draft 强制重审，即使已发布也立即下架。
                // 同时清空上一次审核元数据，避免 pending 记录仍带旧审核人/时间/拒绝原因。
                reviewStatus: 'pending',
                publishStatus: 'draft',
                rejectReason: null,
                reviewedBy: null,
                reviewedAt: null,
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
                // Excel 确认导入招聘会一律回 pending+draft 强制重审，即使已发布也立即下架。
                // 同时清空上一次审核元数据，避免 pending 记录仍带旧审核人/时间/拒绝原因。
                reviewStatus: 'pending',
                publishStatus: 'draft',
                rejectReason: null,
                reviewedBy: null,
                reviewedAt: null,
                syncTime: sync,
              },
            })
          }
        }
        await tx.jobSource.update({
          where: { id: batch.sourceId },
          data: {
            lastSyncAt: sync,
            lastSyncStatus: batch.invalidRows > 0 ? 'partial' : 'success',
          },
        })
        const result = batch.invalidRows === 0 ? 'success' : totalValid > 0 ? 'partial' : 'failed'
        const syncLog = await tx.syncLog.create({
          data: {
            sourceId: batch.sourceId,
            orgId: sourceOrgId,
            dataType: batch.dataType,
            // 按**实际文件格式**记,不能硬编码 'excel'。
            // SyncLog 是 Partner 后台「同步日志」页直接给运营看的记录;原先 CSV 导入
            // 在日志里伪装成 Excel 导入,运营排查「这批数据是怎么进来的」时会被误导。
            syncMode: importSyncModeOf(batch.fileName),
            totalCount: totalValid + batch.dupRows + batch.invalidRows,
            addedCount: totalValid,
            updatedCount: 0,
            dupCount: batch.dupRows,
            errorCount: batch.invalidRows,
            errorFields: '[]',
            errorDetail: null,
            result,
          },
        })
        syncLogId = syncLog.id
        await tx.importBatch.update({
          where: { id: batchId },
          data: { status: 'confirmed', confirmedAt: new Date() },
        })
      })
    } catch (e) {
      if ((e as Error).message === 'IMPORT_BATCH_ALREADY_CLAIMED') {
        throw new BadRequestException({
          error: { code: 'BATCH_ALREADY_PROCESSED', message: '批次已被确认，无法重复提交' },
        })
      }
      this.logger.error(`confirmExcelImport transaction failed: batchId=${batchId}`, e as Error)
      await this.prisma.importBatch.updateMany({
        where: { id: batchId, status: 'pending' },
        data: { status: 'failed' },
      })
      throw new InternalServerErrorException({
        error: { code: 'IMPORT_TRANSACTION_FAILED', message: 'Excel 导入事务失败，数据已回滚，请检查数据后重试' },
      })
    }

    const imported = totalValid

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
