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
 * `internal:session-state:{userId}` 是**数据库行的只读缓存**，不是登出黑名单：
 * 会话是否仍然有效，唯一真源是 `User` 表的 `tokenVersion / enabled / deletedAt`
 * 与 `Organization.enabled`。全部撤销动作（改密、禁用账号、删除账号、机构停用、
 * 手机号换绑）都是先提交数据库，再把新状态**镜像**进 Redis；
 * `POST /auth/logout` 在源码注释里已明确声明「本端点不声称在服务端撤销已签发 JWT」。
 *
 * 因此 Redis 不可用时绕过缓存直接回源数据库，**不是放松鉴权**：
 * 它得到的是与缓存命中时同一个判据的、更新鲜的版本，
 * 反而消掉了缓存最多 60s 的陈旧窗口。真正危险的做法是相反方向 ——
 * 「Redis 挂了就放行」或「缓存写失败就当鉴权失败」，两者本仓都不采用。
 *
 * 缓存写入失败同理不影响判定：下次请求读不到缓存就再回源一次。
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
  // 缓存读取有界且绝不抛出：读不到（超时/故障/未命中）一律按未命中处理，回源数据库。
  const cached = await tryRedis('session-state:get', () => redis.get(cacheKey), logger)
  if (cached.ok && cached.value) {
    const parsed = parseInternalSessionState(cached.value)
    if (parsed) {
      if (parsed.role !== 'partner') return parsed
      // Partner 缓存命中也必须回源，避免 Redis 残留把已删除账号短暂复活。
      return loadInternalSessionStateFromDatabase(userId, cacheKey, redis, prisma, logger)
    }
    await tryRedis('session-state:del', () => redis.del(cacheKey), logger)
  }

  return loadInternalSessionStateFromDatabase(userId, cacheKey, redis, prisma, logger)
}

async function loadInternalSessionStateFromDatabase(
  userId: string,
  cacheKey: string,
  redis: RedisService,
  prisma: PrismaService,
  logger: Logger,
): Promise<InternalSessionState | null> {
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
  // 回写只是加速下一次请求。写失败不改变本次判定 —— state 已经是数据库真源。
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
  if (writeResult.ok && writeResult.value === 'stale') {
    // 缓存里有更高的 tokenVersion（并发撤销已经先落缓存）——以那份更新的为准。
    // 读不回来时退回本次数据库快照，不会因此放行更旧的版本。
    const latest = await tryRedis('session-state:get', () => redis.get(cacheKey), logger)
    const parsed = latest.ok && latest.value ? parseInternalSessionState(latest.value) : null
    return parsed ?? state
  }
  return state
}

function parseInternalSessionState(raw: string): InternalSessionState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<InternalSessionState>
    if (
      typeof parsed.userId !== 'string'
      || typeof parsed.tokenVersion !== 'number'
      || typeof parsed.enabled !== 'boolean'
      || (typeof parsed.deletedAt !== 'string' && parsed.deletedAt !== null)
    ) return null
    return parsed as InternalSessionState
  } catch {
    return null
  }
}
