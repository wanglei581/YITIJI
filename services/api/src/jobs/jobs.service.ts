// ============================================================
// JobsService — Façade（N1 拆分后）
//
// 公共 API 完全不变，行为零变化。
// 原2498行文件已按业务域拆分为4个子服务：
//   jobs-kiosk.service.ts   — Kiosk 公开只读端点
//   jobs-admin.service.ts   — Admin 审核/发布/批次管理
//   jobs-partner.service.ts — Partner 数据源/岗位/招聘会/同步日志
//   jobs-excel.service.ts   — Excel 导入 / 字段映射规则
// 共享类型与纯函数帮助函数见 jobs-shared.ts。
//
// 保持现有 controller / sync.service import 路径不变（零风险过渡）。
// ============================================================

import { Injectable } from '@nestjs/common'
import { JobsKioskService } from './jobs-kiosk.service'
import { JobsAdminService } from './jobs-admin.service'
import { JobsPartnerService } from './jobs-partner.service'
import { JobsExcelService } from './jobs-excel.service'
import type { ReviewAction } from './dto/review.dto'
import type { PublishAction } from './dto/publish.dto'
import type { ImportJobItemDto } from './dto/import-jobs.dto'
import type { ImportFairsDto } from './dto/import-fairs.dto'
import type { CreateDataSourceDto } from './dto/data-source.dto'
import type { UpdatePartnerFairDto, UpdatePartnerJobDto } from './dto/partner-edit.dto'
import type { FieldMapping } from './dto/excel-import.dto'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import type { FairDetailResponse, FairCompany, FairZone } from './fair.types'

// ─── Re-export all types that controllers / other services import from here ───
export type {
  JobListItemDto,
  FairIntentSlice,
  FairIndustrySlice,
  FairListItemDto,
  FairStatsDto,
  AdminJobDto,
  AdminFairDto,
  PartnerJobDto,
  PartnerFairDto,
  PaginatedResult,
  SyncLogDto,
  AdminImportBatchDto,
  ExcelPreviewDto,
  FieldMappingRuleDto,
  SingleResult,
  ImportResult,
  PartnerDataSourceDto,
} from './jobs-shared'
export { buildJobIndustryTag } from './jobs-shared'

@Injectable()
export class JobsService {
  constructor(
    private readonly kiosk: JobsKioskService,
    private readonly admin: JobsAdminService,
    private readonly partner: JobsPartnerService,
    private readonly excel: JobsExcelService,
  ) {}

  // ── Kiosk ──────────────────────────────────────────────────────────────────

  getPublishedJobs(params?: Parameters<JobsKioskService['getPublishedJobs']>[0]) {
    return this.kiosk.getPublishedJobs(params)
  }

  getPublishedJobById(id: string) {
    return this.kiosk.getPublishedJobById(id)
  }

  getPublishedFairs(params?: Parameters<JobsKioskService['getPublishedFairs']>[0]) {
    return this.kiosk.getPublishedFairs(params)
  }

  getPublishedFairById(id: string) {
    return this.kiosk.getPublishedFairById(id)
  }

  getPublishedFairDetail(id: string): Promise<FairDetailResponse | null> {
    return this.kiosk.getPublishedFairDetail(id)
  }

  getFairCompanies(fairId: string, page: number, pageSize: number): Promise<{ data: FairCompany[]; total: number; page: number; pageSize: number }> {
    return this.kiosk.getFairCompanies(fairId, page, pageSize)
  }

  getFairCompanyById(fairId: string, companyId: string): Promise<{ data: FairCompany | null }> {
    return this.kiosk.getFairCompanyById(fairId, companyId)
  }

  getFairZones(fairId: string): Promise<{ data: FairZone[] }> {
    return this.kiosk.getFairZones(fairId)
  }

  getFairMap(fairId: string) {
    return this.kiosk.getFairMap(fairId)
  }

  getFairStats(fairId: string) {
    return this.kiosk.getFairStats(fairId)
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  getAllJobSources() {
    return this.admin.getAllJobSources()
  }

  reviewJobSource(id: string, action: ReviewAction, reason: string | undefined, user: AuthedUser) {
    return this.admin.reviewJobSource(id, action, reason, user)
  }

  publishJobSource(id: string, action: PublishAction, user: AuthedUser) {
    return this.admin.publishJobSource(id, action, user)
  }

  getAllFairSources() {
    return this.admin.getAllFairSources()
  }

  reviewFairSource(id: string, action: ReviewAction, reason: string | undefined, user: AuthedUser) {
    return this.admin.reviewFairSource(id, action, reason, user)
  }

  publishFairSource(id: string, action: PublishAction, user: AuthedUser) {
    return this.admin.publishFairSource(id, action, user)
  }

  getAdminImportBatches() {
    return this.admin.getAdminImportBatches()
  }

  cancelExcelImport(batchId: string, user: AuthedUser) {
    return this.admin.cancelExcelImport(batchId, user)
  }

  // ── Partner ────────────────────────────────────────────────────────────────

  getPartnerDataSources(user: AuthedUser) {
    return this.partner.getPartnerDataSources(user)
  }

  createPartnerDataSource(dto: CreateDataSourceDto, user: AuthedUser) {
    return this.partner.createPartnerDataSource(dto, user)
  }

  togglePartnerDataSource(id: string, user: AuthedUser) {
    return this.partner.togglePartnerDataSource(id, user)
  }

  getPartnerJobs(user: AuthedUser) {
    return this.partner.getPartnerJobs(user)
  }

  importJobs(items: ImportJobItemDto[], user: AuthedUser) {
    return this.partner.importJobs(items, user)
  }

  importJobsFromWebhook(orgId: string, sourceId: string, items: ImportJobItemDto[]) {
    return this.partner.importJobsFromWebhook(orgId, sourceId, items)
  }

  unpublishPartnerJob(id: string, user: AuthedUser) {
    return this.partner.unpublishPartnerJob(id, user)
  }

  updatePartnerJob(id: string, dto: UpdatePartnerJobDto, user: AuthedUser) {
    return this.partner.updatePartnerJob(id, dto, user)
  }

  getPartnerFairs(user: AuthedUser) {
    return this.partner.getPartnerFairs(user)
  }

  importFairs(dto: ImportFairsDto, user: AuthedUser) {
    return this.partner.importFairs(dto, user)
  }

  unpublishPartnerFair(id: string, user: AuthedUser) {
    return this.partner.unpublishPartnerFair(id, user)
  }

  updatePartnerFair(id: string, dto: UpdatePartnerFairDto, user: AuthedUser) {
    return this.partner.updatePartnerFair(id, dto, user)
  }

  getPartnerDashboard(user: AuthedUser) {
    return this.partner.getPartnerDashboard(user)
  }

  getPartnerSyncLogs(user: AuthedUser) {
    return this.partner.getPartnerSyncLogs(user)
  }

  // ── Excel ──────────────────────────────────────────────────────────────────

  parseExcelColumns(buffer: Buffer) {
    return this.excel.parseExcelColumns(buffer)
  }

  previewExcelImport(args: {
    buffer: Buffer
    fileName: string
    sourceId: string
    dataType: 'job' | 'fair'
    fieldMapping: FieldMapping
    user: AuthedUser
  }) {
    return this.excel.previewExcelImport(args)
  }

  confirmExcelImport(batchId: string, user: AuthedUser) {
    return this.excel.confirmExcelImport(batchId, user)
  }

  getMappingRule(sourceId: string, dataType: 'job' | 'fair', user: AuthedUser) {
    return this.excel.getMappingRule(sourceId, dataType, user)
  }
}
