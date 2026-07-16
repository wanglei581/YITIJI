import { JwtService } from '@nestjs/jwt'
import type { PrismaService } from '../../prisma/prisma.service'
import type { RedisService } from '../redis/redis.service'
import { memberSessionKey } from '../guards/end-user-auth.guard'

interface EndUserJwtPayload {
  sub: string
  jti?: string
}

export interface OptionalEndUser {
  endUserId: string
  sessionId: string
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
): Promise<OptionalEndUser | null> {
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

  const ownerId = await redis.get(memberSessionKey(sessionId))
  if (ownerId !== payload.sub) return null

  const user = await prisma.endUser.findUnique({
    where: { id: payload.sub },
    select: { enabled: true, status: true },
  })
  if (!user || !user.enabled || user.status !== 'active') {
    await redis.unregisterMemberSession(payload.sub, sessionId)
    return null
  }

  return { endUserId: payload.sub, sessionId }
}
