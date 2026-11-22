import { Body, Controller, Headers, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { ApiResponse } from '../common/dto/api-response.dto'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { TerminalScopedThrottle } from '../common/throttler/terminal-throttle'
import { TerminalIdentityGuard } from '../terminals/terminal-identity.guard'
import { RedeemMiniappCreditDto } from './dto/redeem-credit.dto'
import { VirtualPayCreditRedeemService } from './virtual-pay-credit-redeem.service'

/**
 * 一体机核销小程序已购虚拟支付权益：同时验终端身份与会员登录态。
 */
@Controller('kiosk/service-orders')
@UseGuards(TerminalIdentityGuard, EndUserAuthGuard)
export class VirtualPayCreditRedeemController {
  constructor(private readonly redeemService: VirtualPayCreditRedeemService) {}

  @Post('redeem-credit')
  @HttpCode(HttpStatus.OK)
  @TerminalScopedThrottle(10)
  async redeem(
    @Headers('x-terminal-id') terminalId: string,
    @CurrentEndUser() user: AuthedEndUser,
    @Body() dto: RedeemMiniappCreditDto,
  ) {
    return ApiResponse.ok(await this.redeemService.redeem(terminalId, user.endUserId, dto))
  }
}
