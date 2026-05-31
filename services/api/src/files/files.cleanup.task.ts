import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { FilesService } from './files.service'

/**
 * 每小时清理一次已过期文件。
 *
 * 合规要求(CLAUDE.md §11):敏感文件设有效期,过期自动清理。
 * cron 由 @nestjs/schedule 驱动,服务不重启即生效。
 *
 * 验证方式:
 *   - 上传 sensitiveLevel='highly_sensitive' 文件(默认 1h 过期)
 *   - 等待 cron 触发(每小时整点)或手动调用 POST /files/cleanup-expired
 *   - 查 audit log + 文件管理列表(deletedAt 应有值)
 */
@Injectable()
export class FilesCleanupTask {
  private readonly logger = new Logger(FilesCleanupTask.name)

  constructor(private readonly files: FilesService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourly(): Promise<void> {
    try {
      const result = await this.files.cleanupExpired('cron')
      if (result.deletedCount > 0) {
        this.logger.log(`Hourly cron: cleaned up ${result.deletedCount} expired files`)
      }
    } catch (err) {
      this.logger.error(`Hourly cleanup failed: ${(err as Error).message}`)
    }
  }
}
