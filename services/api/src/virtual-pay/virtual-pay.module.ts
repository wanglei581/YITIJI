import { Module } from '@nestjs/common'
import { VirtualPayAdminController } from './virtual-pay-admin.controller'
import { VirtualPayAdminService } from './virtual-pay-admin.service'
import { VirtualPayOrderController } from './virtual-pay-order.controller'
import { VirtualPayOrderService } from './virtual-pay-order.service'
import { WechatMiniappMessageController } from './wechat-miniapp-message.controller'
import { WechatMiniappMessageService } from './wechat-miniapp-message.service'

@Module({
  controllers: [VirtualPayAdminController, VirtualPayOrderController, WechatMiniappMessageController],
  providers: [VirtualPayAdminService, VirtualPayOrderService, WechatMiniappMessageService],
})
export class VirtualPayModule {}
