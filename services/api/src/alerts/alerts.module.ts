import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AlertsController } from './alerts.controller'
import { AlertsService } from './alerts.service'

/**
 * Admin 告警中心模块（Sprint 1 / Task 3）。
 * 自带 JwtModule 供 JwtAuthGuard 解析 admin token；PrismaService / AuditService 为 @Global。
 */
@Module({
  imports: [
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-only-secret',
    }),
  ],
  controllers: [AlertsController],
  providers: [AlertsService],
})
export class AlertsModule {}
