import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { policyDeadlineThreshold } from './policy-validity'

/**
 * 每小时把过了截止日期的已发布政策写成 expired，并记一条审计。
 * 公开读取本来就不返回这些行；这里只是让后台的发布状态跟上去。
 * 只动仍是 published 且截止日期已过的行。第二次跑到同一条时更新数为 0，不再写审计。
 */
@Injectable()
export class PolicyExpiryTask {
  private readonly logger = new Logger(PolicyExpiryTask.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourly(): Promise<void> {
    try {
      const expired = await this.expirePastDeadline()
      if (expired > 0) this.logger.log(`Hourly cron: marked ${expired} policies expired`)
    } catch (err) {
      this.logger.error(`Hourly policy expiry failed: ${(err as Error).message}`)
    }
  }

  async expirePastDeadline(now: Date = new Date()): Promise<number> {
    const threshold = policyDeadlineThreshold(now)
    const due = await this.prisma.policyPost.findMany({
      where: { publishStatus: 'published', validThrough: { lt: threshold } },
      select: { id: true, validThrough: true },
    })
    let expired = 0
    for (const row of due) {
      const updated = await this.prisma.policyPost.updateMany({
        where: { id: row.id, publishStatus: 'published', validThrough: { lt: threshold } },
        data: { publishStatus: 'expired' },
      })
      if (updated.count !== 1) continue
      expired += 1
      await this.audit.write({
        actorId: null,
        actorRole: 'system',
        action: 'policy.auto_expire',
        targetType: 'policy',
        targetId: row.id,
        payload: { validThrough: row.validThrough ? row.validThrough.toISOString().slice(0, 10) : null },
      })
    }
    return expired
  }
}
