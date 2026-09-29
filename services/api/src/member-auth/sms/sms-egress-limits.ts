import { HttpException, HttpStatus, Logger } from '@nestjs/common'
import { deliverOpsAlert } from '../../admin-ops/admin-alert-push.service'
import {
  IP_HOURLY_MAX,
  TERMINAL_HOURLY_MAX,
  currentSmsTrustedEgressConfig,
  matchTrustedEgress,
} from './sms-egress-config'

/**
 * 会员发验证码的「每小时」计数。
 *
 * 已验签终端按台计 30 条，不写入 IP 桶；没有终端时按 IP。
 * 受信出口只把 IP 这一层换成更高的上限，并在用量到八成时告警一次。
 *
 * 为什么不放进 member-auth.service.ts：那个文件已经超过 500 行，
 * 网络配额和告警不是登录本身。
 * 为什么不放进 sms-budget.ts：那是发送前的每日额度，会员和内部账号共用；
 * 这里只约束会员发码的小时桶。
 * 为什么不放进 sms-egress-config.ts：配置文件必须不依赖 Redis 和告警，启动检查才能单独加载。
 * 为什么不放进 terminal-throttle.ts：那边是每分钟限流的计数维度，不持有这条 Redis 计数。
 */

const logger = new Logger('SmsEgressLimits')
const HOUR_TTL_SECONDS = 3600
const ALERT_MARKER_TTL_SECONDS = 3 * 3600

export const SMS_IP_LIMIT_MESSAGE = '当前网络请求过于频繁,请稍后再试'
export const SMS_TERMINAL_HOURLY_MESSAGE = '这台设备请求验证码太频繁了，请稍后再试'

export interface SmsEgressRedis {
  incrWithTtl(key: string, ttlSeconds: number): Promise<number>
  setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean>
  del(key: string): Promise<number>
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>
}

export interface TrustedEgressAlertEvent {
  cidr: string
  count: number
  limit: number
  hour: string
}

type AlertWriter = (event: TrustedEgressAlertEvent) => Promise<void> | void

let testWriter: AlertWriter | null = null

/** 门禁用。生产路径不会绑定；绑定后不再调用运维告警推送。 */
export function bindSmsEgressAlertForTests(writer: AlertWriter | null): void {
  testWriter = writer
}

function tooMany(code: string, message: string): HttpException {
  return new HttpException({ error: { code, message } }, HttpStatus.TOO_MANY_REQUESTS)
}

/** 用量达到上限的 80%（含刚好到、以及已经超过）。7/10 否，8/10 是。 */
export function trustedEgressReachedHot(count: number, limit: number): boolean {
  if (limit <= 0 || count <= 0) return false
  return count * 100 >= limit * 80
}

export async function enforceMemberSmsHourlyLimit(
  redis: SmsEgressRedis,
  input: { ip: string; hour: string; terminalId: string | null },
): Promise<void> {
  const terminalId = input.terminalId?.trim() ?? ''
  if (terminalId) {
    const count = await redis.incrWithTtl(`member:sms:term:${terminalId}:${input.hour}`, HOUR_TTL_SECONDS)
    if (count > TERMINAL_HOURLY_MAX) {
      throw tooMany('SMS_TERMINAL_HOURLY_LIMIT', SMS_TERMINAL_HOURLY_MESSAGE)
    }
    // 已验签终端到此为止，不写入 member:sms:ip。大厅共用一个出口时各台分开计数。
    return
  }

  const rule = matchTrustedEgress(input.ip)
  const limit = rule ? currentSmsTrustedEgressConfig().hourlyLimit : IP_HOURLY_MAX
  const count = await redis.incrWithTtl(`member:sms:ip:${input.ip}:${input.hour}`, HOUR_TTL_SECONDS)
  if (rule && trustedEgressReachedHot(count, limit)) {
    await notifyTrustedEgressHot(redis, { cidr: rule.token, count, limit, hour: input.hour })
  }
  if (count > limit) {
    throw tooMany('SMS_IP_LIMIT', SMS_IP_LIMIT_MESSAGE)
  }
}

async function notifyTrustedEgressHot(redis: SmsEgressRedis, event: TrustedEgressAlertEvent): Promise<void> {
  const marker = `member:sms:trusted-alert:${encodeURIComponent(event.cidr)}:${event.hour}`
  let first = false
  try {
    first = await redis.setNxEx(marker, '1', ALERT_MARKER_TTL_SECONDS)
  } catch (error) {
    logger.warn(`SMS_TRUSTED_EGRESS_ALERT_FAILED phase=marker error=${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (!first) return
  try {
    logger.warn(`SMS_TRUSTED_EGRESS_HOT cidr=${event.cidr} count=${event.count} limit=${event.limit} hour=${event.hour}`)
    if (testWriter) {
      await testWriter(event)
      return
    }
    await dispatchTrustedEgressAlert(redis, event)
  } catch (error) {
    await redis.del(marker).catch(() => undefined)
    logger.warn(`SMS_TRUSTED_EGRESS_ALERT_FAILED phase=send error=${error instanceof Error ? error.message : String(error)}`)
  }
}

/** 默认告警出口：复用运维告警推送。没配告警地址时由那边直接返回，不耽误发验证码。 */
export async function dispatchTrustedEgressAlert(redis: SmsEgressRedis, event: TrustedEgressAlertEvent): Promise<void> {
  await deliverOpsAlert({
    redis,
    webhook: process.env['ALERT_WEBHOOK_URL']?.trim() || null,
    fetchImpl: globalThis.fetch.bind(globalThis),
    alert: {
      subjectKey: `sms_trusted_egress:${event.cidr}`,
      episodeToken: event.hour,
      type: 'sms_trusted_egress',
      severity: 'warning',
      title: `受信网络 ${event.cidr} 这一小时的验证码请求已到每地址上限的八成（${event.count}/${event.limit}）`,
      terminalCode: null,
    },
    state: 'firing',
  })
}
