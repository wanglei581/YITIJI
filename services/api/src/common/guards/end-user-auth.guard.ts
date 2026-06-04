import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { AuthedEndUser } from '../decorators/current-end-user.decorator'
import { RedisService } from '../redis/redis.service'

interface EndUserJwtPayload {
  sub: string
  jti?: string
  aud?: string
}

/** member:session:{jti} — C 端登录会话键。logout / idle logout 删除即失效。 */
export function memberSessionKey(sessionId: string): string {
  return `member:session:${sessionId}`
}

/**
 * C 端求职者鉴权(阶段 A)。与内部 JwtAuthGuard 完全隔离:
 *
 *   1. verify 时强制 audience='enduser' — 内部运营 token(无 aud)在此被拒。
 *   2. JWT 仅作"未篡改"证明;是否仍有效以 Redis 会话为准:
 *      jti 必须在 member:session:{jti} 存在且值 == sub,否则视为已登出/已失效。
 *
 * 这样 logout 与前端空闲超时登出都能让 token 立即失效(即使 JWT 本身未过期)。
 */
@Injectable()
export class EndUserAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { endUser?: AuthedEndUser }>()
    const header = req.headers.authorization
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw this.unauthorized('MEMBER_MISSING_TOKEN', '缺少登录凭证')
    }

    const token = header.slice(7).trim()
    let payload: EndUserJwtPayload
    try {
      payload = this.jwtService.verify<EndUserJwtPayload>(token, { audience: 'enduser' })
    } catch {
      throw this.unauthorized('MEMBER_TOKEN_INVALID', '登录已失效,请重新登录')
    }

    const sessionId = payload.jti
    if (!sessionId) {
      throw this.unauthorized('MEMBER_TOKEN_INVALID', '登录已失效,请重新登录')
    }

    const ownerId = await this.redis.get(memberSessionKey(sessionId))
    if (!ownerId || ownerId !== payload.sub) {
      throw this.unauthorized('MEMBER_SESSION_EXPIRED', '会话已失效,请重新登录')
    }

    req.endUser = { endUserId: payload.sub, sessionId }
    return true
  }

  private unauthorized(code: string, message: string): UnauthorizedException {
    return new UnauthorizedException({ error: { code, message } })
  }
}
