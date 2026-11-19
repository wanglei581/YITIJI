import { Module } from '@nestjs/common'
import { VirtualPayAdminController } from './virtual-pay-admin.controller'
import { VirtualPayAdminService } from './virtual-pay-admin.service'
import { VirtualPayOrderController } from './virtual-pay-order.controller'
import { VirtualPayOrderService } from './virtual-pay-order.service'

@Module({
  controllers: [VirtualPayAdminController, VirtualPayOrderController],
  providers: [VirtualPayAdminService, VirtualPayOrderService],
})
export class VirtualPayModule {}
