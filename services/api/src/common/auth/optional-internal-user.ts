import { Logger } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { JwtService } from '@nestjs/jwt'
import type { AuthedUser } from '../decorators/current-user.decorator'
import type { UserRole } from '../decorators/roles.decorator'
import { INTERNAL_SESSION_CACHE_TTL_SECONDS } from '../constants/internal-session.constants'
import { tryRedis } from '../redis/redis-degradation'
import type { RedisService } from '../redis/redis.service'
import type { PrismaService } from '../../prisma/prisma.service'
import { assertAdminIpAllowed } from './admin-ip-allowlist'
import { readInternalSessionRevocation } from './internal-session-revocation'

interface InternalJwtPayload {
  sub?: string
  ver?: number
  jti?: unknown
  /** C 端求职者 token 带 aud='enduser';内部身份必须拒绝(双向隔离)。 */
  aud?: string
}

interface InternalSessionState {
  userId: string
  role: string
  orgId: string | null
  enabled: boolean
  tokenVersion: number
  deletedAt: string | null
  orgEnabled: boolean | null
}

/** 调用方没给 logger 时用它，保证降级日志不会静默丢失。 */
const fallbackLogger = new Logger('InternalSessionResolver')

/**
 * 把内部账号(admin / partner / kiosk)的 Bearer Token 解析成「当前仍然有效」的身份。
 *
 * 与会员侧 `resolveOptionalEndUser` 对称:JWT 只用来确定「这是谁」,
 * 角色 / 机构 / 账号是否可用一律回源数据库,绝不采信 token 里的 role / orgId 声明。
 *
 * 返回 null 表示「不是有效内部身份」。JwtAuthGuard 把 null 翻译成 401;
 * 混合鉴权路由(如 FilesController)则可以继续走会员或匿名分支。
 *
 * ── Redis 在这里到底是什么（决定了它挂掉时该怎么办）──────────────────────────
 *
 * `internal:session-state:{userId}` 不是身份缓存，鉴权路径不 GET 它。
 * 会话是否仍然有效，数据库真源是 `User.tokenVersion / enabled / deletedAt`
 * 与 `Organization.enabled`。改密、停用、删除、机构停用、手机号换绑都先提交
 * 数据库并递增 tokenVersion，再把新状态镜像进 Redis。
 * 退出当前会话另写 `internal:session-revoked:{jti}`（见 internal-session-revocation）。
 * 这份名单只在 Redis 可用时生效；连不上时不据此放行，也不据此拒绝全体会话，
 * 继续用下面的数据库检查。没有 jti 的旧凭证不查名单。
 *
 * 每次请求都直接读数据库。这是安全选择，也是性能代价：每个已登录的内部请求
 * 都会多查一次 User，partner 再查一次机构。真实负载还没有压测，门禁通过不能
 * 写成高并发已经成立。
 *
 * Redis 写入只做版本屏障。`setJsonIfVersionNotOlder` 看到更高的 tokenVersion
 * 就不覆盖；Lua 解析失败的脏值会被新值盖掉，所以这里不为脏值单独 DEL。
 * 屏障返回 stale 时本次直接拒绝：不能把那份更高版本的缓存当成当前身份，
 * 它的角色和机构可能已经和数据库不一致。读不回缓存也不退回刚读到的数据库行。
 * Redis 不可用时写入失败，仍用本次数据库快照判定。
 * 「Redis 挂了就放行」或「缓存写失败就当鉴权失败」，两者本仓都不采用。
 *
 * ── 管理员来源 IP（P1-4）──────────────────────────────────────────────────────
 *
 * `clientIp` 是必填参数（没有就传 null），好让每个调用方都必须想清楚请求从哪来：
 * 配置了 `ADMIN_IP_ALLOWLIST` 时，管理员身份只在名单内地址上成立，否则抛 403
 * （混合鉴权路由也一样：管理员令牌从名单外地址来，不退回会员或匿名分支）。
 * 判定放在身份确定**之后**、按数据库里的当前角色做，不采信 token 里的 role。
 */
export async function resolveOptionalInternalUser(
  authorization: string | undefined,
  jwtService: JwtService,
  redis: RedisService,
  prisma: PrismaService,
  clientIp: string | null,
  logger: Logger = fallbackLogger,
): Promise<AuthedUser | null> {
  if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) return null

  const token = authorization.slice(7).trim()
  let payload: InternalJwtPayload
  try {
    payload = jwtService.verify<InternalJwtPayload>(token)
  } catch {
    return null
  }
  // 隔离:C 端求职者 token(aud='enduser')不得成为内部身份。
  if (!payload.sub || payload.aud === 'enduser') return null

  const revocation = await readInternalSessionRevocation(payload.jti, redis, logger)
  if (revocation === 'reject') return null
  // Redis 名单不可用时不按 JWT 声明放行，继续做下面的数据库检查。

  const state = await loadInternalSessionState(payload.sub, redis, prisma, logger)
  if (!state || state.deletedAt !== null || !state.enabled || payload.ver !== state.tokenVersion) {
    return null
  }

  const role = state.role as UserRole
  if (role !== 'admin' && role !== 'partner' && role !== 'kiosk') return null
  if (role === 'partner' && (!state.orgId || !state.orgEnabled)) return null
  if (role === 'admin') assertAdminIpAllowed(clientIp)

  return {
    userId: state.userId,
    role,
    orgId: state.orgId,
    sessionId: createHash('sha256').update(token).digest('hex'),
  }
}

async function loadInternalSessionState(
  userId: string,
  redis: RedisService,
  prisma: PrismaService,
  logger: Logger,
): Promise<InternalSessionState | null> {
  const cacheKey = `internal:session-state:${userId}`
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, orgId: true, enabled: true, tokenVersion: true, deletedAt: true },
  })
  if (!user) return null

  let orgEnabled: boolean | null = null
  if (user.role === 'partner' && user.orgId) {
    const org = await prisma.organization.findUnique({
      where: { id: user.orgId },
      select: { enabled: true },
    })
    orgEnabled = org?.enabled ?? false
  }

  const state: InternalSessionState = {
    userId: user.id,
    role: user.role,
    orgId: user.orgId,
    enabled: user.enabled,
    tokenVersion: user.tokenVersion,
    deletedAt: user.deletedAt?.toISOString() ?? null,
    orgEnabled,
  }
  // 写入不是给下一次请求当身份缓存。失败时用本次数据库行；
  // 已有更高 tokenVersion 时不覆盖，并拒绝本次，避免采信一份可能过期的管理员快照。
  const writeResult = await tryRedis(
    'session-state:set',
    () => redis.setJsonIfVersionNotOlder(
      cacheKey,
      INTERNAL_SESSION_CACHE_TTL_SECONDS,
      JSON.stringify(state),
      state.tokenVersion,
    ),
    logger,
  )
  if (writeResult.ok && writeResult.value === 'stale') return null
  return state
}
