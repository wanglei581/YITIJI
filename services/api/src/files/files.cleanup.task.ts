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
 *   - 构造已过期文件；system_short 高敏文件通常 1h 过期，会员长期保存文件 expiresAt=null 不应被清理
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
    } catch {
      this.logger.error('code=FILE_CLEANUP_BATCH_FAILED')
    }

    // 独立 try:清理批次失败不能连带跳过对账。这一轮收口的是「DB 说已删、
    // 对象存储里还在」的孤儿 —— cleanupExpired 只捞 deletedAt=null，永远
    // 够不到它们（CLAUDE.md §11:不长期保存身份证等敏感文件）。
    try {
      const reconciled = await this.files.reconcileStorageDeletions('cron')
      if (reconciled.reconciledCount > 0 || reconciled.stillPendingCount > 0) {
        this.logger.log(
          `Hourly cron: storage delete reconcile ok=${reconciled.reconciledCount} pending=${reconciled.stillPendingCount}`
        )
      }
    } catch {
      this.logger.error('code=FILE_STORAGE_DELETE_RECONCILE_BATCH_FAILED')
    }
  }
}
