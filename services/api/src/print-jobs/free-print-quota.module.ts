import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { TerminalsModule } from '../terminals/terminals.module'
import { AdminPrintFreeQuotaController, KioskPrintQuotaController } from './free-print-quota.controller'
import { FreePrintQuotaService } from './free-print-quota.service'

@Module({
  imports: [JwtVerifierModule, AuthModule, TerminalsModule],
  controllers: [KioskPrintQuotaController, AdminPrintFreeQuotaController],
  providers: [FreePrintQuotaService],
  exports: [FreePrintQuotaService],
})
export class FreePrintQuotaModule {}
