import { Global, Module } from '@nestjs/common'
import { Redis } from 'ioredis'
import { MemberDataExportRedisService } from './member-data-export-redis.service'
import { REDIS_CLIENT, RedisService } from './redis.service'

/**
 * 全局 Redis 模块。阶段 A 起 member-auth 强依赖 Redis(会话/验证码/频控)。
 *
 * REDIS_URL 必须配置;未配置直接抛错,避免会话/验证码静默落到内存导致
 * 多实例不一致、重启丢会话、频控失效等安全问题。
 *
 * 连接惰性重试由 ioredis 默认 retryStrategy 处理,Redis 暂时不可达不会阻塞应用启动,
 * 但相关请求会在命令层失败(显式报错优于静默放行)。
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (): Redis => {
        const url = process.env['REDIS_URL']
        if (!url) {
          throw new Error('REDIS_URL 未配置。member-auth(C 端登录会话/验证码/频控)强依赖 Redis,请在 services/api/.env 中设置。')
        }
        return new Redis(url)
      },
    },
    RedisService,
    MemberDataExportRedisService,
  ],
  exports: [RedisService, MemberDataExportRedisService],
})
export class RedisModule {}
