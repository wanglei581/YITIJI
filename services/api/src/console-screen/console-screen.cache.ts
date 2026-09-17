import { Injectable } from '@nestjs/common'

interface CacheEntry<T> {
  expiresAt: number
  storedAt: number
  value: T
}

export const SCREEN_CACHE_MAX_KEYS = 256

type CacheLoadResult<T> = { storedAt: number; value: T; hit: boolean }

/**
 * 进程内 TTL 缓存。大屏 15s/60s/5min 三档不走 Redis：
 * Redis 在本仓用于会话/锁/队列，挂掉会拖垮只读展示。
 *
 * 多实例边界：每个 API 进程各自一份 Map，互不同步。实例之间最多相差
 * 对应档位 TTL（15/60/300 秒）。只读展示可接受，禁止把本缓存当成跨机一致。
 * 过期项在读写时清理；活 key 超过 SCREEN_CACHE_MAX_KEYS 时淘汰最旧 storedAt。
 * 同一 key 并发 miss/expired 只跑一次 loader（single-flight）；loader reject
 * 后清 in-flight，允许重试。含 ok:false 切片的聚合默认不入缓存。
 *
 * clock / maxKeys 不能放进 constructor 参数：tsc `emitDecoratorMetadata`
 * 会把它们标成 Function / Number，Nest 按 token 注入，进程起不来。
 * 生产走字段默认值；单测用 `forTest` 注入确定钟和上限。
 */
@Injectable()
export class ScreenSnapshotCache {
  private readonly store = new Map<string, CacheEntry<unknown>>()
  private readonly inflight = new Map<string, Promise<CacheLoadResult<unknown>>>()
  private clock: () => number = () => Date.now()
  private maxKeys: number = SCREEN_CACHE_MAX_KEYS

  static forTest(
    clock: () => number = () => Date.now(),
    maxKeys: number = SCREEN_CACHE_MAX_KEYS,
  ): ScreenSnapshotCache {
    const cache = new ScreenSnapshotCache()
    cache.clock = clock
    cache.maxKeys = maxKeys
    return cache
  }

  size(): number {
    return this.store.size
  }

  inflightSize(): number {
    return this.inflight.size
  }

  async getOrLoad<T>(
    key: string,
    ttlSeconds: number,
    load: () => Promise<T>,
    shouldCache: (value: T) => boolean = (value) => !containsFailedLoaded(value),
  ): Promise<CacheLoadResult<T>> {
    const now = this.clock()
    this.pruneExpired(now)
    const cached = this.store.get(key) as CacheEntry<T> | undefined
    if (cached && cached.expiresAt > now) {
      return { storedAt: cached.storedAt, value: cached.value, hit: true }
    }
    const pending = this.inflight.get(key)
    if (pending) {
      return pending as Promise<CacheLoadResult<T>>
    }
    const task: Promise<CacheLoadResult<T>> = this.runLoad(key, ttlSeconds, load, shouldCache)
      .finally(() => {
        if (this.inflight.get(key) === task) this.inflight.delete(key)
      })
    this.inflight.set(key, task as Promise<CacheLoadResult<unknown>>)
    return task
  }

  clear(): void {
    this.store.clear()
  }

  private async runLoad<T>(
    key: string,
    ttlSeconds: number,
    load: () => Promise<T>,
    shouldCache: (value: T) => boolean,
  ): Promise<CacheLoadResult<T>> {
    const value = await load()
    const storedAt = this.clock()
    this.pruneExpired(storedAt)
    if (shouldCache(value)) {
      this.evictOldestIfNeeded(key)
      this.store.set(key, { value, storedAt, expiresAt: storedAt + ttlSeconds * 1000 })
    }
    return { storedAt, value, hit: false }
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

export function containsFailedLoaded(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false
  if (Object.prototype.hasOwnProperty.call(value, 'ok') && (value as { ok: unknown }).ok === false) {
    return true
  }
  if (Array.isArray(value)) return value.some((item) => containsFailedLoaded(item, depth + 1))
  return Object.values(value as Record<string, unknown>).some((item) => containsFailedLoaded(item, depth + 1))
}
