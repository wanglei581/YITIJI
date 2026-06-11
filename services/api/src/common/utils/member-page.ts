import { BadRequestException } from '@nestjs/common'

// ============================================================
// 会员 /me/* 列表游标分页（Phase C-2D）。
//
// 设计（与 packages/shared/src/types/memberAssets.ts MemberAssetPage 对齐）：
// - cursor = 上一页最后一条的行 id；首页不传。
// - pageSize 默认 20，封顶 50（超出取 50，不报错；非数字 / <1 → 400）。
// - 查询统一 take pageSize+1 探测下一页，绝不无界 findMany。
// - 排序统一 [{ createdAt: 'desc' }, { id: 'desc' }]：id 兜底保证游标稳定。
// ============================================================

export const MEMBER_PAGE_DEFAULT = 20
export const MEMBER_PAGE_MAX = 50

export interface MemberPageQuery {
  cursor: string | null
  pageSize: number
}

/** 解析 /me/* 列表的 cursor / pageSize 查询参数（非法 pageSize → 400）。 */
export function parseMemberPageQuery(cursorRaw?: string, pageSizeRaw?: string): MemberPageQuery {
  let pageSize = MEMBER_PAGE_DEFAULT
  if (pageSizeRaw !== undefined && pageSizeRaw !== '') {
    const n = Number(pageSizeRaw)
    if (!Number.isInteger(n) || n < 1) {
      throw new BadRequestException({
        error: { code: 'MEMBER_PAGE_INVALID', message: 'pageSize 必须是不小于 1 的整数' },
      })
    }
    pageSize = Math.min(n, MEMBER_PAGE_MAX)
  }
  const cursor = cursorRaw?.trim() || null
  return { cursor, pageSize }
}

/** Prisma findMany 的游标分页参数（take+1 探测下一页）。 */
export function memberPageArgs(page: MemberPageQuery): {
  take: number
  skip?: number
  cursor?: { id: string }
  orderBy: Array<Record<string, 'desc'>>
} {
  return {
    take: page.pageSize + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  }
}

/**
 * 把 take+1 的查询结果切成一页：多出的一条只用来判断 nextCursor，不返回。
 * total 为同 where 条件的真实 count（头部统计用，绝不拿页内条数冒充总数）。
 */
export function buildMemberPage<R extends { id: string }, T>(
  rows: R[],
  page: MemberPageQuery,
  total: number,
  map: (row: R) => T,
): { items: T[]; nextCursor: string | null; total: number } {
  const hasMore = rows.length > page.pageSize
  const pageRows = hasMore ? rows.slice(0, page.pageSize) : rows
  return {
    items: pageRows.map(map),
    nextCursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].id : null,
    total,
  }
}
