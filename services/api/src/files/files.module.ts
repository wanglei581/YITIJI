import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { PrismaModule } from '../prisma/prisma.module'
import { FilesController } from './files.controller'
import { FilesService } from './files.service'
import { FilesCleanupTask } from './files.cleanup.task'
import { MemberDataExportFileService } from './member-data-export-file.service'
import { FileQueryService } from './file-query.service'
import { FileUploadService } from './file-upload.service'
import { FileAccessService } from './file-access.service'
import { FileDeleteService } from './file-delete.service'
import { FileCleanupService } from './file-cleanup.service'

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
 * 定时清理(cleanupExpired cron)无 controller 上下文,故 FileCleanupService 经
 * @Global AuditService 直接写 system 审计。
 *
 * 子服务拆分（files.service.ts §8 1000 行阈值）：
 *   FilesService → 薄门面
 *   FileQueryService   — 共享 DB/存储查询辅助
 *   FileUploadService  — 代理上传 / 直传意图 / 确认 / 原始写入
 *   FileAccessService  — 签名 URL / 内容读取 / 列表 / 生命周期统计
 *   FileDeleteService  — 软删 / 物理删 / 保留期限
 *   FileCleanupService — cron/手动过期清理
 */
@Module({
  imports: [
    PrismaModule,
    JwtVerifierModule,
  ],
  controllers: [FilesController],
  providers: [
    FileQueryService,
    FileUploadService,
    FileAccessService,
    FileDeleteService,
    FileCleanupService,
    FilesService,
    MemberDataExportFileService,
    FilesCleanupTask,
  ],
  exports: [FilesService, MemberDataExportFileService],
})
export class FilesModule {}
