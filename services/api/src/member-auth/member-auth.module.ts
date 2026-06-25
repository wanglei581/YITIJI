import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { TerminalsModule } from '../terminals/terminals.module'
import { MemberAuthController } from './member-auth.controller'
import { MemberAuthService } from './member-auth.service'
import { MemberQrLoginService } from './member-qr-login.service'
import { createSmsSender, SMS_SENDER } from './sms/sms-sender'

/**
 * C 端求职者账号模块(阶段 A)。
 *
 * 独立注册 JwtModule:与内部 AuthModule 共用 JWT_SECRET,但签发的 token 带
 * audience='enduser' + 30 分钟过期,EndUserAuthGuard verify 时校验 aud,
 * 内部 JwtAuthGuard 则拒绝 aud='enduser' 的 token —— 双向隔离。
 *
 * PrismaService / RedisService 均为 @Global,无需在此 import。
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env['JWT_SECRET']
        if (!secret || secret.length < 16) {
          throw new Error('JWT_SECRET 未配置或长度不足 16 字符。请在 services/api/.env 中设置一个强随机值。')
        }
        return {
          secret,
          signOptions: { expiresIn: '30m', audience: 'enduser' },
        }
      },
    }),
    TerminalsModule,
  ],
  controllers: [MemberAuthController],
  providers: [
    MemberAuthService,
    MemberQrLoginService,
    EndUserAuthGuard,
    { provide: SMS_SENDER, useFactory: createSmsSender },
  ],
  exports: [EndUserAuthGuard],
})
export class MemberAuthModule {}
