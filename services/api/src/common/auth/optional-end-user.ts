import { ServiceUnavailableException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { RedisService } from '../redis/redis.service'
import { memberSessionKey, touchMemberSessionIfSupported } from '../guards/end-user-auth.guard'
import type { PrismaService } from '../../prisma/prisma.service'
import { tryRedis } from '../redis/redis-degradation'

interface EndUserJwtPayload {
  sub: string
  jti?: string
}

export interface OptionalEndUser {
  endUserId: string
  sessionId: string
}

export interface ResolveOptionalEndUserOptions {
  /**
   * 清场专用。Redis 或会员库查身份失败时回 503，不当游客。
   * 默认仍是公开接口口径：查失败就当游客，避免把匿名流量打成 500。
   */
  strict?: boolean
}

const MEMBER_SESSION_STORE_UNAVAILABLE = {
  error: {
    code: 'MEMBER_SESSION_STORE_UNAVAILABLE',
    message: '登录状态暂时无法核验，请稍后重试',
  },
} as const

function memberLookupUnavailable(): never {
  throw new ServiceUnavailableException(MEMBER_SESSION_STORE_UNAVAILABLE)
}

/**
 * Resolve an optional C-end member token.
 *
 * Public Kiosk endpoints still support anonymous flows. If a valid member
 * token is present, assets are bound to EndUser; otherwise the request remains
 * anonymous. Invalid or expired optional tokens are treated as anonymous so
 * legacy Kiosk traffic and internal tokens do not break these public endpoints.
 */
export async function resolveOptionalEndUser(
  authorization: string | undefined,
  jwtService: JwtService,
  redis: RedisService,
  prisma: PrismaService,
  options?: ResolveOptionalEndUserOptions,
): Promise<OptionalEndUser | null> {
  const strict = options?.strict === true
  if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) {
    return null
  }

  const token = authorization.slice(7).trim()
  let payload: EndUserJwtPayload
  try {
    payload = jwtService.verify<EndUserJwtPayload>(token, { audience: 'enduser' })
  } catch {
    return null
  }

  const sessionId = payload.jti
  if (!payload.sub || !sessionId) return null

  const owner = await tryRedis('optional-member-session:get', () => redis.get(memberSessionKey(sessionId)))
  if (!owner.ok) {
    if (strict) memberLookupUnavailable()
    return null
  }
  if (owner.value !== payload.sub) return null

  let user: { enabled: boolean; status: string } | null
  try {
    user = await prisma.endUser.findUnique({
      where: { id: payload.sub },
      select: { enabled: true, status: true },
    })
  } catch {
    // 公开接口：库故障当游客，不把匿名流量打成 500。
    // 清场接口 strict：不能把「没查到是谁」当成「已清 0」。
    if (strict) memberLookupUnavailable()
    return null
  }
  if (!user || !user.enabled || user.status !== 'active') {
    await tryRedis(
      'optional-member-session:unregister',
      () => redis.unregisterMemberSession(payload.sub, sessionId),
    )
    return null
  }

  const touch = await touchMemberSessionIfSupported(redis, payload.sub, sessionId)
  if (touch === -1) return null
  return { endUserId: payload.sub, sessionId }
}
