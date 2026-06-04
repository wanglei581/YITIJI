import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { AiService } from './ai.service'

/**
 * 每小时清理一次已过期的简历派生结果（AiResumeResult）。
 *
 * 合规要求（CLAUDE.md §11「不长期保存简历」）：简历解析 / 优化结果设留存窗口
 * （AI_RESUME_RESULT_TTL_HOURS，默认 24h），到期硬删，不让简历派生文本长期留存。
 * cron 由 @nestjs/schedule 驱动（ScheduleModule.forRoot() 在 AppModule 顶层）。
 *
 * 验证方式：
 *   - 写入一条 AiResumeResult（POST /resume/parse）后把其 expiresAt 改到过去，
 *   - 等待 cron 触发（每小时整点）→ 行被删除 + 审计 action='ai_resume_result.cleanup_expired'。
 */
@Injectable()
export class AiResultCleanupTask {
  private readonly logger = new Logger(AiResultCleanupTask.name)

  constructor(private readonly ai: AiService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourly(): Promise<void> {
    try {
      const { deletedCount } = await this.ai.cleanupExpiredResults('cron')
      if (deletedCount > 0) {
        this.logger.log(`Hourly cron: cleaned up ${deletedCount} expired AI resume results`)
      }
    } catch (err) {
      this.logger.error(`Hourly AI result cleanup failed: ${(err as Error).message}`)
    }
  }
}
