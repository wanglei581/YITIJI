// bundles.service.ts — 材料包服务，用 Redis 存储（24h TTL，不依赖 DB migration）
import { Inject, Injectable } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { randomBytes } from 'node:crypto'
import { REDIS_CLIENT } from '../common/redis/redis.service'
import type { BundleItem, CreateBundleDto } from './bundles.dto'

const BUNDLE_TTL_SEC = 24 * 60 * 60        // 24h
const USER_IDX_TTL_SEC = 24 * 60 * 60 + 60 // 比 bundle 多1min

function bundleKey(endUserId: string, bundleId: string) {
  return `bundle:v1:${endUserId}:${bundleId}`
}
function userIdxKey(endUserId: string) {
  return `bundle:v1:idx:${endUserId}`
}

function genPickupCode(): string {
  return randomBytes(3).toString('hex').toUpperCase()   // 6位 hex大写，如 A3F09B
}

@Injectable()
export class BundlesService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async create(endUserId: string, dto: CreateBundleDto): Promise<BundleItem> {
    const bundleId   = `bnd_${randomBytes(8).toString('hex')}`
    const pickupCode = genPickupCode()
    const now        = new Date()
    const expiresAt  = new Date(now.getTime() + BUNDLE_TTL_SEC * 1000)

    const bundle: BundleItem = {
      bundleId,
      endUserId,
      name:        dto.name,
      status:      'pending',
      pickupCode,
      files:       dto.files,
      printParams: dto.printParams,
      createdAt:   now.toISOString(),
      expiresAt:   expiresAt.toISOString(),
    }

    const pipeline = this.redis.pipeline()
    pipeline.set(bundleKey(endUserId, bundleId), JSON.stringify(bundle), 'EX', BUNDLE_TTL_SEC)
    pipeline.sadd(userIdxKey(endUserId), bundleId)
    pipeline.expire(userIdxKey(endUserId), USER_IDX_TTL_SEC)
    await pipeline.exec()

    return bundle
  }

  async list(endUserId: string): Promise<{ items: BundleItem[]; total: number }> {
    const ids = await this.redis.smembers(userIdxKey(endUserId))
    if (!ids.length) return { items: [], total: 0 }

    const keys = ids.map(id => bundleKey(endUserId, id))
    const raws = await this.redis.mget(...keys)
    const items: BundleItem[] = []

    for (const raw of raws) {
      if (!raw) continue
      try {
        const b = JSON.parse(raw) as BundleItem
        // 过滤过期的（Redis TTL 已清除 key，但 Set 里仍有 id）
        if (b.status !== 'expired') items.push(b)
      } catch { /* 忽略损坏记录 */ }
    }

    // 按创建时间倒序
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return { items, total: items.length }
  }

  async findOne(endUserId: string, bundleId: string): Promise<BundleItem | null> {
    const raw = await this.redis.get(bundleKey(endUserId, bundleId))
    if (!raw) return null
    try { return JSON.parse(raw) as BundleItem } catch { return null }
  }

  async updateStatus(endUserId: string, bundleId: string, status: BundleItem['status']): Promise<void> {
    const key = bundleKey(endUserId, bundleId)
    const raw = await this.redis.get(key)
    if (!raw) return
    try {
      const b: BundleItem = JSON.parse(raw)
      b.status = status
      const ttl = await this.redis.ttl(key)
      await this.redis.set(key, JSON.stringify(b), 'EX', Math.max(ttl, 1))
    } catch { /* 忽略 */ }
  }
}
