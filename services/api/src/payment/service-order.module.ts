import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { PaymentModule } from './payment.module'
import { ServiceOrderAdminController } from './service-order-admin.controller'
import { ServiceOrderController } from './service-order.controller'
import { ServiceOrderService } from './service-order.service'
import { ServiceOrderTask } from './service-order.task'

@Module({
  imports: [PaymentModule, TerminalsModule, AuthModule],
  controllers: [ServiceOrderController, ServiceOrderAdminController],
  providers: [ServiceOrderService, ServiceOrderTask],
  exports: [ServiceOrderService],
})
export class ServiceOrderModule {}
