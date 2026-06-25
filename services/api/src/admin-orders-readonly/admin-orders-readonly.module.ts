import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { PrismaModule } from '../prisma/prisma.module'
import { AdminOrdersReadonlyController } from './admin-orders-readonly.controller'
import { AdminOrdersReadonlyService } from './admin-orders-readonly.service'

@Module({
  imports: [PrismaModule, AuthModule],
  providers: [AdminOrdersReadonlyService],
  controllers: [AdminOrdersReadonlyController],
  exports: [AdminOrdersReadonlyService],
})
export class AdminOrdersReadonlyModule {}
