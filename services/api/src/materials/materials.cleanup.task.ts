import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { MaterialsService } from './materials.service'

/**
 * 每小时清理一次已过期材料处理任务。
 *
 * 材料任务包含用户上传文件派生出的检查结果和 PII 命中项,不能只在读取时失效。
 * cron 由 AppModule 顶层 ScheduleModule.forRoot() 驱动。
 */
@Injectable()
export class MaterialsCleanupTask {
  private readonly logger = new Logger(MaterialsCleanupTask.name)

  constructor(private readonly materials: MaterialsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourly(): Promise<void> {
    try {
      const result = await this.materials.cleanupExpired()
      if (result.deletedTasks > 0) {
        this.logger.log(`Hourly cron: cleaned up ${result.deletedTasks} expired material tasks`)
      }
    } catch (err) {
      this.logger.error(`Hourly material task cleanup failed: ${(err as Error).message}`)
    }
  }
}
