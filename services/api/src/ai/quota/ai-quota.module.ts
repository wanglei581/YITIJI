import { Module } from '@nestjs/common'
import { AuditModule } from '../../audit/audit.module'
import { EndUserAuthGuard } from '../../common/guards/end-user-auth.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { JwtVerifierModule } from '../../common/jwt-verifier.module'
import { RedisModule } from '../../common/redis/redis.module'
import { PrismaModule } from '../../prisma/prisma.module'
import { TerminalsModule } from '../../terminals/terminals.module'
import { AdminAiQuotaLimitController } from './admin-ai-quota-limit.controller'
import { AiQuotaController } from './ai-quota.controller'
import { AiQuotaLimitService } from './ai-quota-limit.service'
import { AiQuotaService } from './ai-quota.service'

@Module({
  imports: [JwtVerifierModule, TerminalsModule, AuditModule, PrismaModule, RedisModule],
  controllers: [AiQuotaController, AdminAiQuotaLimitController],
  providers: [AiQuotaLimitService, AiQuotaService, EndUserAuthGuard, JwtAuthGuard, RolesGuard],
  exports: [AiQuotaService, AiQuotaLimitService],
})
export class AiQuotaModule {}
