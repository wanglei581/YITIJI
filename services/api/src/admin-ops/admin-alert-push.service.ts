import { Injectable, Logger, Optional } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { RedisService } from '../common/redis/redis.service'
import { collectDerivedAlerts, type DerivedAlert } from './derived-alerts'
import { PrismaService } from '../prisma/prisma.service'

type PreviousAlert = Pick<DerivedAlert, 'subjectKey' | 'episodeToken' | 'type' | 'severity' | 'title' | 'terminalCode'>
type AlertCollector = (prisma: PrismaService, now: Date) => Promise<{ alerts: DerivedAlert[] }>

const DEFAULT_DEDUPE_TTL_SECONDS = 180 * 24 * 60 * 60

/** 运维告警推送的一条。`type` 用字符串，方便短信额度这类不进派生告警清单的事件复用同一条推送。 */
export interface OpsAlertPayload {
  subjectKey: string
  episodeToken: string
  type: string
  severity: 'error' | 'warning'
  title: string
  terminalCode: string | null
}

/**
 * 推一条运维告警到企业微信。同一主题、同一回合并同一状态只推一次。
 * 没配告警地址时直接返回。发送失败会删掉去重标记，下次可以再试。
 */
export async function deliverOpsAlert(input: {
  redis: {
    setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>
    del(key: string): Promise<number>
  }
  webhook: string | null
  fetchImpl: typeof fetch
  alert: OpsAlertPayload
  state: 'firing' | 'recovered'
  logger?: Pick<Logger, 'warn'>
  dedupeTtlSeconds?: number
}): Promise<void> {
  if (!input.webhook) return
  const logger = input.logger ?? new Logger(AdminAlertPushService.name)
  const dedupeTtlSeconds = input.dedupeTtlSeconds ?? DEFAULT_DEDUPE_TTL_SECONDS
  const alert = input.alert
  const state = input.state
  const dedupeKey = `admin-alert-push:sent:${alert.subjectKey}:${alert.episodeToken}:${state}`
  if (!(await input.redis.setIfAbsent(dedupeKey, '1', dedupeTtlSeconds))) return
  const severity = alert.severity === 'error' ? '严重' : '警告'
  const terminal = alert.terminalCode ? `（终端 ${alert.terminalCode}）` : ''
  const body = {
    msgtype: 'text',
    text: { content: `【职易达告警】${severity}｜${alert.title}${terminal}：${state === 'recovered' ? '已恢复' : '正在发生'}` },
  }
  try {
    const response = await input.fetchImpl(input.webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) throw new Error(`HTTP_${response.status}`)
  } catch (error) {
    await input.redis.del(dedupeKey).catch(() => undefined)
    logger.warn(`ALERT_PUSH_FAILED phase=send type=${alert.type} state=${state} error=${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 企业微信群机器人推送。告警仍由 admin-ops 的派生查询决定，本任务只复用它的节奏。
 * Redis DB 由 REDIS_URL 决定；生产应使用约定的 14 号库。
 */
@Injectable()
export class AdminAlertPushService {
  private readonly logger = new Logger(AdminAlertPushService.name)
  private readonly webhook = process.env['ALERT_WEBHOOK_URL']?.trim() || null
  private readonly snapshotKey = 'admin-alert-push:previous'
  private readonly dedupeTtlSeconds = DEFAULT_DEDUPE_TTL_SECONDS
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
    await deliverOpsAlert({
      redis: this.redis,
      webhook: this.webhook,
      fetchImpl: this.fetchImpl,
      alert,
      state,
      logger: this.logger,
      dedupeTtlSeconds: this.dedupeTtlSeconds,
    })
  }
}
