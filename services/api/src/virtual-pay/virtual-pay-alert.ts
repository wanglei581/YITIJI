import { Logger } from '@nestjs/common'
import { deliverOpsAlert } from '../admin-ops/admin-alert-push.service'

export interface VirtualPayAlertRedis {
  setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>
  del(key: string): Promise<number>
}

export interface VirtualPayOpsAlertInput {
  redis?: VirtualPayAlertRedis | null
  fetchImpl?: typeof fetch
  outTradeNo: string
  episodeToken: string
  type: 'virtual_pay_manual_review' | 'virtual_pay_closed_order_recovered' | 'virtual_pay_refund_failed'
  severity: 'error' | 'warning'
  title: string
  logger?: Pick<Logger, 'warn'>
}

const DEFAULT_LOGGER = new Logger('VirtualPayOpsAlert')

/**
 * 虚拟支付异常告警出口：写结构化告警日志，并复用企业微信运维告警推送（按主题+回合去重）。
 * 告警失败绝不反向破坏记权益或订单状态流转；不记录 openid / session_key / 密钥。
 */
export async function sendVirtualPayOpsAlert(input: VirtualPayOpsAlertInput): Promise<void> {
  const logger = input.logger ?? DEFAULT_LOGGER
  logger.warn(`VIRTUAL_PAY_ALERT type=${input.type} outTradeNo=${input.outTradeNo} episode=${input.episodeToken}`)
  const webhook = process.env['ALERT_WEBHOOK_URL']?.trim() || null
  if (!webhook || !input.redis) return
  try {
    await deliverOpsAlert({
      redis: input.redis,
      webhook,
      fetchImpl: input.fetchImpl ?? globalThis.fetch.bind(globalThis),
      alert: {
        subjectKey: `virtual-pay:${input.type}:${input.outTradeNo}`,
        episodeToken: input.episodeToken,
        type: input.type,
        severity: input.severity,
        title: input.title,
        terminalCode: null,
      },
      state: 'firing',
      logger,
    })
  } catch (error) {
    logger.warn(
      `VIRTUAL_PAY_ALERT_SEND_FAILED type=${input.type} outTradeNo=${input.outTradeNo} error=${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
