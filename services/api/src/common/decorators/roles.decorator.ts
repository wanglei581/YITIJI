import { SetMetadata } from '@nestjs/common'

export type UserRole = 'admin' | 'partner' | 'kiosk'

export const ROLES_KEY = 'roles'

/**
 * 限制只有指定角色的用户可访问的接口。
 *
 * 用法:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('admin')
 *   reviewJob() { ... }
 *
 * 必须与 JwtAuthGuard 配合使用 — JwtAuthGuard 解析 token 后
 * 把 req.user.role 写入 request,RolesGuard 再做角色判定。
 */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles)
