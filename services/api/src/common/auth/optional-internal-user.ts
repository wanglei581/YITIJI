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
 * Resolve an optional internal admin/partner/kiosk token against current state.
 *
 * Mixed-auth routes use null for invalid credentials so they can continue to
 * support a member or anonymous branch. Returned role and organization values
 * always come from current state, never from stale JWT claims.
 */
export async function resolveOptionalInternalUser(
  authorization: string | undefined,
  jwtService: JwtService,
  redis: RedisService,
  prisma: PrismaService
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
  if (!state || state.deletedAt !== null || !state.enabled || payload.ver !== state.tokenVersion)
    return null

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
  prisma: PrismaService
): Promise<InternalSessionState | null> {
  const cacheKey = `internal:session-state:${userId}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    const parsed = parseInternalSessionState(cached)
    if (parsed) {
      if (parsed.role !== 'partner') return parsed
      // Partner cache hits still return to the database so a deleted account or
      // disabled organization cannot be revived by a short-lived stale cache.
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
  prisma: PrismaService
): Promise<InternalSessionState | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      role: true,
      orgId: true,
      enabled: true,
      tokenVersion: true,
      deletedAt: true,
    },
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
    state.tokenVersion
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
      typeof parsed.userId !== 'string' ||
      typeof parsed.role !== 'string' ||
      typeof parsed.tokenVersion !== 'number' ||
      typeof parsed.enabled !== 'boolean' ||
      (typeof parsed.orgId !== 'string' && parsed.orgId !== null) ||
      (typeof parsed.deletedAt !== 'string' && parsed.deletedAt !== null) ||
      (typeof parsed.orgEnabled !== 'boolean' && parsed.orgEnabled !== null)
    )
      return null
    return parsed as InternalSessionState
  } catch {
    return null
  }
}
