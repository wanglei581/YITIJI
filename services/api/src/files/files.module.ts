import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
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
 * 操作日志:手动删除等动作由 controller 在动作完成后回写(带 actor/IP);
 * 定时清理(cleanupExpired cron)无 controller 上下文,故 FilesService 经 @Global 的
 * AuditService 直接写 system 审计。FilesService 单测需 stub AuditService。
 */
@Module({
  imports: [
    PrismaModule,
    JwtVerifierModule,
  ],
  controllers: [FilesController],
  providers: [FilesService, FilesCleanupTask],
  exports: [FilesService],
})
export class FilesModule {}
