import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { MemberClosureReceiptGuard } from '../common/guards/member-closure-receipt.guard'
import { TerminalsModule } from '../terminals/terminals.module'
import { MemberAuthController } from './member-auth.controller'
import { MemberAuthService } from './member-auth.service'
import { MemberPhoneRebindService } from './member-phone-rebind.service'
import { MemberQrLoginService } from './member-qr-login.service'
import { MemberStepUpService } from './member-step-up.service'
import { SMS_SENDER } from './sms/sms-sender'
import { createMemberBudgetedSmsSender } from './sms/sms-budget'
import { SmsCodeThrottleBinder } from './sms/sms-code-throttle'
import { RedisService } from '../common/redis/redis.service'

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
    MemberStepUpService,
    MemberQrLoginService,
    MemberPhoneRebindService,
    EndUserAuthGuard,
    MemberClosureReceiptGuard,
    // 发验证码的每分钟限流：启动时把「终端验签」接上，只对这一条路由按已验签终端计。
    SmsCodeThrottleBinder,
    // P1-5：真实发送器外包额度层（会员桶每日总量 / 单终端每日上限），见 sms-budget.ts。
    { provide: SMS_SENDER, useFactory: createMemberBudgetedSmsSender, inject: [RedisService] },
  ],
  exports: [EndUserAuthGuard, MemberClosureReceiptGuard, MemberStepUpService],
})
export class MemberAuthModule {}
