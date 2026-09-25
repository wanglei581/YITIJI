/**
 * 取件码认领：按**终端**的失败次数锁定（产品裁决 2026-08-18 方案 A 的一部分）。
 *
 * ── 为什么必须有它 ──────────────────────────────────────────────────────
 * 8 位码（S=10^8）+ 7 天有效期，**单靠 20 次/分钟的限流仍不够**：
 * N=350 枚在用码（日单量 50 × 7 天）时，7 天窗口内 K=201,600 次尝试，
 * 至少命中一次的概率 = 1 − exp(−N·K/S) ≈ **50.6%**。
 * 本模块把 K 压到约 4,032（见下），概率降到约 **1.4%**。
 * 也就是说：**这不是锦上添花，是承重构件。** 动参数前先重算。
 *
 * ── 为什么按终端而不是按 IP ─────────────────────────────────────────────
 * 既有 `@Throttle` 的 default 桶按**出口 IP** 计数，换 IP 即换配额，
 * 对有代理池的攻击者近乎无效。而取件码本来就绑死在某一台终端上
 * （`PICKUP_TERMINAL_MISMATCH`），所以「针对某台终端的猜测」才是要限的那个量。
 *
 * ── 三条约束的取舍（协调方明确要求写清楚）──────────────────────────────
 *
 * 1. **按终端不按 IP** —— 见上。
 *
 * 2. **正常用户手误几次不受影响**：
 *    - 阈值 10 次失败 / 10 分钟窗口。8 位码手输错 10 次本身已属异常。
 *    - **成功认领会清零计数**（`clearOnSuccess`）。这一条是关键：
 *      繁忙机器上成功远多于失败，计数根本攒不起来；而纯枚举场景没有成功，
 *      计数会一路涨到阈值。用「有没有成功」把真实用户和枚举者分开，
 *      比单纯调高阈值精确得多。
 *
 * 3. **锁定本身不能变成拒绝服务**：这是**无法完全消除**的固有代价 ——
 *    只要「达到阈值就不再检查码」，故意打错码的人就能让那台机器停一会儿。
 *    我们做的是把代价压到有限且可恢复：
 *    - 锁定 15 分钟自动解除，不需要人工干预，不落库、不产生持久状态；
 *    - 作用域仅限**那一台终端**，同场地其它机器不受影响；
 *    - 锁定期间前台明确提示「请找现场工作人员」，不是无声失败；
 *    - 攻击者必须持续在场重复投入（每 25 分钟换 10 次失败），
 *      而不是打一枪就能长期瘫痪。
 *    残留风险与后续选项（现场工作人员绕行通道）记在 PR 正文，本轮不做。
 *
 * ── Redis 不可用时：进程内有界兜底，限额不变 ────────────────────────────
 * 不再无条件放行。计数和锁定落到本进程内存（容量有上限、自动过期）。
 * 没超过阈值的真实取件仍然成功，所以正常取件不依赖 Redis 存活；
 * 超过阈值的尝试照样被拒绝。Redis 恢复后仍只认 Redis，不读这份内存。
 */
import { Logger } from '@nestjs/common'
import { tryRedis } from '../common/redis/redis-degradation'
import type { RedisService } from '../common/redis/redis.service'
import { memoryDelete, memoryHas, memoryIncrement, memorySet } from './pickup-claim-memory'

/** 失败计数滑动窗口（秒）。 */
export const PICKUP_LOCKOUT_WINDOW_SECONDS = 10 * 60

/** 窗口内允许的失败次数；**第 (阈值+1) 次**起进入锁定。 */
export const PICKUP_LOCKOUT_FAILURE_THRESHOLD = 10

/** 锁定时长（秒）。到点自动解除，无需人工。 */
export const PICKUP_LOCKOUT_SECONDS = 15 * 60

const logger = new Logger('PickupClaimLockout')

const failureKey = (terminalId: string): string => `pickup:claim:fail:${terminalId}`
const lockKey = (terminalId: string): string => `pickup:claim:lock:${terminalId}`

/**
 * 该终端当前是否处于锁定中。
 *
 * Redis 正常时只看 Redis。Redis 不可用时看进程内锁定标记。
 */
export async function isPickupClaimLocked(redis: RedisService, terminalId: string): Promise<boolean> {
  const attempt = await tryRedis('pickup-claim-lock-get', () => redis.get(lockKey(terminalId)), logger)
  if (attempt.ok) return attempt.value !== null
  return memoryHas(lockKey(terminalId))
}

/**
 * 记一次**认领失败**（码不存在 / 码存在但不属于本终端）。
 * 达到阈值时置锁并返回 true。
 *
 * 只统计能用于枚举的失败。「码已过期」「码当前不可用」这类
 * 说明用户手里确实拿着一枚真码的情况不计入，避免把正常用户算成攻击者。
 */
export async function recordPickupClaimFailure(redis: RedisService, terminalId: string): Promise<boolean> {
  const attempt = await tryRedis(
    'pickup-claim-fail-incr',
    () => redis.incrWithTtl(failureKey(terminalId), PICKUP_LOCKOUT_WINDOW_SECONDS),
    logger,
  )
  const failures = attempt.ok
    ? attempt.value
    : memoryIncrement(failureKey(terminalId), PICKUP_LOCKOUT_WINDOW_SECONDS)
  if (failures !== null && failures < PICKUP_LOCKOUT_FAILURE_THRESHOLD) return false

  if (attempt.ok) {
    await tryRedis(
      'pickup-claim-lock-set',
      () => redis.setEx(lockKey(terminalId), PICKUP_LOCKOUT_SECONDS, String(Date.now())),
      logger,
    )
  } else {
    memorySet(lockKey(terminalId), PICKUP_LOCKOUT_SECONDS)
  }
  // 运营可见性：锁定是运维事件，必须能在服务端日志里看到是哪台机器、攒了多少次。
  logger.warn(
    `取件码认领失败次数达阈值，终端已锁定 ${PICKUP_LOCKOUT_SECONDS}s：` +
      `terminalId=${terminalId} failures=${failures ?? 'memory-full'} window=${PICKUP_LOCKOUT_WINDOW_SECONDS}s`,
  )
  return true
}

/**
 * 认领成功后清零失败计数。
 *
 * 这是「正常用户不受影响」那条约束的主要实现手段，不是可选优化：
 * 没有它，繁忙机器上零散的手误会日积月累撞上阈值。
 */
export async function clearPickupClaimFailures(redis: RedisService, terminalId: string): Promise<void> {
  const attempt = await tryRedis('pickup-claim-fail-clear', () => redis.del(failureKey(terminalId)), logger)
  if (!attempt.ok) memoryDelete(failureKey(terminalId))
}
