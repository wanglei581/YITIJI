import { HttpException, HttpStatus, Logger } from '@nestjs/common'
import { tryRedis } from '../../common/redis/redis-degradation'
import type { RedisService } from '../../common/redis/redis.service'
import { createSmsSender, SmsSendError, type SmsSender, type SmsSendMeta } from './sms-sender'

/**
 * 短信验证码的**发送额度**（P1-5，2026-09-29；全面商用收口评审 P1-5「短信每日总量与单终端上限」）。
 *
 * 各业务自己的频控（同号 60 秒冷却、同号每日 10 条、同 IP 每小时、同设备每小时）只防骚扰单个号码，
 * 挡不住「换号 + 换 IP」批量刷——每一条都是真金白银的短信费。这里在**发送器外面**再包一层，
 * 所以会员登录、会员二次验证、换绑、内部账号登录与找回密码等所有真发短信的路径一次性都被覆盖，
 * 不用逐个业务改：
 *
 * - 全站每日总量 `SMS_DAILY_TOTAL_LIMIT`（默认 500 条）；
 * - 单台一体机每日上限 `SMS_TERMINAL_DAILY_LIMIT`（默认 100 条）——只有请求带着**已验签**的
 *   终端身份（x-terminal-id + x-terminal-session-token）时才按终端计；手机与网页请求只受全站总量约束。
 * - 「每日」按北京时间自然日计。
 * - 先原子预留再发：预留不到就不发（429，说清是哪一种额度满了）；
 *   Redis 核不了额度时不发（503），宁可暂停验证码也不放任无上限地发。
 * - 服务商**明确拒发**（返回了错误码）不计费，退回预留；超时、网络中断时短信可能已经发出并计费，
 *   不退回（宁可少发几条，也不让额度被超时反复刷穿）。
 *
 * 为什么单独成文件：它包的是发送器，而发送器被两个模块（内部账号、会员）各自注册一份；
 * 放进任何一个业务服务都覆盖不到另一个。
 */

export const SMS_DAILY_TOTAL_LIMIT_ENV = 'SMS_DAILY_TOTAL_LIMIT'
export const SMS_TERMINAL_DAILY_LIMIT_ENV = 'SMS_TERMINAL_DAILY_LIMIT'
export const DEFAULT_SMS_DAILY_TOTAL_LIMIT = 500
export const DEFAULT_SMS_TERMINAL_DAILY_LIMIT = 100
/** 计数键按北京时间日期分桶，TTL 只负责清理，取两天足够覆盖跨时区的边界。 */
const COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60
/** 超时 / 网络中断：短信可能已经发出，不退回额度。 */
const AMBIGUOUS_PROVIDER_CODES = new Set(['timeout', 'network'])

export interface SmsBudgetLimits {
  dailyTotal: number
  terminalDaily: number
}

function readLimit(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim())
  // 非法值（空、非整数、≤0）回落到默认值：额度是安全上限，不能因为一个配错的值变成「不限」。
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export function readSmsBudgetLimits(env: NodeJS.ProcessEnv = process.env): SmsBudgetLimits {
  return {
    dailyTotal: readLimit(env[SMS_DAILY_TOTAL_LIMIT_ENV], DEFAULT_SMS_DAILY_TOTAL_LIMIT),
    terminalDaily: readLimit(env[SMS_TERMINAL_DAILY_LIMIT_ENV], DEFAULT_SMS_TERMINAL_DAILY_LIMIT),
  }
}

const shanghaiDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** 北京时间的 YYYY-MM-DD。 */
export function shanghaiDay(now: Date): string {
  return shanghaiDate.format(now)
}

export function smsBudgetGlobalKey(day: string): string {
  return `sms:budget:global:${day}`
}

export function smsBudgetTerminalKey(terminalId: string, day: string): string {
  return `sms:budget:terminal:${encodeURIComponent(terminalId.slice(0, 96))}:${day}`
}

type Scope = 'global' | 'terminal'

function capReached(scope: Scope): HttpException {
  return scope === 'global'
    ? new HttpException({
      error: { code: 'SMS_DAILY_TOTAL_LIMIT', message: '今天的短信验证码发送量已达上限，请明天再试' },
    }, HttpStatus.TOO_MANY_REQUESTS)
    : new HttpException({
      error: { code: 'SMS_TERMINAL_DAILY_LIMIT', message: '这台机器今天发出的短信验证码已达上限，请明天再试' },
    }, HttpStatus.TOO_MANY_REQUESTS)
}

function budgetUnavailable(): HttpException {
  return new HttpException({
    error: {
      code: 'SMS_BUDGET_UNAVAILABLE',
      message: '短信发送量暂时无法核对，为防止验证码被滥发，先暂停发送，请稍后再试',
    },
  }, HttpStatus.SERVICE_UNAVAILABLE)
}

export class BudgetedSmsSender implements SmsSender {
  private readonly logger = new Logger('SmsBudget')

  constructor(
    private readonly inner: SmsSender,
    private readonly redis: RedisService,
    private readonly limits: SmsBudgetLimits = readSmsBudgetLimits(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async sendCode(phone: string, code: string, meta?: SmsSendMeta): Promise<void> {
    const day = shanghaiDay(this.now())
    const reserved: string[] = []
    try {
      await this.reserve('global', smsBudgetGlobalKey(day), this.limits.dailyTotal, day)
      reserved.push(smsBudgetGlobalKey(day))
      const terminalId = meta?.terminalId?.trim()
      if (terminalId) {
        await this.reserve('terminal', smsBudgetTerminalKey(terminalId, day), this.limits.terminalDaily, day, terminalId)
        reserved.push(smsBudgetTerminalKey(terminalId, day))
      }
    } catch (error) {
      await this.release(reserved)
      throw error
    }

    try {
      await this.inner.sendCode(phone, code, meta)
    } catch (error) {
      const providerCode = error instanceof SmsSendError ? error.providerCode : undefined
      if (!providerCode || !AMBIGUOUS_PROVIDER_CODES.has(providerCode)) await this.release(reserved)
      throw error
    }
  }

  private async reserve(scope: Scope, key: string, limit: number, day: string, terminalId?: string): Promise<void> {
    const result = await tryRedis(
      `sms-budget:${scope}:reserve`,
      () => this.redis.reserveWithinLimitWithTtl(key, COUNTER_TTL_SECONDS, limit),
      this.logger,
    )
    if (!result.ok) throw budgetUnavailable()
    if (result.value) return
    await this.noteCapReached(scope, limit, day, terminalId)
    throw capReached(scope)
  }

  /** 每个额度每天只记一条固定标记的日志（终端编号不是个人信息；不记手机号）。 */
  private async noteCapReached(scope: Scope, limit: number, day: string, terminalId?: string): Promise<void> {
    const markerKey = `sms:budget:cap-noted:${scope}:${terminalId ? encodeURIComponent(terminalId.slice(0, 96)) : '-'}:${day}`
    const first = await tryRedis('sms-budget:cap-noted', () => this.redis.setNxEx(markerKey, '1', COUNTER_TTL_SECONDS), this.logger)
    if (first.ok && !first.value) return
    this.logger.warn(
      `SMS_DAILY_CAP_REACHED scope=${scope} limit=${limit} day=${day}${terminalId ? ` terminal=${JSON.stringify(terminalId.slice(0, 64))}` : ''}`,
    )
  }

  private async release(keys: readonly string[]): Promise<void> {
    await Promise.all(keys.map((key) => tryRedis('sms-budget:release', () => this.redis.releaseReservedLimit(key), this.logger)))
  }
}

/** 两个模块注册 SMS_SENDER 时共用的工厂：真实发送器 + 额度层。 */
export function createBudgetedSmsSender(redis: RedisService): SmsSender {
  return new BudgetedSmsSender(createSmsSender(), redis)
}
