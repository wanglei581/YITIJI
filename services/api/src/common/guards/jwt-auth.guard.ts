import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'
import type { AuthedUser } from '../decorators/current-user.decorator'
import type { UserRole } from '../decorators/roles.decorator'

interface JwtPayload {
  sub:   string
  role:  UserRole
  orgId: string | null
  /** C 端求职者 token 带 aud='enduser';内部接口必须拒绝(双向隔离)。 */
  aud?:  string
}

/**
 * 解析请求头 `Authorization: Bearer <token>`,验证 JWT,
 * 把解码后的用户写入 `req.user`(类型 AuthedUser)。
 *
 * 配合 RolesGuard 使用:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('admin')
 *
 * 不主动检查角色 — 单独使用时表示"任意已登录用户"。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthedUser }>()
    const header = req.headers.authorization
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException({
        error: { code: 'AUTH_MISSING_TOKEN', message: '缺少 Bearer Token' },
      })
    }

    const token = header.slice(7).trim()
    let payload: JwtPayload
    try {
      payload = this.jwtService.verify<JwtPayload>(token)
    } catch {
      throw new UnauthorizedException({
        error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' },
      })
    }

    // 隔离:C 端求职者 token(aud='enduser')不得访问内部运营接口。
    if (payload.aud === 'enduser') {
      throw new UnauthorizedException({
        error: { code: 'AUTH_TOKEN_INVALID', message: 'Token 无效或已过期' },
      })
    }

    req.user = {
      userId: payload.sub,
      role:   payload.role,
      orgId:  payload.orgId,
    }
    return true
  }
}
