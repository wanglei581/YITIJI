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
// ============================================================

import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { JobsService } from './jobs.service'
import { ReviewActionDto } from './dto/review.dto'
import { PublishActionDto } from './dto/publish.dto'
import { ImportJobsDto } from './dto/import-jobs.dto'
import { ImportFairsDto } from './dto/import-fairs.dto'

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

  // ── Admin ───────────────────────────────────────────────────────────────────

  @Get('admin/job-sources')
  getJobSources() {
    return this.jobsService.getAllJobSources()
  }

  @Patch('admin/job-sources/:id/review')
  reviewJobSource(
    @Param('id') id: string,
    @Body() dto: ReviewActionDto,
  ) {
    return this.jobsService.reviewJobSource(id, dto.action, dto.reason)
  }

  @Patch('admin/job-sources/:id/publish')
  publishJobSource(
    @Param('id') id: string,
    @Body() dto: PublishActionDto,
  ) {
    return this.jobsService.publishJobSource(id, dto.action)
  }

  @Get('admin/fair-sources')
  getFairSources() {
    return this.jobsService.getAllFairSources()
  }

  @Patch('admin/fair-sources/:id/review')
  reviewFairSource(
    @Param('id') id: string,
    @Body() dto: ReviewActionDto,
  ) {
    return this.jobsService.reviewFairSource(id, dto.action, dto.reason)
  }

  @Patch('admin/fair-sources/:id/publish')
  publishFairSource(
    @Param('id') id: string,
    @Body() dto: PublishActionDto,
  ) {
    return this.jobsService.publishFairSource(id, dto.action)
  }

  // ── Partner ─────────────────────────────────────────────────────────────────

  @Get('partner/jobs')
  getPartnerJobs(@Query('sourceOrgId') sourceOrgId?: string) {
    return this.jobsService.getPartnerJobs(sourceOrgId)
  }

  @Post('partner/jobs/import')
  importJobs(@Body() dto: ImportJobsDto) {
    return this.jobsService.importJobs(dto)
  }

  @Patch('partner/jobs/:id/publish')
  unpublishPartnerJob(
    @Param('id') id: string,
    @Body() _dto: PublishActionDto,
    @Query('sourceOrgId') sourceOrgId?: string,
  ) {
    return this.jobsService.unpublishPartnerJob(id, sourceOrgId)
  }

  @Get('partner/fairs')
  getPartnerFairs(@Query('sourceOrgId') sourceOrgId?: string) {
    return this.jobsService.getPartnerFairs(sourceOrgId)
  }

  @Post('partner/fairs/import')
  importFairs(@Body() dto: ImportFairsDto) {
    return this.jobsService.importFairs(dto)
  }

  @Patch('partner/fairs/:id/publish')
  unpublishPartnerFair(
    @Param('id') id: string,
    @Body() _dto: PublishActionDto,
    @Query('sourceOrgId') sourceOrgId?: string,
  ) {
    return this.jobsService.unpublishPartnerFair(id, sourceOrgId)
  }
}
