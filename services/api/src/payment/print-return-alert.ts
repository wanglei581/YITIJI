/**
 * 没出纸或退款对不上时推一条运营告警。推送失败不改变账本。
 * 列表仍由收集器现算，这里只负责当时那一下。
 */
import type { PrismaService } from '../prisma/prisma.service'
import { PRINT_RETURN_MANUAL_TYPE } from './print-no-paper-refund.constants'

export async function notifyPrintReturnHold(db: PrismaService, orderId: string): Promise<void> {
  const webhook = process.env['ALERT_WEBHOOK_URL']?.trim() || null
  const redisUrl = process.env['REDIS_URL']?.trim()
  if (!webhook || !redisUrl) return
  const order = await db.order.findUnique({ where: { id: orderId }, select: { terminalId: true } })
  let terminalCode: string | null = null
  if (order?.terminalId) {
    const terminal = await db.terminal.findUnique({
      where: { id: order.terminalId },
      select: { terminalCode: true },
    })
    const code = terminal?.terminalCode?.trim()
    terminalCode = code ? code : null
  }
  try {
    const { default: Redis } = await import('ioredis')
    const client = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 1000,
    })
    try {
      await client.connect()
      const { deliverOpsAlert } = await import('../admin-ops/admin-alert-push.service')
      await deliverOpsAlert({
        redis: {
          setIfAbsent: async (key, value, ttlSeconds) => {
            const result = await client.set(key, value, 'EX', ttlSeconds, 'NX')
            return result === 'OK'
          },
          del: (key) => client.del(key),
        },
        webhook,
        fetchImpl: fetch,
        alert: {
          subjectKey: `${PRINT_RETURN_MANUAL_TYPE}:${orderId}`,
          episodeToken: orderId,
          type: PRINT_RETURN_MANUAL_TYPE,
          severity: 'error',
          title: '打印没出纸，待人工处理',
          terminalCode,
        },
        state: 'firing',
      })
    } finally {
      client.disconnect()
    }
  } catch {
    // 推送失败不改变退款结果。
  }
}
