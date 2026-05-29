import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import type { AuthedUser } from '../decorators/current-user.decorator'
import { ROLES_KEY, type UserRole } from '../decorators/roles.decorator'

/**
 * 与 @Roles 装饰器配合做角色判定。
 * 上游必须先有 JwtAuthGuard 把 req.user 填好,否则一律拒绝。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    // 没有 @Roles 限制 → 默认放行(等价于"任意登录用户")
    if (!required || required.length === 0) return true

    const req = context.switchToHttp().getRequest<Request & { user?: AuthedUser }>()
    const user = req.user
    if (!user) {
      throw new ForbiddenException({
        error: { code: 'AUTH_FORBIDDEN', message: '未识别身份' },
      })
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException({
        error: { code: 'AUTH_ROLE_FORBIDDEN', message: `当前角色无权访问 (需要: ${required.join('/')})` },
      })
    }
    return true
  }
}
