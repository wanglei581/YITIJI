import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'

export const TERMINAL_HEARTBEAT_RETENTION_DAYS = 30

@Injectable()
export class TerminalHeartbeatRetentionTask {
  private readonly logger = new Logger(TerminalHeartbeatRetentionTask.name)

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourly(): Promise<void> {
    try {
      await this.runOnce()
    } catch (error) {
      this.logger.warn(`code=TERMINAL_HEARTBEAT_CLEANUP_FAILED reason=${(error as Error).name}`)
    }
  }

  async runOnce(now = new Date()): Promise<{ deleted: number; cutoff: Date }> {
    const cutoff = new Date(now.getTime() - TERMINAL_HEARTBEAT_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    const { count: deleted } = await this.prisma.terminalHeartbeat.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })
    if (deleted > 0) {
      this.logger.log(`code=TERMINAL_HEARTBEAT_CLEANUP_COMPLETE deleted=${deleted} cutoff=${cutoff.toISOString()}`)
    }
    return { deleted, cutoff }
  }
}
