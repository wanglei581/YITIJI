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
