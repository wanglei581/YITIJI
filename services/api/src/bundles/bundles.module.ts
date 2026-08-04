// bundles.module.ts
import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { BundlesController } from './bundles.controller'
import { BundlesService } from './bundles.service'

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env['JWT_SECRET']
        if (!secret || secret.length < 16) throw new Error('JWT_SECRET 未配置')
        return { secret, signOptions: { expiresIn: '30m', audience: 'enduser' } }
      },
    }),
  ],
  controllers: [BundlesController],
  providers: [BundlesService, EndUserAuthGuard],
  exports: [BundlesService],
})
export class BundlesModule {}
