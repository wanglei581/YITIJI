import type { Logger } from '@nestjs/common'
import { deliverOpsAlert } from '../../admin-ops/admin-alert-push.service'

/**
 * 服务商「整体拒发」：换哪个手机号都发不出。
 *
 * 腾讯云短信 API 3.0 错误码以官方页为准，这里不自行补充：
 * - https://cloud.tencent.com/document/product/382/38780
 * - https://cloud.tencent.com/document/product/382/59177 （发送状态码，和接口错误码同一套业务码）
 * 本地原因（template_missing、endpoint_not_allowed）只按任务包收。
 * 单个号码的问题、超时和断网不推：前者不是全站故障，后者往往会自己好。
 */

export type SmsProviderRefusalCategory =
  | 'balance'
  | 'signature_or_template'
  | 'auth_or_account'
  | 'app_daily_limit'
  | 'config'

const EXACT: Readonly<Record<string, SmsProviderRefusalCategory>> = {
  'FailedOperation.InsufficientBalanceInSmsPackage': 'balance',
  'FailedOperation.SignatureIncorrectOrUnapproved': 'signature_or_template',
  'FailedOperation.TemplateIncorrectOrUnapproved': 'signature_or_template',
  'LimitExceeded.AppDailyLimit': 'app_daily_limit',
  template_missing: 'config',
  endpoint_not_allowed: 'config',
}

const LABEL: Record<SmsProviderRefusalCategory, string> = {
  balance: '余额或套餐包用完了',
  signature_or_template: '签名或模板不可用',
  auth_or_account: '账号或密钥不可用',
  app_daily_limit: '今天的发送量到上限了',
  config: '服务端短信配置不全',
}

/** 不推时返回 null。空串、空白、未知码都不推。 */
export function classifySmsProviderRefusal(
  providerCode: string | undefined | null,
): SmsProviderRefusalCategory | null {
  if (typeof providerCode !== 'string') return null
  const code = providerCode.trim()
  if (!code) return null
  if (code.startsWith('AuthFailure.')) return 'auth_or_account'
  if (code.startsWith('UnauthorizedOperation.')) return 'auth_or_account'
  return EXACT[code] ?? null
}

export function smsProviderRefusalTitle(category: SmsProviderRefusalCategory, providerCode: string): string {
  return `短信发不出去：${LABEL[category]}（服务商返回 ${providerCode}）。用户收不到验证码，手机号登录、找回密码等都办不成。`
}

export interface SmsProviderRefusalRedis {
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>
  del(key: string): Promise<number>
}

/**
 * 不等待。推送失败只记一行 warn，不抛回调用方，也不拖慢发短信的返回。
 * 同一类一天一次：主题带分类，回合用东八区当天日期，去重交给 deliverOpsAlert。
 */
export function scheduleSmsProviderRefusalAlert(input: {
  providerCode: string | undefined
  day: string
  redis: SmsProviderRefusalRedis
  logger: Pick<Logger, 'warn'>
}): void {
  const category = classifySmsProviderRefusal(input.providerCode)
  if (!category || typeof input.providerCode !== 'string') return
  const providerCode = input.providerCode.trim()
  void pushSmsProviderRefusalAlert(input, category, providerCode).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    input.logger.warn(`SMS_PROVIDER_REFUSAL_ALERT_FAILED category=${category} error=${message}`)
  })
}

async function pushSmsProviderRefusalAlert(
  input: {
    day: string
    redis: SmsProviderRefusalRedis
    logger: Pick<Logger, 'warn'>
  },
  category: SmsProviderRefusalCategory,
  providerCode: string,
): Promise<void> {
  await deliverOpsAlert({
    redis: input.redis,
    webhook: process.env['ALERT_WEBHOOK_URL']?.trim() || null,
    fetchImpl: globalThis.fetch.bind(globalThis),
    alert: {
      subjectKey: `sms_provider_refused:${category}`,
      episodeToken: input.day,
      type: 'sms_provider_refused',
      severity: 'error',
      title: smsProviderRefusalTitle(category, providerCode),
      terminalCode: null,
    },
    state: 'firing',
    logger: input.logger,
  })
}
