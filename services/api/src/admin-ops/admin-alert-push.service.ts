import { Injectable, Logger, Optional } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { RedisService } from '../common/redis/redis.service'
import { collectDerivedAlerts, type DerivedAlert } from './derived-alerts'
import { PrismaService } from '../prisma/prisma.service'

type PreviousAlert = Pick<DerivedAlert, 'subjectKey' | 'episodeToken' | 'type' | 'severity' | 'title' | 'terminalCode'>
type AlertCollector = (prisma: PrismaService, now: Date) => Promise<{ alerts: DerivedAlert[] }>

/**
 * 企业微信群机器人推送。告警仍由 admin-ops 的派生查询决定，本任务只复用它的节奏。
 * Redis DB 由 REDIS_URL 决定；生产应使用约定的 14 号库。
 */
@Injectable()
export class AdminAlertPushService {
  private readonly logger = new Logger(AdminAlertPushService.name)
  private readonly webhook = process.env['ALERT_WEBHOOK_URL']?.trim() || null
  private readonly snapshotKey = 'admin-alert-push:previous'
  private readonly dedupeTtlSeconds = 180 * 24 * 60 * 60
  private readonly collectAlerts: AlertCollector
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    @Optional() collectAlerts?: AlertCollector,
    @Optional() fetchImpl?: typeof fetch,
  ) {
    this.collectAlerts = collectAlerts ?? collectDerivedAlerts
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'admin-alert-push' })
  async pushDerivedAlerts(): Promise<void> {
    if (!this.webhook) return
    try {
      const now = new Date()
      const current = await this.collectAlerts(this.prisma, now)
      const previous = await this.readPrevious()
      const currentByKey = new Map(current.alerts.map((alert) => [alert.subjectKey, alert]))

      for (const alert of current.alerts) {
        await this.pushOnce(alert, 'firing')
      }
      for (const alert of previous) {
        if (!currentByKey.has(alert.subjectKey)) await this.pushOnce(alert, 'recovered')
      }

      const next: PreviousAlert[] = current.alerts.map(({ subjectKey, episodeToken, type, severity, title, terminalCode }) => ({
        subjectKey, episodeToken, type, severity, title, terminalCode,
      }))
      await this.redis.set(this.snapshotKey, JSON.stringify(next), this.dedupeTtlSeconds)
    } catch (error) {
      this.logger.warn(`ALERT_PUSH_FAILED phase=derive error=${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private async readPrevious(): Promise<PreviousAlert[]> {
    const raw = await this.redis.get(this.snapshotKey)
    if (!raw) return []
    try {
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((item): item is PreviousAlert => {
        if (!item || typeof item !== 'object') return false
        const value = item as Record<string, unknown>
        return typeof value.subjectKey === 'string' && typeof value.episodeToken === 'string'
          && typeof value.type === 'string' && (value.severity === 'error' || value.severity === 'warning')
          && typeof value.title === 'string' && (value.terminalCode === null || typeof value.terminalCode === 'string')
      }) : []
    } catch {
      return []
    }
  }

  private async pushOnce(alert: PreviousAlert | DerivedAlert, state: 'firing' | 'recovered'): Promise<void> {
    const dedupeKey = `admin-alert-push:sent:${alert.subjectKey}:${alert.episodeToken}:${state}`
    if (!(await this.redis.setIfAbsent(dedupeKey, '1', this.dedupeTtlSeconds))) return
    const severity = alert.severity === 'error' ? '严重' : '警告'
    const terminal = alert.terminalCode ? `（终端 ${alert.terminalCode}）` : ''
    const body = {
      msgtype: 'text',
      text: { content: `【职易达告警】${severity}｜${alert.title}${terminal}：${state === 'recovered' ? '已恢复' : '正在发生'}` },
    }
    try {
      const response = await this.fetchImpl(this.webhook!, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) throw new Error(`HTTP_${response.status}`)
    } catch (error) {
      // 发送失败不固化去重标记，下一分钟可重试；业务请求仍不受影响。
      await this.redis.del(dedupeKey).catch(() => undefined)
      this.logger.warn(`ALERT_PUSH_FAILED phase=send type=${alert.type} state=${state} error=${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
