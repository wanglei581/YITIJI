import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { DEFAULT_KIOSK_SESSION_RETENTION_DAYS } from './kiosk-session.types'

export function kioskSessionRetentionCutoff(now = new Date()): Date {
  const rawDays = Number(process.env['KIOSK_SESSION_RETENTION_DAYS'] ?? DEFAULT_KIOSK_SESSION_RETENTION_DAYS)
  const days = Number.isFinite(rawDays) && rawDays >= 1 ? Math.floor(rawDays) : DEFAULT_KIOSK_SESSION_RETENTION_DAYS
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

/** 会话记录只为统计服务人次，按开始时间保留 180 天（可配），与日志保留期一致。 */
@Injectable()
export class KioskSessionRetentionTask {
  private readonly logger = new Logger(KioskSessionRetentionTask.name)

  constructor(private readonly prisma: PrismaService) {}

  @Cron('30 3 * * *')
  async handleDaily(): Promise<void> {
    const cutoff = kioskSessionRetentionCutoff()
    try {
      const result = await this.prisma.kioskSession.deleteMany({ where: { startedAt: { lt: cutoff } } })
      if (result.count > 0) {
        this.logger.log(`Deleted ${result.count} kiosk sessions started before ${cutoff.toISOString()}`)
      }
    } catch {
      this.logger.error('code=KIOSK_SESSION_RETENTION_CLEANUP_FAILED')
    }
  }
}
