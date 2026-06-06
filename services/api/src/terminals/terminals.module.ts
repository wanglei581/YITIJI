import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { TerminalsController } from './terminals.controller'
import { AdminTerminalsController } from './admin-terminals.controller'
import { AdminPrintersController } from './admin-printers.controller'
import { TerminalsService } from './terminals.service'

@Module({
  // JwtModule：AdminTerminalsController 的 JwtAuthGuard 需要 JwtService。
  // 与 files/audit 模块一致：本地 register，secret 取自 JWT_SECRET。
  imports: [
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-only-secret',
    }),
  ],
  controllers: [TerminalsController, AdminTerminalsController, AdminPrintersController],
  providers: [TerminalsService],
})
export class TerminalsModule {}
