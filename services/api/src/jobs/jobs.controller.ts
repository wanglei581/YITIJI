// ============================================================
// Jobs Controller — Phase 7.10
//
// 路由前缀：/api/v1（由 main.ts 全局设置）
//
// Kiosk（公开）:
//   GET  /jobs                          — 已发布岗位列表
//   GET  /jobs/:id                      — 已发布岗位详情
//   GET  /job-fairs                     — 已发布招聘会列表
//   GET  /job-fairs/:id                 — 已发布招聘会详情
//
// Admin（管理员）:
//   GET   /admin/job-sources            — 全量岗位列表（含审核/发布状态）
//   PATCH /admin/job-sources/:id/review — 审核操作（approve/reject/reviewing）
//   PATCH /admin/job-sources/:id/publish — 发布操作（publish/unpublish）
//   GET   /admin/fair-sources           — 全量招聘会列表
//   PATCH /admin/fair-sources/:id/review
//   PATCH /admin/fair-sources/:id/publish
//
// Partner（合作机构）:
//   GET   /partner/jobs                 — 本机构岗位列表
//   POST  /partner/jobs/import          — 批量导入岗位（默认 pending + draft）
//   PATCH /partner/jobs/:id/publish     — 下架岗位
//   GET   /partner/fairs                — 本机构招聘会列表
//   POST  /partner/fairs/import         — 批量导入招聘会（默认 pending + draft）
//   PATCH /partner/fairs/:id/publish    — 下架招聘会
//   GET   /partner/data-sources         — 本机构数据源列表
//   POST  /partner/data-sources         — 新增数据源(API/Excel/Webhook)
//   PATCH /partner/data-sources/:id/toggle — 启停数据源
// ============================================================

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { JobsService } from './jobs.service'
import { AdminFairsService } from './admin-fairs.service'
import { ReviewActionDto } from './dto/review.dto'
import { PublishActionDto } from './dto/publish.dto'
import { ImportJobsDto } from './dto/import-jobs.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { ImportFairsDto } from './dto/import-fairs.dto'
import { UpdatePartnerFairDto, UpdatePartnerJobDto } from './dto/partner-edit.dto'
import { CreateDataSourceDto } from './dto/data-source.dto'
// ExcelPreviewDto not needed at controller level — fields extracted from multipart body

/** Number() 对非数字字符串返回 NaN，直接传 Prisma 会导致全量返回。安全解析并夹紧范围。 */
function safeInt(value: string | undefined, defaultValue: number, min: number, max: number): number {
  const n = value !== undefined ? Number(value) : defaultValue
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaultValue
}

/**
 * Kiosk 岗位类型筛选既接受 workType('full_time' 等,前端枚举),
 * 也接受 category('fulltime' 等,DB 列值)。这里把 workType 归一到 category。
 * 'campus'(校招)没有对应 workType,前端直接传 category=campus。
 */
function mapWorkTypeToCategory(workType: string): string | undefined {
  switch (workType) {
    case 'full_time':  return 'fulltime'
    case 'part_time':  return 'parttime'
    case 'internship': return 'intern'
    case 'contract':   return 'fulltime'
    case 'fulltime':
    case 'parttime':
    case 'intern':
    case 'campus':     return workType
    default:           return undefined
  }
}

@Controller()
export class JobsController {
  constructor(
    private readonly jobsService: JobsService,
    private readonly adminFairs: AdminFairsService,
  ) {}

  // ── Kiosk ───────────────────────────────────────────────────────────────────

  @Get('jobs')
  getJobs(
    @Query('keyword')     keyword?:     string,
    @Query('city')        city?:        string,
    @Query('industry')    industry?:    string,
    @Query('category')    category?:    string,
    @Query('workType')    workType?:    string,
    @Query('sourceOrgId') sourceOrgId?: string,
    @Query('tag')         tag?:         string,
    @Query('page')        pageStr?:     string,
    @Query('pageSize')    sizeStr?:     string,
  ) {
    const page     = safeInt(pageStr, 1, 1, 10_000)
    const pageSize = safeInt(sizeStr, 20, 1, 100)
    // workType('full_time' 等)与 category('fulltime' 等)二选一,category 优先
    const effectiveCategory = category ?? (workType ? mapWorkTypeToCategory(workType) : undefined)
    return this.jobsService.getPublishedJobs({
      keyword, city, industry, category: effectiveCategory, sourceOrgId, tag, page, pageSize,
    })
  }

  @Get('jobs/:id')
  getJobById(@Param('id') id: string) {
    return this.jobsService.getPublishedJobById(id)
  }

  @Get('job-fairs')
  getJobFairs(
    @Query('status')   status?:   string,
    @Query('page')     pageStr?:  string,
    @Query('pageSize') sizeStr?:  string,
  ) {
    const page     = safeInt(pageStr, 1, 1, 10_000)
    const pageSize = safeInt(sizeStr, 20, 1, 100)
    return this.jobsService.getPublishedFairs({ status, page, pageSize })
  }

  @Get('job-fairs/:id')
  getJobFairById(@Param('id') id: string) {
    return this.jobsService.getPublishedFairById(id)
  }

  /**
   * 招聘会详情(含 companies + zones),供 Kiosk 详情页一次拉到位。
   * 校企合作详情页(theme=campus_corp)也走这条。
   */
  @Get('job-fairs/:id/detail')
  getJobFairDetail(@Param('id') id: string) {
    return this.jobsService.getPublishedFairDetail(id)
  }

  // ── 招聘会子资源 ──────────────────────────────────────────────────────────────
  // companies / companies/:id / zones / map 走真实 Prisma 查询(FairCompany / FairZone)。
  // 招聘会不存在 / 未发布时返回空集(200 + 空比 404 对前端 EmptyState 更友好)。
  // materials / stats 暂无对应 Prisma 模型 → 诚实返回空,绝不硬造假数据(见各端点注释)。

  @Get('job-fairs/:id/companies')
  getFairCompanies(
    @Param('id') id: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') sizeStr?: string,
  ) {
    const page     = safeInt(pageStr, 1, 1, 10_000)
    const pageSize = safeInt(sizeStr, 20, 1, 100)
    return this.jobsService.getFairCompanies(id, page, pageSize)
  }

  @Get('job-fairs/:id/companies/:companyId')
  getFairCompanyById(
    @Param('id') id: string,
    @Param('companyId') companyId: string,
  ) {
    return this.jobsService.getFairCompanyById(id, companyId)
  }

  @Get('job-fairs/:id/zones')
  getFairZones(@Param('id') id: string) {
    return this.jobsService.getFairZones(id)
  }

  @Get('job-fairs/:id/map')
  getFairMap(@Param('id') id: string) {
    return this.jobsService.getFairMap(id)
  }

  /**
   * 招聘会活动资料(阶段1A 接真)。
   * FairMaterial 已落库:只放出已发布资料,且所属招聘会须 approved+published;
   * 响应内是 HMAC 签名短时 URL,不暴露原始存储路径。
   */
  @Get('job-fairs/:id/materials')
  getFairMaterials(
    @Param('id') id: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') sizeStr?: string,
  ) {
    const page     = safeInt(pageStr, 1, 1, 10_000)
    const pageSize = safeInt(sizeStr, 20, 1, 100)
    return this.adminFairs.getPublishedFairMaterials(id, page, pageSize)
  }

  /**
   * 招聘会场馆导览(本轮新增)。
   * 只放出 approved+published 招聘会;未配置导览 → data null(前端空态)。
   * 数据由 Admin 配置落库,绝非前端硬编码。
   */
  @Get('job-fairs/:id/venue-guide')
  getFairVenueGuide(@Param('id') id: string) {
    return this.adminFairs.getPublishedVenueGuide(id)
  }

  /**
   * 招聘会数据大屏统计。
   * 合规：返回的规模/分布为「预计/来源数据」(机构录入 + 按已录企业/岗位聚合)，非实时；
   * 系统真实服务数据(浏览量)如实返回，未落库计数器诚实置 0。招聘会未发布 → data:null。
   */
  @Get('job-fairs/:id/stats')
  getFairStats(@Param('id') id: string) {
    return this.jobsService.getFairStats(id)
  }

  // ── Admin(全部受 @Roles('admin') 保护)─────────────────────────────────────

  @Get('admin/job-sources')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getJobSources() {
    return this.jobsService.getAllJobSources()
  }

  @Patch('admin/job-sources/:id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  reviewJobSource(
    @Param('id') id: string,
    @Body() dto: ReviewActionDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.jobsService.reviewJobSource(id, dto.action, dto.reason, user)
  }

  @Patch('admin/job-sources/:id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  publishJobSource(
    @Param('id') id: string,
    @Body() dto: PublishActionDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.jobsService.publishJobSource(id, dto.action, user)
  }

  @Get('admin/fair-sources')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getFairSources() {
    return this.jobsService.getAllFairSources()
  }

  @Patch('admin/fair-sources/:id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  reviewFairSource(
    @Param('id') id: string,
    @Body() dto: ReviewActionDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.jobsService.reviewFairSource(id, dto.action, dto.reason, user)
  }

  @Patch('admin/fair-sources/:id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  publishFairSource(
    @Param('id') id: string,
    @Body() dto: PublishActionDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.jobsService.publishFairSource(id, dto.action, user)
  }

  // ── Partner(全部受 @Roles('partner') 保护,sourceOrgId 强制 from JWT)─────

  @Get('partner/data-sources')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  getPartnerDataSources(@CurrentUser() user: AuthedUser) {
    return this.jobsService.getPartnerDataSources(user)
  }

  @Post('partner/data-sources')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  createPartnerDataSource(
    @Body() dto: CreateDataSourceDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.jobsService.createPartnerDataSource(dto, user)
  }

  @Patch('partner/data-sources/:id/toggle')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  togglePartnerDataSource(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.jobsService.togglePartnerDataSource(id, user)
  }

  @Get('partner/jobs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  getPartnerJobs(@CurrentUser() user: AuthedUser) {
    return this.jobsService.getPartnerJobs(user)
  }

  /**
   * Phase #5 — Partner 导入岗位(只能写入自己机构,默认 pending+draft)。
   *
   * 安全约束:
   *  - JwtAuthGuard:必须带有效 JWT
   *  - @Roles('partner'):admin / kiosk token 一律 403
   *  - forbidNonWhitelisted:body 出现任何超出白名单的字段
   *    (候选人姓名 / 邮箱 / 电话 / 简历 / Offer 等)直接 400 拒绝
   *  - sourceOrgId 不读 body,强制取 req.user.orgId,杜绝跨机构污染
   *
   * 合规边界:本接口仅接收"岗位展示信息",不接收求职者数据。
   */
  @Post('partner/jobs/import')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  async importJobs(@Body() dto: ImportJobsDto, @CurrentUser() user: AuthedUser) {
    return this.jobsService.importJobs(dto.items, user)
  }

  @Patch('partner/jobs/:id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  unpublishPartnerJob(
    @Param('id') id: string,
    @Body() _dto: PublishActionDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.jobsService.unpublishPartnerJob(id, user)
  }

  /**
   * 阶段1C — Partner 编辑本机构岗位(展示字段白名单)。
   * 编辑成功后强制回 pending+draft 重审;externalId / 来源字段不可改。
   */
  @Patch('partner/jobs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  updatePartnerJob(
    @Param('id') id: string,
    @Body() dto: UpdatePartnerJobDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.jobsService.updatePartnerJob(id, dto, user)
  }

  @Get('partner/fairs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  getPartnerFairs(@CurrentUser() user: AuthedUser) {
    return this.jobsService.getPartnerFairs(user)
  }

  @Post('partner/fairs/import')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  importFairs(@Body() dto: ImportFairsDto, @CurrentUser() user: AuthedUser) {
    return this.jobsService.importFairs(dto, user)
  }

  @Patch('partner/fairs/:id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  unpublishPartnerFair(
    @Param('id') id: string,
    @Body() _dto: PublishActionDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.jobsService.unpublishPartnerFair(id, user)
  }

  /** 阶段1C — Partner 编辑本机构招聘会(规则同岗位编辑:重审 + 来源不可改)。 */
  @Patch('partner/fairs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  updatePartnerFair(
    @Param('id') id: string,
    @Body() dto: UpdatePartnerFairDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.jobsService.updatePartnerFair(id, dto, user)
  }

  // ── Partner sync logs ────────────────────────────────────────────────────────

  @Get('partner/dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  getPartnerDashboard(@CurrentUser() user: AuthedUser) {
    return this.jobsService.getPartnerDashboard(user)
  }

  @Get('partner/sync-logs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  getPartnerSyncLogs(@CurrentUser() user: AuthedUser) {
    return this.jobsService.getPartnerSyncLogs(user)
  }

  // ── Admin import batches ─────────────────────────────────────────────────────

  @Get('admin/import-batches')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getAdminImportBatches() {
    return this.jobsService.getAdminImportBatches()
  }

  // ── Partner Excel import ─────────────────────────────────────────────────────
  //
  //   GET  /partner/excel/mapping-rule → 上次保存的字段映射(自动回填)
  //   POST /partner/excel/parse    multipart file → columns + sampleRows (stateless)
  //   POST /partner/excel/preview  multipart file + mapping → ImportBatch + preview
  //   POST /partner/excel/:id/confirm → upsert ok rows + SyncLog + 保存映射规则
  //   DELETE /partner/excel/:id   → cancel pending batch

  @Get('partner/excel/mapping-rule')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  getMappingRule(
    @Query('sourceId') sourceId: string,
    @Query('dataType') dataType: string,
    @CurrentUser() user: AuthedUser,
  ) {
    if (!sourceId?.trim()) {
      throw new BadRequestException({ error: { code: 'SOURCE_ID_REQUIRED', message: '缺少 sourceId' } })
    }
    if (dataType !== 'job' && dataType !== 'fair') {
      throw new BadRequestException({ error: { code: 'INVALID_DATA_TYPE', message: 'dataType 必须为 job 或 fair' } })
    }
    return this.jobsService.getMappingRule(sourceId, dataType, user)
  }

  @Post('partner/excel/parse')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  @UseInterceptors(FileInterceptor('file'))
  parseExcel(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException({ error: { code: 'FILE_MISSING', message: '缺少 Excel 文件' } })
    }
    return this.jobsService.parseExcelColumns(file.buffer)
  }

  @Post('partner/excel/preview')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  @UseInterceptors(FileInterceptor('file'))
  previewExcel(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('sourceId') sourceId: string,
    @Body('dataType') dataType: string,
    @Body('fieldMapping') fieldMappingRaw: string,
    @CurrentUser() user: AuthedUser,
  ) {
    if (!file) {
      throw new BadRequestException({ error: { code: 'FILE_MISSING', message: '缺少 Excel 文件' } })
    }
    if (!sourceId?.trim()) {
      throw new BadRequestException({ error: { code: 'SOURCE_ID_REQUIRED', message: '缺少 sourceId' } })
    }
    if (dataType !== 'job' && dataType !== 'fair') {
      throw new BadRequestException({ error: { code: 'INVALID_DATA_TYPE', message: 'dataType 必须为 job 或 fair' } })
    }
    let fieldMapping: Record<string, string>
    try {
      fieldMapping = JSON.parse(fieldMappingRaw ?? '{}') as Record<string, string>
    } catch {
      throw new BadRequestException({ error: { code: 'INVALID_FIELD_MAPPING', message: 'fieldMapping 必须是合法 JSON' } })
    }

    return this.jobsService.previewExcelImport({
      buffer: file.buffer,
      fileName: file.originalname,
      sourceId,
      dataType: dataType as 'job' | 'fair',
      fieldMapping,
      user,
    })
  }

  @Post('partner/excel/:batchId/confirm')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  confirmExcelImport(
    @Param('batchId') batchId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.jobsService.confirmExcelImport(batchId, user)
  }

  @Delete('partner/excel/:batchId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  async cancelExcelImport(
    @Param('batchId') batchId: string,
    @CurrentUser() user: AuthedUser,
  ) {
    await this.jobsService.cancelExcelImport(batchId, user)
    return { success: true }
  }
}
