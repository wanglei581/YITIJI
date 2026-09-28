import { HttpException, HttpStatus, type Logger } from '@nestjs/common'
import * as bcrypt from 'bcryptjs'
import { createHash } from 'crypto'
import { tryRedis } from '../common/redis/redis-degradation'
import type { RedisService } from '../common/redis/redis.service'

/**
 * 内部账号（管理员 / 合作机构 / 一体机内部账号）密码登录的失败次数闸门。
 *
 * 为什么从 auth.service.ts 拆出来：那个文件已到 800 行线（CLAUDE.md §8），
 * 而 P1-4 要在这里改语义，改完的判定也要被门禁单独驱动。
 *
 * 口径（P1-4，2026-09-29；feature-scope §七 #27）：
 * - **先原子预留一次尝试额度，再比对密码**；登录成功后清零。
 *   旧实现是「先读计数、比对失败后再加一」：读与加之间不原子，同一时刻的一批错误密码
 *   能同时通过检查；更要紧的是读失败被当成「没锁」直接放行——Redis 一挂，
 *   撞库就没有次数上限（旧 auth.service.ts:756-757 的 `failures.ok && ...`）。
 * - **Redis 不可用、超时或拒绝写入时一律拒绝登录（503）**，不放行，也不退化成「只剩
 *   IP 限流」。这不影响已经登录的人：内部会话鉴权回源数据库（common/auth/optional-internal-user.ts）。
 * - 身份键（登录名 + 入口）在查库之前就预留，未知账号同样计数，不暴露账号是否存在；
 *   账号键（用户 id + 入口）让换登录别名（用户名 / 邮箱 / 手机号）绕不过锁定。
 */

export const PASSWORD_LOGIN_FAILURE_LIMIT = 5
export const PASSWORD_LOGIN_FAILURE_TTL_SECONDS = 15 * 60

export type PasswordLoginPortal = 'admin' | 'partner' | 'kiosk'

/**
 * 与真实账号同成本（bcrypt cost 10，见 auth.service 的 bcrypt.hash(…, 10)）的一份固定哈希，
 * 对应的原文随机生成后丢弃，任何输入都比对不上。账号不存在 / 不可用时也做一次比对，
 * 让两条路径耗时相近：否则「查无此人几毫秒、有人一百毫秒」本身就能拿来枚举账号（agy 9/29 反例 6.2）。
 */
const PASSWORD_TIMING_EQUALIZER_HASH = '$2b$10$P0PZrHfaRf9HkDF00nbWmOaR0i.a2yMw2x1JPFsEF8HHft8U4TXEW'

export async function equalizePasswordCompareTiming(password: string): Promise<void> {
  await bcrypt.compare(password, PASSWORD_TIMING_EQUALIZER_HASH)
}

export function passwordLoginIdentityKey(loginId: string, portal: PasswordLoginPortal): string {
  const normalized = loginId.trim().toLowerCase()
  const digest = createHash('sha256').update(`${portal}:${normalized}`).digest('hex')
  return `internal:password-login:identity-failures:${digest}`
}

export function passwordLoginAccountKey(userId: string, portal: PasswordLoginPortal): string {
  return `internal:password-login:account-failures:${portal}:${userId}`
}

export function passwordLoginLocked(): HttpException {
  return new HttpException({
    error: { code: 'AUTH_LOGIN_LOCKED', message: '账号登录失败次数过多，请 15 分钟后重试' },
  }, HttpStatus.TOO_MANY_REQUESTS)
}

export function passwordLoginUnavailable(): HttpException {
  return new HttpException({
    error: {
      code: 'AUTH_LOGIN_UNAVAILABLE',
      message: '登录暂时不可用：登录次数校验暂时做不了，为防止密码被反复试探，先暂停登录。请稍后再试，已登录的页面不受影响',
    },
  }, HttpStatus.SERVICE_UNAVAILABLE)
}

/**
 * 预留一次尝试。达到上限抛 429；Redis 读写不成功抛 503（失败关闭）。
 * 预留在比对密码之前完成，所以并发请求也只有前 N 个能走到比对。
 */
export async function reservePasswordLoginAttempt(
  redis: RedisService,
  key: string,
  logger: Logger,
): Promise<void> {
  const reserved = await tryRedis(
    'password-login-attempt:reserve',
    () => redis.reserveWithinLimitWithTtl(key, PASSWORD_LOGIN_FAILURE_TTL_SECONDS, PASSWORD_LOGIN_FAILURE_LIMIT),
    logger,
  )
  if (!reserved.ok) throw passwordLoginUnavailable()
  if (!reserved.value) throw passwordLoginLocked()
}

/**
 * 登录成功后清零。清不掉不影响本次登录（计数会在窗口到期后自然失效），
 * 最坏情况是本人下次多占一次额度，不会让任何人多试一次密码。
 */
export async function clearPasswordLoginAttempts(
  redis: RedisService,
  keys: readonly string[],
  logger: Logger,
): Promise<void> {
  await Promise.all(keys.map((key) => tryRedis('password-login-attempt:clear', () => redis.del(key), logger)))
}
