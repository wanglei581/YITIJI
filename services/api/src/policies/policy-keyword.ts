import { BadRequestException } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client'

/** 公开列表关键词上限。按字符串长度计，一个汉字算一个字。 */
export const POLICY_KEYWORD_MAX_LENGTH = 30

/**
 * LIKE 元字符。Prisma 的 contains 会生成 LIKE，但两边的转义不一样：
 * SQLite 的 LIKE 没有默认转义字符（Prisma 也不加 ESCAPE），
 * PostgreSQL 默认用反斜杠转义。只转义一种写法会让一边按字面、另一边仍是通配。
 * 因此含这些字符时不靠 LIKE 转义，改成粗筛加内存里的字面 includes。
 */
const LIKE_META = /[%_\\]/

export interface PolicyKeywordPlan {
  /** 交给 Prisma 的条件。不含元字符时就是标题或摘要的 contains；含元字符时只按去掉元字符后的各段粗筛。 */
  where: Prisma.PolicyPostWhereInput
  /**
   * 含 %、_ 或 \ 时，粗筛之后还要用这个字符串做字面 includes，再分页、再计数。
   * 不含则为 null，总数和分页仍走数据库。
   */
  literal: string | null
}

/**
 * 公开政策列表的可选关键词。
 * 先去掉首尾空白；空白等于不筛选。超长直接 400。
 * 任何字符都按标题或摘要的字面子串匹配。返回的条件和类别、分页、范围、截止日期各自独立，由调用方 AND 进去。
 */
export function policyKeywordPlan(raw: string | undefined): PolicyKeywordPlan {
  if (raw === undefined) return { where: {}, literal: null }
  const keyword = raw.trim()
  if (!keyword) return { where: {}, literal: null }
  if (keyword.length > POLICY_KEYWORD_MAX_LENGTH) {
    throw new BadRequestException({
      error: { code: 'POLICY_KEYWORD_TOO_LONG', message: '关键词最长 30 字' },
    })
  }
  if (!LIKE_META.test(keyword)) {
    return {
      where: {
        OR: [
          { title: { contains: keyword } },
          { summary: { contains: keyword } },
        ],
      },
      literal: null,
    }
  }
  // 连续的元字符切成空段，丢掉。剩下的每一段都不含通配符，contains 在两种库上都是字面的。
  const segments = keyword.split(/[%_\\]+/).filter((segment) => segment.length > 0)
  if (segments.length === 0) {
    // 关键词只有 % _ \。没法用 contains 缩小范围，调用方必须把粗筛结果整批取完再按字面筛。
    return { where: {}, literal: keyword }
  }
  const containsAll = (field: 'title' | 'summary'): Prisma.PolicyPostWhereInput => ({
    AND: segments.map((segment) => ({ [field]: { contains: segment } })),
  })
  return {
    where: { OR: [containsAll('title'), containsAll('summary')] },
    literal: keyword,
  }
}
