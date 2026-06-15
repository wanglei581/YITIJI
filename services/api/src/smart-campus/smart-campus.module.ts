import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PrismaModule } from '../prisma/prisma.module'
import { SmartCampusController } from './smart-campus.controller'
import { SmartCampusService } from './smart-campus.service'

/**
 * 智慧校园（按终端开关）模块。
 *
 * 提供：
 *   - 管理员：终端列表 + 按终端配置智慧校园开关与子模块开关位（@Roles('admin')，含审计）
 *   - Kiosk：拉取开关 + 子模块开关位（无登录，只读，返回体白名单不含学生数据）
 *
 * 依赖：
 *   - PrismaModule：落库 TerminalSmartCampusConfig
 *   - JwtModule：JwtAuthGuard 验签
 *   - AuditService（@Global）：管理员写操作审计
 */
@Module({
  imports: [
    PrismaModule,
    JwtModule.register({ secret: process.env['JWT_SECRET'] ?? 'dev-only-secret' }),
  ],
  controllers: [SmartCampusController],
  providers: [SmartCampusService],
  exports: [SmartCampusService],
})
export class SmartCampusModule {}
