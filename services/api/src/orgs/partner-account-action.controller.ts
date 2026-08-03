import {
  Body,
  Controller,
  Delete,
  Headers,
  HttpCode,
  Ip,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { PartnerAccountActionService } from '../auth/partner-account-action.service'
import { PartnerPhoneRebindService } from '../auth/partner-phone-rebind.service'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import {
  CreatePartnerAccountActionChallengeDto,
  ResendPartnerPhoneRebindDto,
  StartPartnerPhoneRebindDto,
  VerifyPartnerAccountActionChallengeDto,
  VerifyPartnerPhoneRebindDto,
} from './dto/partner-account-action.dto'

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Throttle({ default: { ttl: 60_000, limit: 30 } })
export class PartnerAccountActionController {
  constructor(
    private readonly actions: PartnerAccountActionService,
    private readonly phoneRebind: PartnerPhoneRebindService,
  ) {}

  @Post('admin/orgs/:orgId/accounts/:accountId/action-challenges')
  createChallenge(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Body() dto: CreatePartnerAccountActionChallengeDto,
    @Ip() ip: string,
  ) {
    return this.actions.createChallenge(user, orgId, accountId, dto, { ip, deviceId: dto.deviceId })
  }

  @Post('admin/orgs/:orgId/accounts/:accountId/action-challenges/:challengeId/verify')
  verifyChallenge(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Param('challengeId') challengeId: string,
    @Body() dto: VerifyPartnerAccountActionChallengeDto,
  ) {
    return this.actions.verifyChallenge(user, orgId, accountId, challengeId, dto)
  }

  @Delete('admin/orgs/:orgId/accounts/:accountId/action-challenges/:challengeId')
  @HttpCode(204)
  async cancelChallenge(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Param('challengeId') challengeId: string,
  ): Promise<void> {
    await this.actions.cancelChallenge(user, orgId, accountId, challengeId)
  }

  @Delete('admin/orgs/:orgId/accounts/:accountId/action-tickets/current')
  @HttpCode(204)
  async revokeActionTicket(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Headers('x-account-action-ticket') ticket: string | undefined,
  ): Promise<void> {
    await this.actions.revokeActionTicket(user, orgId, accountId, ticket)
  }

  @Post('admin/orgs/:orgId/accounts/:accountId/phone-rebind/start')
  startPhoneRebind(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Headers('x-account-action-ticket') ticket: string | undefined,
    @Body() dto: StartPartnerPhoneRebindDto,
    @Ip() ip: string,
  ) {
    return this.phoneRebind.start(user, orgId, accountId, ticket, dto.newPhone, { ip, deviceId: dto.deviceId })
  }

  @Post('admin/orgs/:orgId/accounts/:accountId/phone-rebind/resend-new')
  resendNewPhone(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Headers('x-phone-rebind-ticket') ticket: string | undefined,
    @Body() dto: ResendPartnerPhoneRebindDto,
    @Ip() ip: string,
  ) {
    return this.phoneRebind.resend(user, orgId, accountId, ticket, { ip, deviceId: dto.deviceId })
  }

  @Post('admin/orgs/:orgId/accounts/:accountId/phone-rebind/verify')
  verifyNewPhone(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Headers('x-phone-rebind-ticket') ticket: string | undefined,
    @Body() dto: VerifyPartnerPhoneRebindDto,
  ) {
    return this.phoneRebind.verify(user, orgId, accountId, ticket, dto.code)
  }

  @Delete('admin/orgs/:orgId/accounts/:accountId/phone-rebind/current')
  @HttpCode(204)
  async revokeRebindTicket(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Headers('x-phone-rebind-ticket') ticket: string | undefined,
  ): Promise<void> {
    await this.phoneRebind.revoke(user, orgId, accountId, ticket)
  }

  @Delete('admin/orgs/:orgId/accounts/:accountId')
  deleteAccount(
    @CurrentUser() user: AuthedUser,
    @Param('orgId') orgId: string,
    @Param('accountId') accountId: string,
    @Headers('x-account-action-ticket') ticket: string | undefined,
  ) {
    return this.actions.deleteAccount(user, orgId, accountId, ticket)
  }
}
