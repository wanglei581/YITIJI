import { Logger, ServiceUnavailableException } from '@nestjs/common'
import type { JwtService } from '@nestjs/jwt'
import { tryRedis } from '../redis/redis-degradation'

/**
 * 内部账号「退出当前会话」的 Redis 名单。
 *
 * 键只在 Redis 活着时有效，TTL 取该 JWT 剩余寿命，不另建会话表。
 * Redis 连不上时，退出接口必须失败（不能假装已经撤销）；
 * 鉴权则回源数据库，停用 / 删除 / tokenVersion 不一致仍然拒绝。
 * 没有 jti 的旧凭证不进这份名单，继续只受数据库版本与过期时间约束。
 */
const REVOKED_PREFIX = 'internal:session-revoked:'
const SAFE_JTI = /^[A-Za-z0-9_-]{16,128}$/
const FALLBACK_TTL_SECONDS = 24 * 60 * 60
const fallbackLogger = new Logger('InternalSessionRevocation')

export type InternalSessionRevocation = 'clear' | 'reject' | 'unavailable'

export function internalSessionRevokedKey(jti: string): string {
  return `${REVOKED_PREFIX}${jti}`
}

function classifyJti(jti: unknown): 'absent' | 'unsafe' | 'safe' {
  if (jti === undefined || jti === null || jti === '') return 'absent'
  if (typeof jti !== 'string' || !SAFE_JTI.test(jti)) return 'unsafe'
  return 'safe'
}

function remainingTtlSeconds(exp: unknown): number {
  const now = Math.floor(Date.now() / 1000)
  if (typeof exp === 'number' && Number.isFinite(exp)) return Math.max(1, Math.floor(exp) - now)
  return FALLBACK_TTL_SECONDS
}

interface RevocationRedis {
  get?: (key: string) => Promise<string | null>
  set?: (key: string, value: string, ttlSeconds: number) => Promise<void>
}

/**
 * 验签之后判断这个 jti 是否已退出。
 * `unavailable` 只表示名单读不到（连接失败），调用方必须继续查库，不能放行。
 * Redis 活着但命令被拒（ReplyError）按已撤销处理，避免名单故障时放行。
 */
export async function readInternalSessionRevocation(
  jti: unknown,
  redis: RevocationRedis,
  logger: Logger = fallbackLogger,
): Promise<InternalSessionRevocation> {
  const kind = classifyJti(jti)
  if (kind === 'absent') return 'clear'
  if (kind === 'unsafe') return 'reject'
  if (typeof redis.get !== 'function') return 'unavailable'
  const attempt = await tryRedis(
    'internal-session-revoked:get',
    () => redis.get!(internalSessionRevokedKey(jti as string)),
    logger,
  )
  if (!attempt.ok) return attempt.reason === 'rejected' ? 'reject' : 'unavailable'
  return attempt.value ? 'reject' : 'clear'
}

function logoutUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    error: { code: 'AUTH_LOGOUT_UNAVAILABLE', message: '暂时无法退出，请稍后再试' },
  })
}

/**
 * 把当前 Bearer 的 jti 写入撤销名单。没有 jti 的旧凭证跳过（调用方仍可清理别的 Redis 状态）。
 * 写入失败抛 503，调用方不得再返回退出成功。
 */
export async function revokeIssuedInternalSession(
  authorization: string | string[] | undefined,
  jwtService: Pick<JwtService, 'decode'>,
  redis: RevocationRedis,
  logger: Logger = fallbackLogger,
): Promise<void> {
  const header = Array.isArray(authorization) ? authorization[0] : authorization
  if (!header || !header.toLowerCase().startsWith('bearer ')) throw logoutUnavailable()
  const token = header.slice(7).trim()
  const decoded = jwtService.decode(token)
  const payload = decoded && typeof decoded === 'object'
    ? decoded as { jti?: unknown; exp?: unknown; sub?: unknown }
    : null
  const kind = classifyJti(payload?.jti)
  if (kind === 'unsafe') throw logoutUnavailable()
  if (kind === 'absent') return
  if (typeof redis.set !== 'function') throw logoutUnavailable()
  const userId = typeof payload?.sub === 'string' && payload.sub.length > 0 ? payload.sub : 'revoked'
  const attempt = await tryRedis(
    'internal-session-revoked:set',
    () => redis.set!(internalSessionRevokedKey(payload?.jti as string), userId, remainingTtlSeconds(payload?.exp)),
    logger,
  )
  if (!attempt.ok) throw logoutUnavailable()
}
