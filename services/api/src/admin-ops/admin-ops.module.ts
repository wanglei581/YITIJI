import { Module } from '@nestjs/common'
import { AdminAlertActionsService } from './admin-alert-actions.service'
import { AdminOpsService } from './admin-ops.service'
import { AdminOpsController } from './admin-ops.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports:     [PrismaModule, AuthModule],
  providers:   [AdminOpsService, AdminAlertActionsService],
  controllers: [AdminOpsController],
  exports:     [AdminOpsService],
})
export class AdminOpsModule {}
