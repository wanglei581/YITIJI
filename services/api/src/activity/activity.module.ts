import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { ActivityController } from './activity.controller'
import { MeActivityController } from './me-activity.controller'
import { ActivityService } from './activity.service'

/**
 * 浏览 / 外部跳转记录模块（P1 闭环）。
 *
 * 自带 enduser 专用 JwtModule（与 MemberAuthModule 同 JWT_SECRET + audience='enduser'）：
 * - /activity/* 上报端点用它做可选登录解析（匿名不落库）；
 * - /me/* 列表与删除端点用它驱动 EndUserAuthGuard 强制会员。
 * PrismaService / RedisService / AuditService 均为 @Global，直接注入。
 *
 * 合规（长期红线）：本模块只记录浏览与「打开来源平台入口」行为；
 * 不得加入投递结果 / 预约结果 / 企业处理 / 录取通知等任何状态能力。
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
  ],
  controllers: [ActivityController, MeActivityController],
  providers: [ActivityService, EndUserAuthGuard],
})
export class ActivityModule {}
