import { Module } from '@nestjs/common'
import { EndUserAuthGuard } from '../../common/guards/end-user-auth.guard'
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'
import { RolesGuard } from '../../common/guards/roles.guard'
import { JwtVerifierModule } from '../../common/jwt-verifier.module'
import { TerminalsModule } from '../../terminals/terminals.module'
import { AiQuotaController } from './ai-quota.controller'
import { AiQuotaService } from './ai-quota.service'

@Module({
  imports: [JwtVerifierModule, TerminalsModule],
  controllers: [AiQuotaController],
  providers: [AiQuotaService, EndUserAuthGuard, JwtAuthGuard, RolesGuard],
  exports: [AiQuotaService],
})
export class AiQuotaModule {}
