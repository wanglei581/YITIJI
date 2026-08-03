import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { Request } from 'express'
import type { UserRole } from './roles.decorator'

/**
 * 经 JwtAuthGuard 注入到 request 上的当前用户。
 *
 * 字段约定:
 *   - userId:用户 ID(对应 JWT payload 的 sub)
 *   - role:  用户角色,见 UserRole
 *   - orgId: 所属机构;admin/kiosk 可能为 null
 */
export interface AuthedUser {
  userId: string
  role:   UserRole
  orgId:  string | null
  /** 当前 Bearer Token 的 SHA-256 指纹，只用于服务端绑定高风险近期验证。 */
  sessionId?: string
}

/**
 * 控制器参数装饰器:从 req.user 取出当前用户。
 *
 * 用法:
 *   @Roles('partner')
 *   importJobs(@CurrentUser() user: AuthedUser, @Body() dto: ImportDto) {
 *     // user.orgId 必非空,强制隔离机构数据
 *   }
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthedUser | undefined => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthedUser }>()
    return req.user
  },
)
