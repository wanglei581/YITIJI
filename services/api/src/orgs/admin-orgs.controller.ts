import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { AdminOrgsService } from './admin-orgs.service'
import {
  AccountStatusDto,
  CreateOrgDto,
  OrgAccountInputDto,
  OrgStatusDto,
  ResetAccountPasswordDto,
  UpdateOrgDto,
} from './dto/admin-org.dto'

/**
 * Admin 合作机构管理(阶段1B)。
 *
 * 路由表(全部含 /api/v1 前缀,全部 Bearer + admin):
 *   GET    /admin/orgs                                  机构列表(含账号/数据源/岗位/招聘会计数)
 *   POST   /admin/orgs                                  新增机构(可选同时开通首个 partner 账号)
 *   GET    /admin/orgs/:id                              机构详情(含账号列表,无任何密码信息)
 *   PATCH  /admin/orgs/:id                              编辑机构档案(名称/类型/联系人/场景模板/启用模块)
 *   PATCH  /admin/orgs/:id/status                       授权启停(disable → 登录与导入双拒)
 *   POST   /admin/orgs/:id/accounts                     新增机构账号
 *   PATCH  /admin/orgs/:id/accounts/:accountId/status   账号启停
 *   PATCH  /admin/orgs/:id/accounts/:accountId/password 重置账号密码
 *
 * 合规:机构 = 外部数据来源方/运营协作方;启用模块白名单校验,招聘闭环模块硬拒绝。
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminOrgsController {
  constructor(private readonly orgs: AdminOrgsService) {}

  @Get('admin/orgs')
  listOrgs() {
    return this.orgs.listOrgs()
  }

  @Post('admin/orgs')
  createOrg(@Body() dto: CreateOrgDto, @CurrentUser() user: AuthedUser) {
    return this.orgs.createOrg(dto, user)
  }

  @Get('admin/orgs/:id')
  getOrgDetail(@Param('id') id: string) {
    return this.orgs.getOrgDetail(id)
  }

  @Patch('admin/orgs/:id')
  updateOrg(@Param('id') id: string, @Body() dto: UpdateOrgDto, @CurrentUser() user: AuthedUser) {
    return this.orgs.updateOrg(id, dto, user)
  }

  @Patch('admin/orgs/:id/status')
  setOrgStatus(@Param('id') id: string, @Body() dto: OrgStatusDto, @CurrentUser() user: AuthedUser) {
    return this.orgs.setOrgStatus(id, dto.action, user)
  }

  @Post('admin/orgs/:id/accounts')
  createAccount(@Param('id') id: string, @Body() dto: OrgAccountInputDto, @CurrentUser() user: AuthedUser) {
    return this.orgs.createAccount(id, dto, user)
  }

  @Patch('admin/orgs/:id/accounts/:accountId/status')
  setAccountStatus(
    @Param('id') id: string,
    @Param('accountId') accountId: string,
    @Body() dto: AccountStatusDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.orgs.setAccountStatus(id, accountId, dto.action, user)
  }

  @Patch('admin/orgs/:id/accounts/:accountId/password')
  resetAccountPassword(
    @Param('id') id: string,
    @Param('accountId') accountId: string,
    @Body() dto: ResetAccountPasswordDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.orgs.resetAccountPassword(id, accountId, dto.password, user)
  }

}
