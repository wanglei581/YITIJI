/**
 * 用户角色。
 *
 * - admin   — 管理员后台运营人员
 * - partner — 合作机构后台账号(隶属某个 orgId)
 * - kiosk   — 一体机前台的求职者
 *
 * 与后端 JWT 中 `role` 字段一一对应。新增角色时要同步改
 * `services/api/src/common/decorators/roles.decorator.ts`。
 */
export type UserRole = 'admin' | 'partner' | 'kiosk'

export interface User {
  id: string
  name?: string
  role: UserRole
  orgId?: string | null
  phone?: string
  createdAt?: string
}
