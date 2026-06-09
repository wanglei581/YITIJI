import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AdminOrdersController } from './admin-orders.controller'
import { AdminOrdersService } from './admin-orders.service'

/**
 * Admin 订单管理模块（Sprint 1 / Task 2）。
 *
 * 自带 JwtModule 供 JwtAuthGuard 解析 admin token（与其它 admin 模块同 JWT_SECRET）。
 * PrismaService / AuditService 均为 @Global，直接注入，无需 imports。
 */
@Module({
  imports: [
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-only-secret',
    }),
  ],
  controllers: [AdminOrdersController],
  providers: [AdminOrdersService],
})
export class AdminOrdersModule {}
