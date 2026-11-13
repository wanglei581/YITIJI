import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { IsString, MaxLength } from 'class-validator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { OrgDeviceAlertWebhookService } from './org-device-alert-webhook.service'

export class SaveDeviceAlertWebhookDto {
  @IsString({ message: '请填写通知地址' })
  @MaxLength(500, { message: '通知地址过长' })
  url!: string
}

interface ReqLike {
  headers?: Record<string, string | string[] | undefined>
  ip?: string
  requestId?: string
}

/** 机构只能读写自己的通知地址。orgId 来自登录态，不接受请求里的机构编号。 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class PartnerDeviceAlertNotifyController {
  constructor(private readonly webhooks: OrgDeviceAlertWebhookService) {}

  @Get('partner/device-alert-notify')
  view(@CurrentUser() user: AuthedUser) {
    return this.webhooks.viewForPartner(user)
  }

  @Put('partner/device-alert-notify')
  save(@CurrentUser() user: AuthedUser, @Body() dto: SaveDeviceAlertWebhookDto, @Req() req: ReqLike) {
    return this.webhooks.saveForPartner(user, dto.url, req)
  }

  @Post('partner/device-alert-notify/test')
  test(@CurrentUser() user: AuthedUser, @Req() req: ReqLike) {
    return this.webhooks.testForPartner(user, req)
  }
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminDeviceAlertNotifyController {
  constructor(private readonly webhooks: OrgDeviceAlertWebhookService) {}

  @Get('admin/orgs/:id/device-alert-notify')
  view(@Param('id') id: string) {
    return this.webhooks.viewForAdmin(id)
  }

  @Put('admin/orgs/:id/device-alert-notify')
  save(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Body() dto: SaveDeviceAlertWebhookDto,
    @Req() req: ReqLike,
  ) {
    return this.webhooks.saveForAdmin(user, id, dto.url, req)
  }

  @Post('admin/orgs/:id/device-alert-notify/test')
  test(@CurrentUser() user: AuthedUser, @Param('id') id: string, @Req() req: ReqLike) {
    return this.webhooks.testForAdmin(user, id, req)
  }
}
