import { Injectable } from '@nestjs/common'

interface CacheEntry<T> {
  expiresAt: number
  storedAt: number
  value: T
}

export const SCREEN_CACHE_MAX_KEYS = 256

/**
 * 进程内 TTL 缓存。大屏 15s/60s/5min 三档不走 Redis：
 * Redis 在本仓用于会话/锁/队列，挂掉会拖垮只读展示。
 *
 * 多实例边界：每个 API 进程各自一份 Map，互不同步。实例之间最多相差
 * 对应档位 TTL（15/60/300 秒）。只读展示可接受，禁止把本缓存当成跨机一致。
 * 过期项在读写时清理；活 key 超过 SCREEN_CACHE_MAX_KEYS 时淘汰最旧 storedAt。
 */
@Injectable()
export class ScreenSnapshotCache {
  private readonly store = new Map<string, CacheEntry<unknown>>()

  constructor(
    private readonly clock: () => number = () => Date.now(),
    private readonly maxKeys: number = SCREEN_CACHE_MAX_KEYS,
  ) {}

  size(): number {
    return this.store.size
  }

  async getOrLoad<T>(
    key: string,
    ttlSeconds: number,
    load: () => Promise<T>,
  ): Promise<{ storedAt: number; value: T; hit: boolean }> {
    const now = this.clock()
    this.pruneExpired(now)
    const cached = this.store.get(key) as CacheEntry<T> | undefined
    if (cached && cached.expiresAt > now) {
      return { storedAt: cached.storedAt, value: cached.value, hit: true }
    }
    const value = await load()
    const storedAt = this.clock()
    this.pruneExpired(storedAt)
    this.evictOldestIfNeeded(key)
    this.store.set(key, { value, storedAt, expiresAt: storedAt + ttlSeconds * 1000 })
    return { storedAt, value, hit: false }
  }

  clear(): void {
    this.store.clear()
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.store) {
      if (entry.expiresAt <= now) this.store.delete(key)
    }
  }

  private evictOldestIfNeeded(incomingKey: string): void {
    if (this.store.size < this.maxKeys) return
    if (this.store.has(incomingKey)) return
    let oldestKey: string | undefined
    let oldestStored = Number.POSITIVE_INFINITY
    for (const [key, entry] of this.store) {
      if (entry.storedAt < oldestStored) {
        oldestStored = entry.storedAt
        oldestKey = key
      }
    }
    if (oldestKey) this.store.delete(oldestKey)
  }
}
