import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { TerminalsController } from './terminals.controller'
import { AdminTerminalsController } from './admin-terminals.controller'
import { AdminPrintersController } from './admin-printers.controller'
import { AdminToolboxController } from './admin-toolbox.controller'
import { TerminalsService } from './terminals.service'
import { TerminalToolboxService } from './terminal-toolbox.service'

@Module({
  // JwtModule：AdminTerminalsController 的 JwtAuthGuard 需要 JwtService。
  // 与 files/audit 模块一致：fail-closed 异步注册，secret 取自 JWT_SECRET（缺失/过短即拒启动）。
  imports: [
    JwtVerifierModule,
  ],
  controllers: [TerminalsController, AdminTerminalsController, AdminPrintersController, AdminToolboxController],
  providers: [TerminalsService, TerminalToolboxService],
  exports: [TerminalsService, TerminalToolboxService],
})
export class TerminalsModule {}
