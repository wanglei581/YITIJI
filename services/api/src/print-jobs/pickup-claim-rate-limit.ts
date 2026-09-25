/**
 * 到机认领的服务端限流：按终端、按来源（调用方 IP / 调用方给定的来源键）各一桶。
 *
 * 与 `pickup-claim-lockout.ts` 分工：锁定只数「码不存在 / 走错终端」；
 * 本模块数每一次认领尝试，包括过期码。Redis 不可用时放行，与锁定同一 fail-open，
 * 避免 Redis 故障时已付款用户取不到件（`terminal-agent-print: unaffected`）。
 */
import { createHash } from 'crypto'
import { Logger } from '@nestjs/common'
import { tryRedis } from '../common/redis/redis-degradation'
import type { RedisService } from '../common/redis/redis.service'

/** 同一终端每分钟认领尝试上限（含成功与失败）。 */
export const PICKUP_CLAIM_TERMINAL_RATE_LIMIT = 40

/** 同一来源每分钟认领尝试上限。低于终端桶，便于单独打满来源而不锁死整台机器。 */
export const PICKUP_CLAIM_SOURCE_RATE_LIMIT = 20

export const PICKUP_CLAIM_RATE_WINDOW_SECONDS = 60

const logger = new Logger('PickupClaimRateLimit')

function sourceBucket(source: string | undefined): string {
  const raw = source?.trim() || 'unknown'
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 24)
  return `pickup:claim:rate:s:${digest}`
}

function terminalBucket(terminalId: string): string {
  return `pickup:claim:rate:t:${terminalId}`
}

/** 返回 true 表示本请求已超过终端或来源限额，调用方应直接拒绝、不再查码。 */
export async function consumePickupClaimRate(
  redis: RedisService,
  terminalId: string,
  source: string | undefined,
): Promise<boolean> {
  const src = await tryRedis(
    'pickup-claim-rate-source',
    () => redis.incrWithTtl(sourceBucket(source), PICKUP_CLAIM_RATE_WINDOW_SECONDS),
    logger,
  )
  if (src.ok && src.value > PICKUP_CLAIM_SOURCE_RATE_LIMIT) return true
  const term = await tryRedis(
    'pickup-claim-rate-terminal',
    () => redis.incrWithTtl(terminalBucket(terminalId), PICKUP_CLAIM_RATE_WINDOW_SECONDS),
    logger,
  )
  return term.ok && term.value > PICKUP_CLAIM_TERMINAL_RATE_LIMIT
}
