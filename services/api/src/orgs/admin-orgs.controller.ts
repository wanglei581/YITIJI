import { Body, Controller, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common'
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
import { BindAccountEmailDto } from './dto/bind-account-email.dto'
import { OrgContentTrustDto } from './dto/org-content-trust.dto'
import { AdminOrgContentTrustService } from './admin-org-content-trust.service'

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
 *   PUT    /admin/orgs/:id/accounts/:accountId/email    代绑/换绑登录邮箱（Admin 人工核验，无 SMTP）
 *   GET    /admin/orgs/:id/content-trust                内容信任状态（发布闸门读什么，这里就显示什么）
 *   PATCH  /admin/orgs/:id/content-trust                标记内容信任（active 才允许发布该机构内容）
 *
 * 合规:机构 = 外部数据来源方/运营协作方;启用模块白名单校验,招聘闭环模块硬拒绝。
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminOrgsController {
  constructor(
    private readonly orgs: AdminOrgsService,
    private readonly contentTrust: AdminOrgContentTrustService,
  ) {}

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

  /** 发布闸门读的就是这三个 reviewed 字段 + status,这里原样回显,不做美化。 */
  @Get('admin/orgs/:id/content-trust')
  getContentTrust(@Param('id') id: string) {
    return this.contentTrust.getContentTrust(id)
  }

  /** 标记内容信任。只有 active + 未归档的机构,其岗位/招聘会/政策/企业内容才允许发布。 */
  @Patch('admin/orgs/:id/content-trust')
  setContentTrust(@Param('id') id: string, @Body() dto: OrgContentTrustDto, @CurrentUser() user: AuthedUser) {
    return this.contentTrust.setContentTrust(id, dto, user)
  }

  @Put('admin/orgs/:id/accounts/:accountId/email')
  bindAccountEmail(
    @Param('id') id: string,
    @Param('accountId') accountId: string,
    @Body() dto: BindAccountEmailDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.orgs.bindAccountEmail(id, accountId, dto, user)
  }

}
