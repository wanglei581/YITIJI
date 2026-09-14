import { Injectable } from '@nestjs/common'

interface CacheEntry<T> {
  expiresAt: number
  storedAt: number
  value: T
}

/**
 * 进程内 TTL 缓存。大屏 15s/60s/5min 三档不走 Redis：
 * Redis 在本仓用于会话/锁/队列，挂掉会拖垮只读展示；多实例各自缓存可接受。
 */
@Injectable()
export class ScreenSnapshotCache {
  private readonly store = new Map<string, CacheEntry<unknown>>()

  constructor(private readonly clock: () => number = () => Date.now()) {}

  async getOrLoad<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<{ storedAt: number; value: T }> {
    const now = this.clock()
    const hit = this.store.get(key) as CacheEntry<T> | undefined
    if (hit && hit.expiresAt > now) {
      return { storedAt: hit.storedAt, value: hit.value }
    }
    const value = await load()
    const storedAt = this.clock()
    this.store.set(key, { value, storedAt, expiresAt: storedAt + ttlSeconds * 1000 })
    return { storedAt, value }
  }

  clear(): void {
    this.store.clear()
  }
}
