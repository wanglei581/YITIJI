import { BadRequestException } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client'
import type { DbKind } from '../prisma/create-client'

/** 公开列表关键词上限。按字符串长度计，一个汉字算一个字。 */
export const POLICY_KEYWORD_MAX_LENGTH = 30

/**
 * LIKE 元字符。Prisma 的 contains 会生成 LIKE，但两边的转义不一样：
 * SQLite 的 LIKE 没有默认转义字符（Prisma 也不加 ESCAPE），
 * PostgreSQL 默认用反斜杠转义。只转义一种写法会让一边按字面、另一边仍是通配。
 * 因此含这些字符时不靠 LIKE 转义，改成粗筛加内存比较。
 */
const LIKE_META = /[%_\\]/

export interface PolicyKeywordPlan {
  /** 交给 Prisma 的条件。不含元字符时就是标题或摘要的 contains；含元字符时只按去掉元字符后的各段粗筛。 */
  where: Prisma.PolicyPostWhereInput
  /**
   * 含 %、_ 或 \ 时，粗筛之后还要用这个字符串按同一口径比较，再分页、再计数。
   * 不含则为 null，总数和分页仍走数据库。两种库的 contains 都已是英文字母不分大小写。
   */
  literal: string | null
}

/**
 * 英文字母 A-Z/a-z 折成小写，其余字符原样留下。
 * 和 SQLite 默认 LIKE、以及 PostgreSQL `mode: 'insensitive'` 对英文字母的行为对齐。
 */
function foldEnglishLetters(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32))
}

/** 标题或摘要是否包含关键词。英文字母不分大小写，其余字符按字面。 */
export function policyKeywordIncludes(haystack: string, needle: string): boolean {
  return foldEnglishLetters(haystack).includes(foldEnglishLetters(needle))
}

/**
 * SQLite 的 LIKE 对英文字母不分大小写，不必再写 mode（SQLite 客户端也不认这个字段）。
 * PostgreSQL 的 contains 默认区分大小写，这里补上 mode，让两种库同一口径。
 * 共享类型来自 SQLite 客户端，mode 只在 PostgreSQL 运行时的对象上。
 */
function textContains(value: string, dbKind: DbKind): Prisma.StringFilter {
  if (dbKind !== 'postgres') return { contains: value }
  return { contains: value, mode: 'insensitive' } as Prisma.StringFilter
}

/**
 * 公开政策列表的可选关键词。
 * 先去掉首尾空白；空白等于不筛选。超长直接 400。
 * 英文字母不分大小写，其余字符按字面，标题或摘要命中即可。
 * 返回的条件和类别、分页、范围、截止日期各自独立，由调用方 AND 进去。
 */
export function policyKeywordPlan(raw: string | undefined, dbKind: DbKind): PolicyKeywordPlan {
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
          { title: textContains(keyword, dbKind) },
          { summary: textContains(keyword, dbKind) },
        ],
      },
      literal: null,
    }
  }
  // 连续的元字符切成空段，丢掉。剩下的每一段都不含通配符，contains 在两种库上都按同一大小写口径。
  const segments = keyword.split(/[%_\\]+/).filter((segment) => segment.length > 0)
  if (segments.length === 0) {
    // 关键词只有 % _ \。没法用 contains 缩小范围，调用方必须把粗筛结果整批取完再按同一口径筛。
    return { where: {}, literal: keyword }
  }
  const containsAll = (field: 'title' | 'summary'): Prisma.PolicyPostWhereInput => ({
    AND: segments.map((segment) => ({ [field]: textContains(segment, dbKind) })),
  })
  return {
    where: { OR: [containsAll('title'), containsAll('summary')] },
    literal: keyword,
  }
}
