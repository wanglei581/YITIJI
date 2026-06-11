import { Module } from '@nestjs/common'
import { AdminOrgsService } from './admin-orgs.service'
import { AdminOrgsController } from './admin-orgs.controller'
import { PartnerOrgController } from './partner-org.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  // AuthModule:导出 JwtAuthGuard / RolesGuard;AuditService 为 @Global 直接注入
  imports:     [PrismaModule, AuthModule],
  providers:   [AdminOrgsService],
  controllers: [AdminOrgsController, PartnerOrgController],
  exports:     [AdminOrgsService],
})
export class OrgsModule {}
