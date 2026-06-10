import { Module } from '@nestjs/common'
import { PoliciesService } from './policies.service'
import { PoliciesController } from './policies.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  // AuthModule:导出 JwtAuthGuard / RolesGuard;AuditService 为 @Global 直接注入
  imports:     [PrismaModule, AuthModule],
  providers:   [PoliciesService],
  controllers: [PoliciesController],
  exports:     [PoliciesService],
})
export class PoliciesModule {}
