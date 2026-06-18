import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { OptionalEndUserAuthGuard } from '../common/guards/optional-end-user-auth.guard'
import { BenefitActivitiesController } from './benefit-activities.controller'
import { AdminBenefitActivitiesController } from './admin-benefit-activities.controller'
import { BenefitActivitiesService } from './benefit-activities.service'

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
  controllers: [BenefitActivitiesController, AdminBenefitActivitiesController],
  providers: [BenefitActivitiesService, EndUserAuthGuard, OptionalEndUserAuthGuard],
})
export class BenefitActivitiesModule {}
