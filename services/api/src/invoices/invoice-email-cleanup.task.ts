import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { readAiServiceLogRetentionDays } from '../ai/ai-result.cleanup.task'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { clearExpiredInvoiceEmails } from './invoice-email-retention'

/**
 * 每小时清一次已开或已退回申请上过期的接收邮箱。
 * 保留天数每次现读，与 AiServiceLog 共用 AI_SERVICE_LOG_RETENTION_DAYS。
 * cron 由 AppModule 顶层 ScheduleModule.forRoot() 驱动。
 */
@Injectable()
export class InvoiceEmailCleanupTask {
  private readonly logger = new Logger(InvoiceEmailCleanupTask.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourly(now = new Date()): Promise<void> {
    const retentionDays = readAiServiceLogRetentionDays()
    try {
      const { clearedCount } = await clearExpiredInvoiceEmails(this.prisma, retentionDays, now)
      if (clearedCount > 0) {
        await this.audit.write({
          actorId: null,
          actorRole: 'system',
          action: 'invoice.email_cleared',
          targetType: 'invoice_request',
          targetId: null,
          payload: { triggeredBy: 'cron', clearedCount, retentionDays },
        })
        this.logger.log(`Hourly cron: cleared ${clearedCount} invoice emails`)
      }
    } catch (error) {
      this.logger.error(`Hourly invoice email cleanup failed: ${(error as Error).message}`)
    }
  }
}
