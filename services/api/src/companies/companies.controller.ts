import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { parseMemberPageQuery } from '../common/utils/member-page'
import { CompaniesService } from './companies.service'
import {
  AdminCreateCompanyDto, AdminLinkJobsDto, AdminPublishCompanyDto, AdminReviewCompanyDto,
  AdminUpdateCompanyDto, PartnerImportCompaniesDto, PartnerUpdateCompanyDto,
} from './dto/company.dto'

// ============================================================
// 企业展示（CompanyProfile）：
//   公开（Kiosk，只读已审核发布）:
//     GET /companies                 — 找企业列表（筛选 + 游标分页）
//     GET /companies/stats           — 统计条（真实聚合）
//     GET /companies/filters         — 筛选可选项（只来自真实数据）
//     GET /companies/:id             — 企业详情（指标受后台开关控制）
//     GET /companies/:id/jobs        — 企业在招岗位（已发布）
//   Admin:
//     GET    /admin/companies                    POST  /admin/companies
//     GET    /admin/companies/:id                PATCH /admin/companies/:id
//     PATCH  /admin/companies/:id/review         PATCH /admin/companies/:id/publish
//     GET    /admin/companies/:id/linkable-jobs  POST  /admin/companies/:id/jobs
//     DELETE /admin/companies/:id/jobs/:jobId
//   Partner（来源机构数据维护，非企业 HR 后台）:
//     GET   /partner/companies
//     POST  /partner/companies/import   — 批量导入（默认 pending+draft）
//     PATCH /partner/companies/:id      — 编辑（强制回 pending+draft 重审）
//
// 合规（长期红线）：企业展示不是招聘平台——不收简历、无平台内投递、
// 无候选人/筛选/面试/Offer 能力；投递引导一律走既有「去来源平台投递」链路。
// ============================================================

@Controller()
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  // ── 公开（Kiosk）────────────────────────────────────────────────────────

  @Get('companies')
  async list(
    @Query('keyword') keyword?: string,
    @Query('province') province?: string,
    @Query('city') city?: string,
    @Query('district') district?: string,
    @Query('companyType') companyType?: string,
    @Query('industry') industry?: string,
    @Query('recruitType') recruitType?: string,
    @Query('sourceKind') sourceKind?: string,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ApiResponse.ok(await this.companies.listPublic(
      { keyword, province, city, district, companyType, industry, recruitType, sourceKind },
      parseMemberPageQuery(cursor, pageSize),
    ))
  }

  @Get('companies/stats')
  async stats(
    @Query('keyword') keyword?: string,
    @Query('province') province?: string,
    @Query('city') city?: string,
    @Query('district') district?: string,
    @Query('companyType') companyType?: string,
    @Query('industry') industry?: string,
    @Query('recruitType') recruitType?: string,
    @Query('sourceKind') sourceKind?: string,
  ) {
    return ApiResponse.ok(await this.companies.statsPublic(
      { keyword, province, city, district, companyType, industry, recruitType, sourceKind },
    ))
  }

  @Get('companies/filters')
  async filters() {
    return ApiResponse.ok(await this.companies.filtersPublic())
  }

  @Get('companies/:id')
  async detail(@Param('id') id: string) {
    return ApiResponse.ok(await this.companies.getPublic(id))
  }

  @Get('companies/:id/jobs')
  async companyJobs(
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ApiResponse.ok(await this.companies.listPublicJobs(id, parseMemberPageQuery(cursor, pageSize)))
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  @Get('admin/companies')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminList(
    @Query('reviewStatus') reviewStatus?: string,
    @Query('publishStatus') publishStatus?: string,
    @Query('keyword') keyword?: string,
  ) {
    return ApiResponse.ok(await this.companies.adminList({ reviewStatus, publishStatus, keyword }))
  }

  @Get('admin/companies/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminGet(@Param('id') id: string) {
    return ApiResponse.ok(await this.companies.adminGet(id))
  }

  @Post('admin/companies')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminCreate(@Body() dto: AdminCreateCompanyDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.companies.adminCreate(dto, user))
  }

  @Patch('admin/companies/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminUpdate(@Param('id') id: string, @Body() dto: AdminUpdateCompanyDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.companies.adminUpdate(id, dto, user))
  }

  @Patch('admin/companies/:id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminReview(@Param('id') id: string, @Body() dto: AdminReviewCompanyDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.companies.adminReview(id, dto, user))
  }

  @Patch('admin/companies/:id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminPublish(@Param('id') id: string, @Body() dto: AdminPublishCompanyDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.companies.adminPublish(id, dto, user))
  }

  @Get('admin/companies/:id/linkable-jobs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminLinkableJobs(@Param('id') id: string, @Query('keyword') keyword?: string) {
    return ApiResponse.ok(await this.companies.adminLinkableJobs(id, keyword))
  }

  @Post('admin/companies/:id/jobs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminLinkJobs(@Param('id') id: string, @Body() dto: AdminLinkJobsDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.companies.adminLinkJobs(id, dto, user))
  }

  @Delete('admin/companies/:id/jobs/:jobId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async adminUnlinkJob(@Param('id') id: string, @Param('jobId') jobId: string, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.companies.adminUnlinkJob(id, jobId, user))
  }

  // ── Partner（orgId 强制取自 JWT，绝不读 Body）────────────────────────────

  @Get('partner/companies')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  async partnerList(@CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.companies.partnerList(user.orgId!))
  }

  @Post('partner/companies/import')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  async partnerImport(@Body() dto: PartnerImportCompaniesDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.companies.partnerImport(user.orgId!, dto, user))
  }

  @Patch('partner/companies/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  async partnerUpdate(@Param('id') id: string, @Body() dto: PartnerUpdateCompanyDto, @CurrentUser() user: AuthedUser) {
    return ApiResponse.ok(await this.companies.partnerUpdate(user.orgId!, id, dto, user))
  }
}
