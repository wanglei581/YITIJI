import { Module } from '@nestjs/common'
import { AdminOrgsService } from './admin-orgs.service'
import { AdminOrgContentTrustService } from './admin-org-content-trust.service'
import { AdminOrgsController } from './admin-orgs.controller'
import { PartnerOrgController } from './partner-org.controller'
import { PartnerStatsController } from './partner-stats.controller'
import { PartnerStatsService } from './partner-stats.service'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthModule } from '../auth/auth.module'
import { RedisModule } from '../common/redis/redis.module'
import { PartnerAccountActionService } from '../auth/partner-account-action.service'
import { PartnerPhoneRebindService } from '../auth/partner-phone-rebind.service'
import { PartnerAccountActionController } from './partner-account-action.controller'

@Module({
  // AuthModule:导出 JwtAuthGuard / RolesGuard;AuditService 为 @Global 直接注入
  imports:     [PrismaModule, RedisModule, AuthModule],
  providers:   [AdminOrgsService, AdminOrgContentTrustService, PartnerStatsService, PartnerAccountActionService, PartnerPhoneRebindService],
  controllers: [AdminOrgsController, PartnerOrgController, PartnerStatsController, PartnerAccountActionController],
  exports:     [AdminOrgsService],
})
export class OrgsModule {}
