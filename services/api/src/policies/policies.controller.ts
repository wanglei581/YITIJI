import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { PoliciesService } from './policies.service'
import { CreatePolicyPostDto, UpdatePolicyPostDto } from './dto/policy.dto'
import { ReviewActionDto } from '../jobs/dto/review.dto'
import { PublishActionDto } from '../jobs/dto/publish.dto'

/**
 * 政策服务(阶段1D)。
 *
 * 路由表(全部含 /api/v1 前缀):
 *   Kiosk(公开,只读 approved+published):
 *     GET    /policies?kind=&audience=&category=
 *   Partner(Bearer + partner,本机构):
 *     GET    /partner/policies
 *     POST   /partner/policies                    新增(默认 pending+draft)
 *     PATCH  /partner/policies/:id                编辑(强制回 pending+draft 重审)
 *     PATCH  /partner/policies/:id/publish        下架(unpublish)
 *     DELETE /partner/policies/:id                删除(留审计)
 *   Admin(Bearer + admin):
 *     GET    /admin/policy-sources                全量(含审核/发布状态)
 *     PATCH  /admin/policy-sources/:id/review     审核(approve/reject/reviewing)
 *     PATCH  /admin/policy-sources/:id/publish    发布/下架
 *
 * 合规:info-only;政策内容只做说明 + 官方入口,不承诺补贴到账、不代申请。
 */
@Controller()
export class PoliciesController {
  constructor(private readonly policies: PoliciesService) {}

  // ── Kiosk(公开)──────────────────────────────────────────────────────────

  @Get('policies')
  getPolicies(
    @Query('kind') kind?: string,
    @Query('audience') audience?: string,
    @Query('category') category?: string,
  ) {
    return this.policies.getPublishedPolicies({ kind, audience, category })
  }

  // ── Partner ─────────────────────────────────────────────────────────────────

  @Get('partner/policies')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  getPartnerPolicies(@CurrentUser() user: AuthedUser) {
    return this.policies.getPartnerPolicies(user)
  }

  @Post('partner/policies')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  createPartnerPolicy(@Body() dto: CreatePolicyPostDto, @CurrentUser() user: AuthedUser) {
    return this.policies.createPartnerPolicy(dto, user)
  }

  @Patch('partner/policies/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  updatePartnerPolicy(@Param('id') id: string, @Body() dto: UpdatePolicyPostDto, @CurrentUser() user: AuthedUser) {
    return this.policies.updatePartnerPolicy(id, dto, user)
  }

  @Patch('partner/policies/:id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  unpublishPartnerPolicy(@Param('id') id: string, @Body() _dto: PublishActionDto, @CurrentUser() user: AuthedUser) {
    return this.policies.unpublishPartnerPolicy(id, user)
  }

  @Delete('partner/policies/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('partner')
  deletePartnerPolicy(@Param('id') id: string, @CurrentUser() user: AuthedUser) {
    return this.policies.deletePartnerPolicy(id, user)
  }

  // ── Admin ───────────────────────────────────────────────────────────────────

  @Get('admin/policy-sources')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getPolicySources() {
    return this.policies.getAllPolicySources()
  }

  @Patch('admin/policy-sources/:id/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  reviewPolicy(@Param('id') id: string, @Body() dto: ReviewActionDto, @CurrentUser() user: AuthedUser) {
    return this.policies.reviewPolicy(id, dto.action, dto.reason, user)
  }

  @Patch('admin/policy-sources/:id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  publishPolicy(@Param('id') id: string, @Body() dto: PublishActionDto, @CurrentUser() user: AuthedUser) {
    return this.policies.publishPolicy(id, dto.action, user)
  }
}
