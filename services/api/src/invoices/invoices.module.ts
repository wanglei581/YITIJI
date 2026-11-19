import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { TerminalsModule } from '../terminals/terminals.module'
import { InvoiceRequestsService } from './invoice-requests.service'
import { InvoiceSessionsService } from './invoice-sessions.service'
import { KioskInvoiceSessionsController } from './kiosk-invoice-sessions.controller'

@Module({
  imports: [
    TerminalsModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env['JWT_SECRET']
        if (!secret || secret.length < 16) {
          throw new Error('JWT_SECRET 未配置或长度不足 16 字符。请在 services/api/.env 中设置一个强随机值。')
        }
        return { secret, signOptions: { expiresIn: '30m' as const, audience: 'enduser' } }
      },
    }),
  ],
  controllers: [KioskInvoiceSessionsController],
  providers: [InvoiceRequestsService, InvoiceSessionsService, EndUserAuthGuard],
  exports: [InvoiceRequestsService, InvoiceSessionsService],
})
export class InvoicesModule {}
