import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { MiniappAccessTokenModule } from '../miniapp-access-token/miniapp-access-token.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { VirtualPayAdminController } from './virtual-pay-admin.controller'
import { VirtualPayAdminService } from './virtual-pay-admin.service'
import { VirtualPayCreditRedeemController } from './virtual-pay-credit-redeem.controller'
import { VirtualPayCreditRedeemService } from './virtual-pay-credit-redeem.service'
import { VirtualPayCreditsController } from './virtual-pay-credits.controller'
import { VirtualPayCreditsService } from './virtual-pay-credits.service'
import { VirtualPayOrderController } from './virtual-pay-order.controller'
import { VirtualPayOrderService } from './virtual-pay-order.service'
import { VirtualPayReconcileService } from './virtual-pay-reconcile.service'
import { VirtualPayRefundService } from './virtual-pay-refund.service'
import { WechatMiniappMessageController } from './wechat-miniapp-message.controller'
import { WechatMiniappMessageService } from './wechat-miniapp-message.service'

@Module({
  imports: [JwtVerifierModule, MiniappAccessTokenModule, TerminalsModule],
  controllers: [
    VirtualPayAdminController,
    VirtualPayOrderController,
    VirtualPayCreditsController,
    VirtualPayCreditRedeemController,
    WechatMiniappMessageController,
  ],
  providers: [
    VirtualPayAdminService,
    VirtualPayOrderService,
    VirtualPayCreditsService,
    VirtualPayCreditRedeemService,
    VirtualPayRefundService,
    WechatMiniappMessageService,
    VirtualPayReconcileService,
  ],
})
export class VirtualPayModule {}
