import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { requestAuditContext } from '../common/request-audit-context'
import {
  CreateLicenseDto,
  LicenseResumeDto,
  LicenseStatusChangeDto,
  RenewLicenseDto,
  SetLicenseModeDto,
  UpdateLicenseDto,
} from './dto/license.dto'
import { LicenseService, type LicenseActor } from './license.service'

function actorOf(user: AuthedUser, req: unknown): LicenseActor {
  return { userId: user.userId, role: user.role, ...requestAuditContext(req) }
}

/**
 * 管理员：软件使用授权（授权给哪家企业、期限、终端台数、到期停用）。全部 Bearer + admin，写操作全部审计。
 * 期限按合同口径「含到期日」、北京时间：请求收 startsOn / endsOn（YYYY-MM-DD，都含当天）。
 *
 *   GET  /api/v1/admin/licenses/attention        工作台「今天要处理」：30 天内到期 / 宽限中 / 已停用
 *   GET  /api/v1/admin/licenses/:id              一条授权
 *   GET  /api/v1/admin/orgs/:orgId/licenses      机构的授权一节：概览 + 全部历史
 *   POST /api/v1/admin/orgs/:orgId/licenses      新建（可提前录入未来生效的）：licenseeName / creditCode / contractNo 必填
 *   PATCH /api/v1/admin/licenses/:id             更正 / 改期 / 改台数（吊销后不可改）：version、reason 必填
 *   POST /api/v1/admin/licenses/:id/renew        续期：新建首尾相接的后续授权；licenseeName / creditCode / contractNo 必填，startsOn 可省
 *   POST /api/v1/admin/licenses/:id/suspend      暂停：version、reason、approvalTicketNo 必填
 *   POST /api/v1/admin/licenses/:id/resume       恢复（只对已暂停）：version、reason 必填
 *   POST /api/v1/admin/licenses/:id/revoke       吊销（不可恢复）：version、reason、approvalTicketNo 必填
 *   PUT  /api/v1/admin/orgs/:orgId/license-mode  授权方式 none / required：reason 必填；切到 required 且会锁住终端时需 confirmLockout
 * version 对不上回 409 LICENSE_VERSION_CONFLICT（有人先改过了，刷新后重来）。
 * 写操作统一返回 { licenseId, org }：被改动的那条的编号 + 刷新后的整个机构授权一节。
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class LicenseAdminController {
  constructor(private readonly licenses: LicenseService) {}

  // 注意：attention 必须声明在 :id 之前，否则会被当成编号。
  @Get('admin/licenses/attention')
  async attention() {
    return { success: true as const, data: await this.licenses.listAttention() }
  }

  @Get('admin/licenses/:id')
  async getOne(@Param('id') id: string) {
    return { success: true as const, data: await this.licenses.getLicense(id) }
  }

  @Get('admin/orgs/:orgId/licenses')
  async orgDetail(@Param('orgId') orgId: string) {
    return { success: true as const, data: await this.licenses.getOrgDetail(orgId) }
  }

  @Post('admin/orgs/:orgId/licenses')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateLicenseDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: unknown,
  ) {
    return { success: true as const, data: await this.licenses.create(orgId, dto, actorOf(user, req)) }
  }

  @Patch('admin/licenses/:id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateLicenseDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: unknown,
  ) {
    return { success: true as const, data: await this.licenses.update(id, dto, actorOf(user, req)) }
  }

  @Post('admin/licenses/:id/renew')
  @HttpCode(HttpStatus.CREATED)
  async renew(
    @Param('id') id: string,
    @Body() dto: RenewLicenseDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: unknown,
  ) {
    return { success: true as const, data: await this.licenses.renew(id, dto, actorOf(user, req)) }
  }

  @Post('admin/licenses/:id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspend(
    @Param('id') id: string,
    @Body() dto: LicenseStatusChangeDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: unknown,
  ) {
    return { success: true as const, data: await this.licenses.suspend(id, dto, actorOf(user, req)) }
  }

  @Post('admin/licenses/:id/resume')
  @HttpCode(HttpStatus.OK)
  async resume(
    @Param('id') id: string,
    @Body() dto: LicenseResumeDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: unknown,
  ) {
    return { success: true as const, data: await this.licenses.resume(id, dto, actorOf(user, req)) }
  }

  @Post('admin/licenses/:id/revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Param('id') id: string,
    @Body() dto: LicenseStatusChangeDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: unknown,
  ) {
    return { success: true as const, data: await this.licenses.revoke(id, dto, actorOf(user, req)) }
  }

  @Put('admin/orgs/:orgId/license-mode')
  async setMode(
    @Param('orgId') orgId: string,
    @Body() dto: SetLicenseModeDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: unknown,
  ) {
    return { success: true as const, data: await this.licenses.setMode(orgId, dto, actorOf(user, req)) }
  }
}
