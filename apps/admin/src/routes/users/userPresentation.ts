import type { AdminUserActivityType, AdminUserListItem, AdminUserListQuery } from '@ai-job-print/shared'

export interface UserFilterState {
  search: string
  closure: '' | NonNullable<AdminUserListQuery['closure']>
  enabled: 'all' | 'enabled' | 'disabled'
  registeredFrom: string
  registeredTo: string
}

export const EMPTY_USER_FILTERS: UserFilterState = {
  search: '',
  closure: '',
  enabled: 'all',
  registeredFrom: '',
  registeredTo: '',
}

export const ACTIVITY_TYPE_LABELS: Record<AdminUserActivityType, string> = {
  file: '文件',
  print: '打印',
  ai: 'AI 服务',
  browse: '浏览',
  external_jump: '外部跳转',
}

export function userDisplayName(user: Pick<AdminUserListItem, 'nickname'>): string {
  return user.nickname?.trim() || '未设置昵称'
}

/**
 * 只有 status === 'disabled' 才允许恢复。
 *
 * 不能写成 `!user.enabled`：closing（注销中）与 anonymized（已匿名化）同样是
 * enabled=false，但前者由隐私执行器推进、后者手机号已换成墓碑值无法还原，
 * 服务端对这两种一律 409。按 enabled 判断会让 UI 摆出一个必然失败的按钮。
 */
export function canRestoreUser(user: Pick<AdminUserListItem, 'status'>): boolean {
  return user.status === 'disabled'
}

export function canDisableUser(user: Pick<AdminUserListItem, 'status'>): boolean {
  return user.status === 'active'
}

export const USER_STATUS_LABELS: Record<AdminUserListItem['status'], string> = {
  active: '正常',
  disabled: '已停用',
  closing: '注销中',
  anonymized: '已注销',
}

function toLocalBoundary(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  )
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return undefined
  return date.toISOString()
}

export function buildAdminUserQuery(
  filters: UserFilterState,
  page: number,
  pageSize: AdminUserListQuery['pageSize'],
): AdminUserListQuery {
  const search = filters.search.trim()
  return {
    page,
    pageSize,
    ...(search && (/^1[3-9]\d{9}$/.test(search) ? { phone: search } : { keyword: search })),
    ...(filters.enabled === 'all' ? {} : { enabled: filters.enabled === 'enabled' }),
    ...(filters.closure ? { closure: filters.closure } : {}),
    ...(filters.registeredFrom ? { registeredFrom: toLocalBoundary(filters.registeredFrom, false) } : {}),
    ...(filters.registeredTo ? { registeredTo: toLocalBoundary(filters.registeredTo, true) } : {}),
  }
}

export function hasUserFilters(filters: UserFilterState): boolean {
  return Boolean(
    filters.search.trim()
    || filters.closure
    || filters.enabled !== 'all'
    || filters.registeredFrom
    || filters.registeredTo,
  )
}

export function userPhone(user: Pick<AdminUserListItem, 'status' | 'maskedPhone'>): string {
  return user.status === 'anonymized' ? '***' : user.maskedPhone
}

export function canCloseUser(user: Pick<AdminUserListItem, 'status'>): boolean {
  return ['active', 'disabled', 'closing'].includes(user.status)
}

export function hasPendingClosure(user: AdminUserListItem): boolean {
  return ['active', 'disabled'].includes(user.status) && user.closureRequest?.source === 'member_request'
}

export const CLOSURE_SOURCE_LABELS = { member_request: '本人申请', offline: '线下办理' }
