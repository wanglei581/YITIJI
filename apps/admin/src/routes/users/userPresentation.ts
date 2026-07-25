import type { AdminUserActivityType, AdminUserListQuery } from '@ai-job-print/shared'

export interface UserFilterState {
  search: string
  enabled: 'all' | 'enabled' | 'disabled'
  registeredFrom: string
  registeredTo: string
}

export const EMPTY_USER_FILTERS: UserFilterState = {
  search: '',
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

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatUserDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : DATE_TIME_FORMATTER.format(date)
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
    ...(filters.registeredFrom ? { registeredFrom: toLocalBoundary(filters.registeredFrom, false) } : {}),
    ...(filters.registeredTo ? { registeredTo: toLocalBoundary(filters.registeredTo, true) } : {}),
  }
}

export function hasUserFilters(filters: UserFilterState): boolean {
  return Boolean(
    filters.search.trim()
    || filters.enabled !== 'all'
    || filters.registeredFrom
    || filters.registeredTo,
  )
}
