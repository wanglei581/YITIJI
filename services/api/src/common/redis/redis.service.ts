import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { Redis } from 'ioredis'

export const REDIS_CLIENT = Symbol('REDIS_CLIENT')

/**
 * ioredis 薄封装。阶段 A(member-auth)用于:
 *   - 短信验证码(TTL 5min,用后删除)
 *   - 多维频控计数(手机号/IP/设备)
 *   - C 端登录会话(member:session:{jti}),logout/idle 时删除即失效
 *
 * 只暴露用到的原子操作,避免散落 raw client 调用。
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  async getDel(key: string): Promise<string | null> {
    const value = await this.client.call('GETDEL', key)
    return typeof value === 'string' ? value : null
  }

  async getAndDelIfEquals(key: string, expectedValue: string): Promise<'missing' | 'matched' | 'mismatched'> {
    const result = await this.client.eval(
      `
      local value = redis.call('GET', KEYS[1])
      if not value then return 0 end
      if value == ARGV[1] then
        redis.call('DEL', KEYS[1])
        return 1
      end
      return -1
      `,
      1,
      key,
      expectedValue,
    )
    if (result === 1) return 'matched'
    if (result === -1) return 'mismatched'
    return 'missing'
  }

  async getDelAndSetEx(
    key: string,
    markerKey: string,
    markerTtlSeconds: number,
    markerValue: string,
  ): Promise<string | null> {
    const value = await this.client.eval(
      `
      local value = redis.call('GET', KEYS[1])
      if not value then return nil end
      redis.call('DEL', KEYS[1])
      redis.call('SET', KEYS[2], ARGV[2], 'EX', tonumber(ARGV[1]))
      return value
      `,
      2,
      key,
      markerKey,
      markerTtlSeconds,
      markerValue,
    )
    return typeof value === 'string' ? value : null
  }

  async setExistingWithCurrentTtl(key: string, value: string): Promise<'missing' | 'updated'> {
    const result = await this.client.eval(
      `
      local ttl = redis.call('TTL', KEYS[1])
      if ttl <= 0 then return 0 end
      redis.call('SET', KEYS[1], ARGV[1], 'EX', ttl)
      return 1
      `,
      1,
      key,
      value,
    )
    return result === 1 ? 'updated' : 'missing'
  }

  ttl(key: string): Promise<number> {
    return this.client.ttl(key)
  }

  /** SET key val EX ttl(秒) */
  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    await this.client.set(key, value, 'EX', ttlSeconds)
  }

  del(key: string): Promise<number> {
    return this.client.del(key)
  }

  /** SET key val NX EX ttl — 仅当 key 不存在时写入,返回是否写入成功(用于冷却闸)。 */
  async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const res = await this.client.set(key, value, 'EX', ttlSeconds, 'NX')
    return res === 'OK'
  }

  /** INCR 并在首次出现时设置过期,返回自增后的值(用于滑动窗口计数)。 */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const n = await this.client.incr(key)
    if (n === 1) {
      await this.client.expire(key, ttlSeconds)
    }
    return n
  }

  onModuleDestroy(): void {
    this.client.disconnect()
  }
}
