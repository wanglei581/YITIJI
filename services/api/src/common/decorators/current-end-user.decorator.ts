import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'

/**
 * 经 EndUserAuthGuard 注入到 request 上的当前 C 端求职者。
 * 与内部 AuthedUser(运营账号)完全独立。
 *
 *   - endUserId: EndUser.id(对应 JWT payload 的 sub)
 *   - sessionId: Redis 会话 id(对应 JWT payload 的 jti);logout 时据此失效会话
 */
export interface AuthedEndUser {
  endUserId: string
  sessionId: string
}

export const CurrentEndUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthedEndUser | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { endUser?: AuthedEndUser }>()
    return req.endUser
  },
)
