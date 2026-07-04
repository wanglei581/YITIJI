import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { BenefitRedemptionService } from './benefit-redemption.service'
import { RedeemOrderDto } from './dto/redeem-order.dto'

/**
 * C5-4 订单核销端点（会员本人，幂等）。路由 /api/v1/orders/:id/redeem。
 *
 * 受 EndUserAuthGuard 保护：endUserId 来自校验后的 token，service 只按本人订单核销，
 * 跨用户越权天然不可能。**仅后端能力 + 端点**：Kiosk / 会员前端本波不加「使用券抵扣 / 核销」
 * 用户可操作入口（对齐用户定版硬约束 6）。
 *
 * 合规：券 = 平台 credit / 权益，**非资金、非真实收款**；全额核销单联动 paid(voucher)，
 * 不承诺补贴到账；核销账本沿用既有 RedemptionRecord（禁重建第二套账本）。
 */
@Controller()
@UseGuards(EndUserAuthGuard)
export class OrderRedeemController {
  constructor(private readonly redemption: BenefitRedemptionService) {}

  @Post('orders/:id/redeem')
  @HttpCode(HttpStatus.OK)
  async redeem(@Param('id') id: string, @Body() body: RedeemOrderDto, @CurrentEndUser() user: AuthedEndUser) {
    return ApiResponse.ok(
      await this.redemption.redeemForOrder({
        endUserId: user.endUserId,
        orderId: id,
        benefitGrantId: body.benefitGrantId,
      }),
    )
  }
}
