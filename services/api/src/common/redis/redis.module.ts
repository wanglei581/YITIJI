import { Global, Module } from '@nestjs/common'
import { Redis } from 'ioredis'
import { MemberDataExportRedisService } from './member-data-export-redis.service'
import { PartnerAccountActionRedisService } from './partner-account-action-redis.service'
import { RedisConnectivityService } from './redis-connectivity.service'
import { redisClientOptions } from './redis-client-options'
import { REDIS_CLIENT, RedisService } from './redis.service'

/**
 * 全局 Redis 模块。阶段 A 起 member-auth 强依赖 Redis(会话/验证码/频控)。
 *
 * REDIS_URL 必须配置;未配置直接抛错,避免会话/验证码静默落到内存导致
 * 多实例不一致、重启丢会话、频控失效等安全问题。
 *
 * 启动语义 = degraded-start（Redis 是软依赖，数据库才是硬依赖）：
 * Redis 不可达时进程照常 listen，但相关能力进入**显式**降级态 ——
 * 日志有可搜索的 `BOOT_DEPENDENCY_DEGRADED subsystem=redis` 错误行，
 * `GET /api/v1/health` 返回 `status: "degraded"` 并列出受影响子系统，
 * `GET /api/v1/health/ready` 返回 503。Redis 恢复连接后状态自动标回 ok。
 *
 * ⚠ 这段注释此前写的是「Redis 暂时不可达不会阻塞应用启动」，与实测行为相反：
 * BullMQ 给自建连接强制 `maxRetriesPerRequest: null`，命令被无限排进 offline queue，
 * `MemberPrivacyScheduler.onModuleInit()` 的 `upsertJobScheduler()` 永不 settle，
 * 整个 Nest 启动卡在 `app.listen()` 之前 —— 进程活着、端口是死的。
 * 现已由 `RedisConnectivityService` + `withBootTimeout()` 兜底，注释与行为对齐。
 *
 * 注意区分两条 Redis 路径（两者行为不同，不要混谈）：
 * - 这里的裸 ioredis 客户端：不设 `REDIS_MAX_RETRIES_PER_REQUEST` 时仍是 ioredis 默认 20
 *   （该变量只给验证把重试改小，生产不要设）。
 *   Redis 不可达时命令会在 ~10s 后以 MaxRetriesPerRequestError **显式 reject**，
 *   请求层不会静默挂起（显式报错优于静默放行）。
 * - BullMQ 自建连接：`maxRetriesPerRequest: null`，命令永不 reject。
 *   任何在启动期 await BullMQ 命令的地方都必须包 `withBootTimeout()`。
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
        const options = redisClientOptions()
        // 未设置时保持原来的 `new Redis(url)`，不把空对象传进去。
        return Object.keys(options).length === 0 ? new Redis(url) : new Redis(url, options)
      },
    },
    RedisService,
    RedisConnectivityService,
    MemberDataExportRedisService,
    PartnerAccountActionRedisService,
  ],
  exports: [REDIS_CLIENT, RedisService, MemberDataExportRedisService, PartnerAccountActionRedisService],
})
export class RedisModule {}
