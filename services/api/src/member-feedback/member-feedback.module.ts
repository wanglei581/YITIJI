import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { AuthModule } from '../auth/auth.module'
import { MemberNotificationsModule } from '../member-notifications/member-notifications.module'
import { AdminMemberFeedbackController } from './admin-member-feedback.controller'
import { MemberFeedbackController } from './member-feedback.controller'
import { MemberFeedbackService } from './member-feedback.service'

@Module({
  imports: [
    AuthModule,
    MemberNotificationsModule,
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
  controllers: [MemberFeedbackController, AdminMemberFeedbackController],
  providers: [MemberFeedbackService, EndUserAuthGuard],
})
export class MemberFeedbackModule {}
