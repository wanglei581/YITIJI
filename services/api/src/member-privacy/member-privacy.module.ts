import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuthModule } from '../auth/auth.module'
import { MemberAuthModule } from '../member-auth/member-auth.module'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AdminMemberPrivacyController } from './admin-member-privacy.controller'
import { MemberDataRequestService } from './member-data-request.service'
import { MemberDataRequestController, MemberPrivacyController } from './member-privacy.controller'
import { MemberPrivacyService } from './member-privacy.service'

@Module({
  imports: [
    AuthModule,
    MemberAuthModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env['JWT_SECRET']
        if (!secret || secret.length < 16) {
          throw new Error('JWT_SECRET 未配置或长度不足 16 字符。请在 services/api/.env 中设置一个强随机值。')
        }
        return { secret, signOptions: { expiresIn: '30m', audience: 'enduser' } }
      },
    }),
  ],
  controllers: [MemberPrivacyController, MemberDataRequestController, AdminMemberPrivacyController],
  providers: [MemberPrivacyService, MemberDataRequestService, EndUserAuthGuard, JwtAuthGuard, RolesGuard],
  exports: [MemberPrivacyService],
})
export class MemberPrivacyModule {}
