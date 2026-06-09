import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PartnerDashboardController } from './partner-dashboard.controller'
import { PartnerDashboardService } from './partner-dashboard.service'

/**
 * 合作机构运营数据看板模块（Sprint 1 / Task 5）。
 * 自带 JwtModule 供 JwtAuthGuard 解析 partner token；PrismaService 为 @Global。只读，无审计。
 */
@Module({
  imports: [
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-only-secret',
    }),
  ],
  controllers: [PartnerDashboardController],
  providers: [PartnerDashboardService],
})
export class PartnerDashboardModule {}
