import type { AdminSourceListQuery, AdminSourcePage } from './types'

export function toAdminSourceQueryString(query: AdminSourceListQuery): string {
  const params = new URLSearchParams()
  if (query.page !== undefined) params.set('page', String(query.page))
  if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize))
  if (query.reviewStatus) params.set('reviewStatus', query.reviewStatus)
  if (query.sourceId) params.set('sourceId', query.sourceId)
  if (query.sourceOrgId) params.set('sourceOrgId', query.sourceOrgId)
  if (query.keyword?.trim()) params.set('keyword', query.keyword.trim())
  const s = params.toString()
  return s ? `?${s}` : ''
}

export function paginateAdminSourceRows<T>(
  rows: T[],
  query: Pick<AdminSourceListQuery, 'page' | 'pageSize'>,
): AdminSourcePage<T> {
  const page = query.page && query.page > 0 ? query.page : 1
  const pageSize = Math.min(100, query.pageSize && query.pageSize > 0 ? query.pageSize : 20)
  const start = (page - 1) * pageSize
  return { items: rows.slice(start, start + pageSize), total: rows.length, page, pageSize }
}

export function isPagedSourceQuery(query?: AdminSourceListQuery): boolean {
  return query?.page !== undefined || query?.pageSize !== undefined
}

export function requireAdminSourcePage<T>(data: T[] | AdminSourcePage<T>): AdminSourcePage<T> {
  if (Array.isArray(data)) {
    throw new Error('来源列表带 page/pageSize 时必须返回 { items, total, page, pageSize }')
  }
  return data
}
