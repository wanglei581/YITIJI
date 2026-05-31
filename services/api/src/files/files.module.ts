import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { PrismaModule } from '../prisma/prisma.module'
import { FilesController } from './files.controller'
import { FilesService } from './files.service'
import { FilesCleanupTask } from './files.cleanup.task'

/**
 * BE-1 文件模块。
 *
 * 提供:
 *   - 上传 / 签名 URL / 流式读取
 *   - admin 列表 / 强制清理单文件 / 强制清理所有过期
 *   - cron 每小时清理过期文件
 *
 * 依赖:
 *   - PrismaModule:落库 FileObject
 *   - JwtModule:JwtAuthGuard 验签
 *   - @nestjs/schedule:cron(在 AppModule 顶层 ScheduleModule.forRoot())
 *
 * 不依赖 AuditModule(BE-2 W2),操作日志由 controller 在动作完成后回写,
 * 这样 FilesService 单测无需 stub AuditService。
 */
@Module({
  imports: [
    PrismaModule,
    JwtModule.register({
      secret: process.env['JWT_SECRET'] ?? 'dev-only-secret',
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService, FilesCleanupTask],
  exports: [FilesService],
})
export class FilesModule {}
