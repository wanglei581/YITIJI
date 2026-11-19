import { Module } from '@nestjs/common'
import { VirtualPayAdminController } from './virtual-pay-admin.controller'
import { VirtualPayAdminService } from './virtual-pay-admin.service'

@Module({
  controllers: [VirtualPayAdminController],
  providers: [VirtualPayAdminService],
})
export class VirtualPayModule {}
