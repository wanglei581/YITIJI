import { Module } from '@nestjs/common'
import { AdminOrgsService } from './admin-orgs.service'
import { AdminOrgsController } from './admin-orgs.controller'
import { PartnerOrgController } from './partner-org.controller'
import { PartnerStatsController } from './partner-stats.controller'
import { PartnerStatsService } from './partner-stats.service'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'

@Module({
  // AuthModule:导出 JwtAuthGuard / RolesGuard;AuditService 为 @Global 直接注入
  imports:     [PrismaModule, AuthModule],
  providers:   [AdminOrgsService, PartnerStatsService],
  controllers: [AdminOrgsController, PartnerOrgController, PartnerStatsController],
  exports:     [AdminOrgsService],
})
export class OrgsModule {}
