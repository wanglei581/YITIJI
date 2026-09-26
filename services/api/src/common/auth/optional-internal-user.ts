import { Logger } from '@nestjs/common'
import { createHash } from 'node:crypto'
import type { JwtService } from '@nestjs/jwt'
import type { AuthedUser } from '../decorators/current-user.decorator'
import type { UserRole } from '../decorators/roles.decorator'
import { INTERNAL_SESSION_CACHE_TTL_SECONDS } from '../constants/internal-session.constants'
import { tryRedis } from '../redis/redis-degradation'
import type { RedisService } from '../redis/redis.service'
import type { PrismaService } from '../../prisma/prisma.service'

interface InternalJwtPayload {
  sub?: string
  ver?: number
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
 * `internal:session-state:{userId}` 不是登出黑名单，也不作为本次请求的身份。
 * 会话是否仍然有效，唯一真源是 `User` 表的 `tokenVersion / enabled / deletedAt`
 * 与 `Organization.enabled`。全部撤销动作（改密、禁用账号、删除账号、机构停用、
 * 手机号换绑）都是先提交数据库，再把新状态**镜像**进 Redis；
 * `POST /auth/logout` 在源码注释里已明确声明「本端点不声称在服务端撤销已签发 JWT」。
 *
 * 每次请求都直接读数据库，鉴权路径不再 GET 这份缓存。这是安全选择，
 * 也是性能代价：每个已登录的内部请求都会多查一次 User，partner 再查一次机构。
 * 真实负载还没有压测，门禁通过不能写成高并发已经成立。
 *
 * Redis 写入只做版本屏障。`setJsonIfVersionNotOlder` 看到更高的 tokenVersion
 * 就不覆盖；Lua 解析失败的脏值会被新值盖掉，所以这里不为脏值单独 DEL。
 * 屏障返回 stale 时本次直接拒绝：不能把那份更高版本的缓存当成当前身份，
 * 它的角色和机构可能已经和数据库不一致。读不回缓存也不退回刚读到的数据库行。
 * Redis 不可用时写入失败，仍用本次数据库快照判定。
 * 「Redis 挂了就放行」或「缓存写失败就当鉴权失败」，两者本仓都不采用。
 */
export async function resolveOptionalInternalUser(
  authorization: string | undefined,
  jwtService: JwtService,
  redis: RedisService,
  prisma: PrismaService,
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

  const state = await loadInternalSessionState(payload.sub, redis, prisma, logger)
  if (!state || state.deletedAt !== null || !state.enabled || payload.ver !== state.tokenVersion) {
    return null
  }

  const role = state.role as UserRole
  if (role !== 'admin' && role !== 'partner' && role !== 'kiosk') return null
  if (role === 'partner' && (!state.orgId || !state.orgEnabled)) return null

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
