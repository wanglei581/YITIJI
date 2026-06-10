import { Module } from '@nestjs/common'
import { AdminOpsService } from './admin-ops.service'
import { AdminOpsController } from './admin-ops.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  imports:     [PrismaModule, AuthModule],
  providers:   [AdminOpsService],
  controllers: [AdminOpsController],
  exports:     [AdminOpsService],
})
export class AdminOpsModule {}
