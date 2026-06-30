import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { AiService } from './ai.service'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'

const AI_SERVICE_LOG_RETENTION_DAYS = (() => {
  const raw = Number(process.env['AI_SERVICE_LOG_RETENTION_DAYS'])
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 90
})()

/**
 * 每小时清理一次已过期的简历派生结果（AiResumeResult）和岗位 AI 会话。
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

  constructor(
    private readonly ai: AiService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourly(): Promise<void> {
    await this.cleanupExpiredResumeResults()
    await this.cleanupExpiredJobAiSessions()
    await this.cleanupExpiredAiServiceLogs()
  }

  private async cleanupExpiredResumeResults(): Promise<void> {
    try {
      const { deletedCount } = await this.ai.cleanupExpiredResults('cron')
      if (deletedCount > 0) {
        this.logger.log(`Hourly cron: cleaned up ${deletedCount} expired AI resume results`)
      }
    } catch (err) {
      this.logger.error(`Hourly AI result cleanup failed: ${(err as Error).message}`)
    }
  }

  private async cleanupExpiredJobAiSessions(): Promise<void> {
    try {
      const result = await this.prisma.jobAiSession.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      })
      if (result.count > 0) {
        await this.audit.write({
          actorId: null,
          actorRole: 'system',
          action: 'job_ai_session.cleanup_expired',
          targetType: 'job_ai_session',
          targetId: null,
          payload: { triggeredBy: 'cron', deletedCount: result.count },
        })
        this.logger.log(`Hourly cron: cleaned up ${result.count} expired Job AI sessions`)
      }
    } catch (err) {
      this.logger.error(`Hourly Job AI session cleanup failed: ${(err as Error).message}`)
    }
  }

  private async cleanupExpiredAiServiceLogs(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - AI_SERVICE_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
      const result = await this.prisma.aiServiceLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      })
      if (result.count > 0) {
        await this.audit.write({
          actorId: null,
          actorRole: 'system',
          action: 'ai_service_log.cleanup_expired',
          targetType: 'ai_service_log',
          targetId: null,
          payload: {
            triggeredBy: 'cron',
            deletedCount: result.count,
            retentionDays: AI_SERVICE_LOG_RETENTION_DAYS,
          },
        })
        this.logger.log(`Hourly cron: cleaned up ${result.count} expired AI service logs`)
      }
    } catch (err) {
      this.logger.error(`Hourly AI service log cleanup failed: ${(err as Error).message}`)
    }
  }
}
