import { Module } from '@nestjs/common'
import { MiniappAccessTokenModule } from '../miniapp-access-token/miniapp-access-token.module'
import { VirtualPayAdminController } from './virtual-pay-admin.controller'
import { VirtualPayAdminService } from './virtual-pay-admin.service'
import { VirtualPayCreditsController } from './virtual-pay-credits.controller'
import { VirtualPayCreditsService } from './virtual-pay-credits.service'
import { VirtualPayOrderController } from './virtual-pay-order.controller'
import { VirtualPayOrderService } from './virtual-pay-order.service'
import { VirtualPayReconcileService } from './virtual-pay-reconcile.service'
import { WechatMiniappMessageController } from './wechat-miniapp-message.controller'
import { WechatMiniappMessageService } from './wechat-miniapp-message.service'

@Module({
  imports: [MiniappAccessTokenModule],
  controllers: [
    VirtualPayAdminController,
    VirtualPayOrderController,
    VirtualPayCreditsController,
    WechatMiniappMessageController,
  ],
  providers: [
    VirtualPayAdminService,
    VirtualPayOrderService,
    VirtualPayCreditsService,
    WechatMiniappMessageService,
    VirtualPayReconcileService,
  ],
})
export class VirtualPayModule {}
