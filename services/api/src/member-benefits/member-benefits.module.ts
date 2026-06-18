import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { AdminMemberBenefitsController } from './admin-member-benefits.controller'
import { AdminMemberBenefitsService } from './admin-member-benefits.service'
import { MemberBenefitsController } from './member-benefits.controller'
import { MemberBenefitsService } from './member-benefits.service'

/**
 * 会员权益模块（Phase C-2C 底座，只读）。
 *
 * 自带 enduser 专用 JwtModule（与 MemberAuthModule 同 JWT_SECRET + audience='enduser'），
 * 并本地 provide EndUserAuthGuard，使 @UseGuards(EndUserAuthGuard) 能在本模块注入上下文里
 * 解析 JwtService。PrismaService / RedisService 均为 @Global，直接注入。
 * 只读权益列表，无写操作；发放 / 核销 / 支付属后续阶段。
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
  controllers: [MemberBenefitsController, AdminMemberBenefitsController],
  providers: [MemberBenefitsService, AdminMemberBenefitsService, EndUserAuthGuard],
})
export class MemberBenefitsModule {}
