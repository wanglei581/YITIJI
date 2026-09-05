import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'

export const DEFAULT_TERMINAL_HEARTBEAT_RETENTION_DAYS = 90

export function terminalHeartbeatRetentionCutoff(now = new Date()): Date {
  const rawDays = Number(process.env['TERMINAL_HEARTBEAT_RETENTION_DAYS'] ?? DEFAULT_TERMINAL_HEARTBEAT_RETENTION_DAYS)
  const days = Number.isFinite(rawDays) && rawDays >= 1 ? Math.floor(rawDays) : DEFAULT_TERMINAL_HEARTBEAT_RETENTION_DAYS
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

/**
 * 终端心跳每 30 秒一条，不能无限增长。只删除超过保留期的历史心跳；
 * 在线判定和故障诊断只读取最新记录，不依赖过期数据。
 */
@Injectable()
export class TerminalHeartbeatRetentionTask {
  private readonly logger = new Logger(TerminalHeartbeatRetentionTask.name)

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDaily(): Promise<void> {
    const cutoff = terminalHeartbeatRetentionCutoff()
    try {
      const result = await this.prisma.terminalHeartbeat.deleteMany({ where: { createdAt: { lt: cutoff } } })
      if (result.count > 0) {
        this.logger.log(`Deleted ${result.count} terminal heartbeats created before ${cutoff.toISOString()}`)
      }
    } catch {
      this.logger.error('code=TERMINAL_HEARTBEAT_RETENTION_CLEANUP_FAILED')
    }
  }
}
