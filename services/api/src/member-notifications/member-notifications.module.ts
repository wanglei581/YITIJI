import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { AuthModule } from '../auth/auth.module'
import { AdminMemberNotificationsController } from './admin-member-notifications.controller'
import { MemberNotificationsController } from './member-notifications.controller'
import { MemberNotificationsService } from './member-notifications.service'

@Module({
  imports: [
    AuthModule,
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
  controllers: [MemberNotificationsController, AdminMemberNotificationsController],
  providers: [MemberNotificationsService, EndUserAuthGuard],
  exports: [MemberNotificationsService],
})
export class MemberNotificationsModule {}
