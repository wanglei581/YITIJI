// 权限管理页（内部账号名册）的纯展示规则：标签、格式化、行级按钮判定。
// 只放无副作用的常量与函数，verify-admin-internal-accounts-ui.mjs 会转译后真跑。

import type { InternalAccountItem, InternalAccountRole } from '../../services/api/internalAccounts'

export type RoleFilter = '' | InternalAccountRole
export type EnabledFilter = '' | 'true' | 'false'

export interface RosterFilterState {
  role: RoleFilter
  enabled: EnabledFilter
  keyword: string
}

export const EMPTY_ROSTER_FILTERS: RosterFilterState = { role: '', enabled: '', keyword: '' }

export const ROLE_FILTER_OPTIONS: Array<{ value: RoleFilter; label: string }> = [
  { value: '', label: '全部角色' },
  { value: 'admin', label: '管理员' },
  { value: 'partner', label: '合作机构' },
  { value: 'kiosk', label: '终端' },
]

export const ENABLED_FILTER_OPTIONS: Array<{ value: EnabledFilter; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'true', label: '启用' },
  { value: 'false', label: '停用' },
]

export function hasRosterFilters(filters: RosterFilterState): boolean {
  return Boolean(filters.role || filters.enabled || filters.keyword.trim())
}

export function buildRosterQuery(
  filters: RosterFilterState,
  page: number,
  pageSize: number,
): { role?: InternalAccountRole; enabled?: boolean; keyword?: string; page: number; pageSize: number } {
  const keyword = filters.keyword.trim().slice(0, 50)
  return {
    page,
    pageSize,
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.enabled === '' ? {} : { enabled: filters.enabled === 'true' }),
    ...(keyword ? { keyword } : {}),
  }
}

// ─── 单元格文案 ───────────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  partner: '合作机构',
  kiosk: '终端',
}

export const PASSWORD_STATE_LABELS: Record<string, string> = {
  temporary: '临时密码',
  owner_managed: '本人设置',
  legacy: '历史账号',
}

/** 北京时间 yyyy-MM-dd HH:mm。hourCycle=h23，避免个别环境把 0 点印成 24。 */
const BEIJING_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function formatBeijing(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = BEIJING_PARTS.formatToParts(date)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('year')}-${pick('month')}-${pick('day')} ${pick('hour')}:${pick('minute')}`
}

export function formatBeijingDateTime(value: string | null): string {
  if (!value) return '从未登录'
  return formatBeijing(value)
}

export function formatBeijingDate(value: string): string {
  return formatBeijing(value)
}

/** 手机号列：脱敏号码 + 绑定/验证状态如实标注。 */
export function phoneCellText(item: InternalAccountItem): string {
  if (!item.phoneBound) return '未绑定'
  if (!item.phoneVerified) return `${item.phoneMasked ?? '***'}（未验证）`
  return item.phoneMasked ?? '***'
}

export function accountDisplayName(item: InternalAccountItem): string {
  return item.name.trim() || item.username
}

// ─── 行级操作判定 ─────────────────────────────────────────────────────────────

export type RowAction =
  | { kind: 'status'; enabled: boolean; disabled: false }
  | { kind: 'status'; enabled: boolean; disabled: true; reason: string }
  | { kind: 'partner-link'; orgId: string | null; orgName: string | null }
  | { kind: 'readonly' }

/**
 * 名册行操作：
 *   admin   → 启停（自己那行与最后一个启用管理员禁用并说明，服务端 409 兜底）
 *   partner → 跳合作机构管理页处理（启停在 /partners 做，名册不另做一套）
 *   kiosk   → 只读
 */
export function rowActionFor(
  item: InternalAccountItem,
  currentUserId: string | null,
  enabledAdminTotal: number | null,
): RowAction {
  if (item.role === 'partner') return { kind: 'partner-link', orgId: item.orgId, orgName: item.orgName }
  if (item.role !== 'admin') return { kind: 'readonly' }
  if (item.enabled) {
    if (currentUserId === item.id) {
      return { kind: 'status', enabled: true, disabled: true, reason: '不能停用当前登录账号' }
    }
    if (enabledAdminTotal !== null && enabledAdminTotal <= 1) {
      return { kind: 'status', enabled: true, disabled: true, reason: '最后一个启用的管理员，停用后将无人能登录' }
    }
    return { kind: 'status', enabled: true, disabled: false }
  }
  return { kind: 'status', enabled: false, disabled: false }
}

/** 名册里已有备用管理员时禁用「新建备用管理员」并说明（服务端 BACKUP_ADMIN_EXISTS 兜底）。 */
export function backupAdminExistsIn(items: InternalAccountItem[]): boolean {
  return items.some((item) => item.isBackupAdmin)
}
