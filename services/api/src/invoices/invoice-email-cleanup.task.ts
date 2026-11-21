import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { clearExpiredInvoiceEmails, readInvoiceEmailRetentionDays } from './invoice-email-retention'

/**
 * 每小时清一次已开或已退回申请上过期的接收邮箱。
 * 保留天数每次现读 INVOICE_EMAIL_RETENTION_DAYS（默认 90），不借用 AI 服务日志的天数。
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
    const retentionDays = readInvoiceEmailRetentionDays()
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
