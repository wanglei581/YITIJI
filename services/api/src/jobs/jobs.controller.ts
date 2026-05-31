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

import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JobsService } from './jobs.service'
import { ReviewActionDto } from './dto/review.dto'
import { PublishActionDto } from './dto/publish.dto'
import { ImportJobsDto } from './dto/import-jobs.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { ImportFairsDto } from './dto/import-fairs.dto'
import { CreateDataSourceDto } from './dto/data-source.dto'

@Controller()
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  // ── Kiosk ───────────────────────────────────────────────────────────────────

  @Get('jobs')
  getJobs(
    @Query('tag')      tag?:      string,
    @Query('city')     city?:     string,
    @Query('page')     pageStr?:  string,
    @Query('pageSize') sizeStr?:  string,
  ) {
    const page     = pageStr ? Number(pageStr)  : 1
    const pageSize = sizeStr ? Number(sizeStr)  : 20
    return this.jobsService.getPublishedJobs({ tag, city, page, pageSize })
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
    const page     = pageStr ? Number(pageStr) : 1
    const pageSize = sizeStr ? Number(sizeStr) : 20
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
}
