import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { Redis } from 'ioredis'
import {
  BOOT_DEGRADED_LOG_MARKER,
  BOOT_RECOVERED_LOG_MARKER,
  REDIS_SUBSYSTEM,
  bootReadiness,
  readTimeoutMs,
  withBootTimeout,
} from '../boot/boot-readiness'
import { REDIS_DEGRADED_IMPACT, redisDegradedImpactSentence } from './redis-degradation'
import { REDIS_CLIENT } from './redis.service'

/** 启动期 Redis 探活超时。默认 5s：足够本机/同机房握手，又不会把启动拖长。 */
const DEFAULT_BOOT_PROBE_TIMEOUT_MS = 5_000

/**
 * 把 REDIS_URL 收敛成可写进日志的 host:port，丢掉用户名/密码。
 * 解析失败时返回固定占位符，绝不回显原串（可能含密码）。
 */
export function redisTargetLabel(url: string | undefined): string {
  if (!url) return '<unset>'
  try {
    const parsed = new URL(url)
    return `${parsed.hostname || 'localhost'}:${parsed.port || '6379'}`
  } catch {
    return '<unparsable>'
  }
}

/**
 * 启动期 Redis 探活。
 *
 * 存在的唯一理由：让「Redis 连不上」在日志里是一条**明确、可搜索**的错误行，
 * 而不是一串 ioredis ECONNREFUSED 重试噪声（远端被防火墙丢包时连噪声都没有 ——
 * 实测黑洞 IP 30s 内 ioredis 一个 error 事件都不发）。
 *
 * 有界：PING 走 withBootTimeout，不会把 onModuleInit 挂住。
 * 不改变正常路径：Redis 可达时只多一次 PING，随后照常。
 */
@Injectable()
export class RedisConnectivityService implements OnModuleInit {
  private readonly logger = new Logger(RedisConnectivityService.name)

  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onModuleInit(): Promise<void> {
    const target = redisTargetLabel(process.env['REDIS_URL'])
    const timeoutMs = readTimeoutMs('REDIS_BOOT_PROBE_TIMEOUT_MS', DEFAULT_BOOT_PROBE_TIMEOUT_MS)

    // 降级后 Redis 再连上时把状态标回 ok，健康检查不会一直挂着过期的降级结论。
    this.client.on('ready', () => {
      if (!bootReadiness.isDegraded(REDIS_SUBSYSTEM)) return
      bootReadiness.markOk(REDIS_SUBSYSTEM, 'REDIS_REACHABLE', `Redis 已恢复连接（${target}）`)
      this.logger.log(`${BOOT_RECOVERED_LOG_MARKER} subsystem=${REDIS_SUBSYSTEM} target=${target}`)
    })

    try {
      await withBootTimeout(() => this.client.ping(), {
        subsystem: REDIS_SUBSYSTEM,
        operation: 'PING',
        timeoutMs,
      })
      bootReadiness.markOk(REDIS_SUBSYSTEM, 'REDIS_REACHABLE', `Redis 可达（${target}）`)
      this.logger.log(`Redis 可达 target=${target}`)
    } catch (error) {
      const detail = error instanceof Error ? error.name : 'UnknownError'
      // ⚠️ 这段文案此前写的是「打印、终端 Agent、管理端、合作机构端不受影响」——
      // 与实测相反：管理端 / 合作机构端经 JwtAuthGuard 读会话状态缓存，
      // Redis 挂掉时每个带守卫的端点都 500（单请求实测 37.9s）。
      // 健康检查撒谎比服务挂掉更糟：它让运维不去查。现在文案与
      // REDIS_DEGRADED_IMPACT 同源，并由 verify:redis-degradation-truth 逐条实测核对。
      const message =
        `Redis 在启动期不可达（${target}，${timeoutMs}ms 内未响应 PING，${detail}）。` +
        redisDegradedImpactSentence() +
        '请检查 REDIS_URL、Redis 进程是否在运行、以及主机间防火墙/安全组是否放行该端口。'
      bootReadiness.markDegraded(REDIS_SUBSYSTEM, 'REDIS_UNREACHABLE_AT_BOOT', message, REDIS_DEGRADED_IMPACT)
      // 一条可 grep 的定长错误行 + 一条给人看的说明，二者都不含凭证。
      this.logger.error(
        `${BOOT_DEGRADED_LOG_MARKER} subsystem=${REDIS_SUBSYSTEM} code=REDIS_UNREACHABLE_AT_BOOT ` +
          `target=${target} timeoutMs=${timeoutMs} errorType=${detail}`,
      )
      this.logger.error(message)
    }
  }
}
