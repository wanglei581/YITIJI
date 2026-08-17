import { createHash } from 'node:crypto'
import type { JwtService } from '@nestjs/jwt'
import type { AuthedUser } from '../decorators/current-user.decorator'
import type { UserRole } from '../decorators/roles.decorator'
import { INTERNAL_SESSION_CACHE_TTL_SECONDS } from '../constants/internal-session.constants'
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

/**
 * 把内部账号(admin / partner / kiosk)的 Bearer Token 解析成「当前仍然有效」的身份。
 *
 * 与 `resolveOptionalEndUser`(会员侧)对称:JWT 只用来确定「这是谁」,
 * 角色 / 机构 / 账号是否可用一律回源数据库,绝不采信 token 里的 role / orgId 声明。
 * 校验项与 JwtAuthGuard 完全一致:deletedAt / enabled / tokenVersion / 角色白名单 /
 * partner 的机构启用状态。
 *
 * 返回 null 表示「不是有效内部身份」。JwtAuthGuard 把 null 翻译成 401;
 * 混合鉴权路由(如 FilesController)则可以继续尝试会员或匿名分支。
 *
 * 性能:走 `internal:session-state:<userId>` 缓存(TTL
 * INTERNAL_SESSION_CACHE_TTL_SECONDS),因此热路径通常是一次 Redis 读而不是一次
 * 数据库查询;停用 / 删除 / 改密路径会主动改写或删除该键,缓存最坏陈旧窗口 = TTL。
 */
export async function resolveOptionalInternalUser(
  authorization: string | undefined,
  jwtService: JwtService,
  redis: RedisService,
  prisma: PrismaService,
): Promise<AuthedUser | null> {
  if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) return null

  const token = authorization.slice(7).trim()
  let payload: InternalJwtPayload
  try {
    payload = jwtService.verify<InternalJwtPayload>(token)
  } catch {
    return null
  }
  if (!payload.sub || payload.aud === 'enduser') return null

  const state = await loadInternalSessionState(payload.sub, redis, prisma)
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
): Promise<InternalSessionState | null> {
  const cacheKey = `internal:session-state:${userId}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    const parsed = parseInternalSessionState(cached)
    if (parsed) {
      if (parsed.role !== 'partner') return parsed
      // Partner 缓存命中也必须回源，避免 Redis 残留把已删除账号短暂复活。
      return loadInternalSessionStateFromDatabase(userId, cacheKey, redis, prisma)
    }
    await redis.del(cacheKey)
  }

  return loadInternalSessionStateFromDatabase(userId, cacheKey, redis, prisma)
}

async function loadInternalSessionStateFromDatabase(
  userId: string,
  cacheKey: string,
  redis: RedisService,
  prisma: PrismaService,
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
  const writeResult = await redis.setJsonIfVersionNotOlder(
    cacheKey,
    INTERNAL_SESSION_CACHE_TTL_SECONDS,
    JSON.stringify(state),
    state.tokenVersion,
  )
  if (writeResult === 'stale') {
    const latest = await redis.get(cacheKey)
    const parsed = latest ? parseInternalSessionState(latest) : null
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
