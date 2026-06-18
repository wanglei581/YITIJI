import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { AuthedEndUser } from '../decorators/current-end-user.decorator'
import { RedisService } from '../redis/redis.service'
import { memberSessionKey } from './end-user-auth.guard'

interface EndUserJwtPayload {
  sub: string
  jti?: string
  aud?: string
}

/**
 * Optional C-end auth for public read endpoints.
 *
 * Missing / invalid member tokens never block access; valid tokens attach req.endUser
 * so list/detail APIs can mark whether the current member has claimed an activity.
 * Do not use this guard on write endpoints.
 */
@Injectable()
export class OptionalEndUserAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { endUser?: AuthedEndUser }>()
    const header = req.headers.authorization
    if (!header || !header.toLowerCase().startsWith('bearer ')) return true

    try {
      const token = header.slice(7).trim()
      const payload = this.jwtService.verify<EndUserJwtPayload>(token, { audience: 'enduser' })
      const sessionId = payload.jti
      if (!sessionId) return true
      const ownerId = await this.redis.get(memberSessionKey(sessionId))
      if (ownerId && ownerId === payload.sub) {
        req.endUser = { endUserId: payload.sub, sessionId }
      }
    } catch {
      return true
    }

    return true
  }
}
