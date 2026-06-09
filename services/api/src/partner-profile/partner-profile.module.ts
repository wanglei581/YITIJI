import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PartnerProfileController } from './partner-profile.controller'
import { PartnerProfileService } from './partner-profile.service'

/**
 * 合作机构资料模块（Sprint 1 / Task 4）。
 * 自带 JwtModule 供 JwtAuthGuard 解析 partner token；PrismaService / AuditService 为 @Global。
 */
@Module({
  imports: [
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-only-secret',
    }),
  ],
  controllers: [PartnerProfileController],
  providers: [PartnerProfileService],
})
export class PartnerProfileModule {}
