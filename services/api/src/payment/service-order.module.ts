import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { TerminalsModule } from '../terminals/terminals.module'
import { MemberServiceOrderController } from './member-service-order.controller'
import { MemberServiceOrderService } from './member-service-order.service'
import { PaymentModule } from './payment.module'
import { ServiceOrderAdminController } from './service-order-admin.controller'
import { ServiceOrderSandboxController } from './service-order-sandbox.controller'
import { ServiceOrderController } from './service-order.controller'
import { ServiceOrderService } from './service-order.service'
import { ServiceOrderTask } from './service-order.task'

@Module({
  imports: [PaymentModule, TerminalsModule, AuthModule],
  // 沙箱模拟付成只给开发与联调：生产 404，只认沙箱通道（见控制器头注释）。
  controllers: [
    ServiceOrderController,
    ServiceOrderAdminController,
    ServiceOrderSandboxController,
    MemberServiceOrderController,
  ],
  providers: [ServiceOrderService, ServiceOrderTask, MemberServiceOrderService, EndUserAuthGuard],
  exports: [ServiceOrderService, MemberServiceOrderService],
})
export class ServiceOrderModule {}
