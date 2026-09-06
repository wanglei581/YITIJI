import { ServiceUnavailableException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { RedisService } from '../common/redis/redis.service'

/**
 * 跨实例付费 AI 懒执行锁。
 * - 配置了 Redis：SET NX PX 跨实例互斥；Redis 异常时 fail-closed（拒绝，不双跑，不退回进程内 Map）。
 * - 未配置 Redis（单实例 / 离线 verify）：只做进程内合并，行为与引入锁之前一致。
 */
export class RedisInflightLock {
  private readonly inflight = new Map<string, Promise<unknown>>()

  constructor(private readonly redis: RedisService | undefined) {}

  async run<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key) as Promise<T> | undefined
    if (existing) return existing
    const running = this.runOnce(key, ttlMs, work)
    this.inflight.set(key, running)
    try {
      return await running
    } finally {
      if (this.inflight.get(key) === running) this.inflight.delete(key)
    }
  }

  private async runOnce<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<T> {
    if (!this.redis) return work()
    const token = randomUUID()
    let acquired: boolean
    try {
      acquired = await this.redis.setNxPx(key, token, ttlMs)
    } catch {
      throw busy('AI_IDEMPOTENCY_UNAVAILABLE', '服务繁忙，请稍后重试')
    }
    if (!acquired) throw busy('AI_REQUEST_IN_PROGRESS', '请求正在处理中，请稍后刷新结果')
    try {
      return await work()
    } finally {
      await this.redis.getAndDelIfEquals(key, token).catch(() => undefined)
    }
  }
}

function busy(code: string, message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({ error: { code, message } })
}
