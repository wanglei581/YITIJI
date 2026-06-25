import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { TerminalsController } from './terminals.controller'
import { AdminTerminalsController } from './admin-terminals.controller'
import { AdminPrintersController } from './admin-printers.controller'
import { TerminalsService } from './terminals.service'

@Module({
  // JwtModule：AdminTerminalsController 的 JwtAuthGuard 需要 JwtService。
  // 与 files/audit 模块一致：fail-closed 异步注册，secret 取自 JWT_SECRET（缺失/过短即拒启动）。
  imports: [
    JwtVerifierModule,
  ],
  controllers: [TerminalsController, AdminTerminalsController, AdminPrintersController],
  providers: [TerminalsService],
  exports: [TerminalsService],
})
export class TerminalsModule {}
