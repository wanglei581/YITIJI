import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { createSmsSender, SMS_SENDER } from '../member-auth/sms/sms-sender'
import { PrismaModule } from '../prisma/prisma.module'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { InitialPhoneBindService } from './initial-phone-bind.service'
import { InternalOtpService } from './internal-otp.service'

const JWT_TTL = '24h'

@Module({
  imports: [
    PrismaModule,
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
    InitialPhoneBindService,
    InternalOtpService,
    JwtAuthGuard,
    RolesGuard,
    { provide: SMS_SENDER, useFactory: createSmsSender },
  ],
  exports:     [JwtModule, JwtAuthGuard, RolesGuard, AuthService],
})
export class AuthModule {}
