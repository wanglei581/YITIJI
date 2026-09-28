import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuditModule } from '../audit/audit.module'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RedisModule } from '../common/redis/redis.module'
import { RolesGuard } from '../common/guards/roles.guard'
import { SMS_SENDER } from '../member-auth/sms/sms-sender'
import { createBudgetedSmsSender } from '../member-auth/sms/sms-budget'
import { RedisService } from '../common/redis/redis.service'
import { PrismaModule } from '../prisma/prisma.module'
import { AdminInitialPhoneBindService } from './admin-initial-phone-bind.service'
import { AdminPhoneTransferService } from './admin-phone-transfer.service'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { InitialPhoneBindService } from './initial-phone-bind.service'
import { InternalOtpService } from './internal-otp.service'

const JWT_TTL = '24h'

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuditModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env['JWT_SECRET']
        if (!secret || secret.length < 16) {
          throw new Error(
            'JWT_SECRET 未配置或长度不足 16 字符。请在 services/api/.env 中设置一个强随机值。',
          )
        }
        return {
          secret,
          signOptions: { expiresIn: JWT_TTL },
        }
      },
    }),
  ],
  controllers: [AuthController],
  providers:   [
    AuthService,
    AdminInitialPhoneBindService,
    AdminPhoneTransferService,
    InitialPhoneBindService,
    InternalOtpService,
    JwtAuthGuard,
    RolesGuard,
    // P1-5：真实发送器外包额度层（全站每日总量 / 单终端每日上限），见 sms-budget.ts。
    { provide: SMS_SENDER, useFactory: createBudgetedSmsSender, inject: [RedisService] },
  ],
  exports:     [JwtModule, JwtAuthGuard, RolesGuard, AuthService, InternalOtpService],
})
export class AuthModule {}
