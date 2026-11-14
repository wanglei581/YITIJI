import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { ServiceOrderModule } from '../payment/service-order.module'
import { PrismaModule } from '../prisma/prisma.module'
import { AdminOrdersReadonlyController } from './admin-orders-readonly.controller'
import { AdminOrdersReadonlyService } from './admin-orders-readonly.service'

@Module({
  imports: [PrismaModule, AuthModule, ServiceOrderModule],
  providers: [AdminOrdersReadonlyService],
  controllers: [AdminOrdersReadonlyController],
  exports: [AdminOrdersReadonlyService],
})
export class AdminOrdersReadonlyModule {}
