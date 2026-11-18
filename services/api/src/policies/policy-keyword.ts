import { BadRequestException } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client'
import type { DbKind } from '../prisma/create-client'

/** 公开列表关键词上限。按字符串长度计，一个汉字算一个字。 */
export const POLICY_KEYWORD_MAX_LENGTH = 30

export interface PolicyKeywordPlan {
  /**
   * 交给 Prisma 的粗筛。可以比最终结果宽，但不能漏。
   * PostgreSQL 用 mode: 'insensitive'（按库的区域设置，可能把 É 和 é 看成同一个字母）。
   * SQLite 用 LIKE（默认只折 A-Z）。没有关键词时是空条件。
   */
  where: Prisma.PolicyPostWhereInput
  /**
   * 有关键词时必填。粗筛之后一律用这个字符串在内存里精筛、计数、分页。
   * 口径只有一个：英文字母 A-Z 不分大小写，其余字符按字面。
   * 没有关键词时为 null，调用方直接按数据库分页。
   */
  literal: string | null
}

/**
 * 只把 A-Z 折成小写。É、é、汉字、撇号和 % 都原样留下。
 * 这是命中与否的唯一口径。数据库 contains 只负责不漏，两边可以更宽，不能拿来当结果。
 */
function foldEnglishLetters(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32))
}

/** 标题或摘要是否包含关键词。英文字母不分大小写，其余字符按字面。 */
export function policyKeywordIncludes(haystack: string, needle: string): boolean {
  return foldEnglishLetters(haystack).includes(foldEnglishLetters(needle))
}

/**
 * 粗筛只要求不漏，不要求刚好。
 * SQLite 的 LIKE 对英文字母不分大小写，不必再写 mode（SQLite 客户端也不认这个字段）。
 * PostgreSQL 补上 mode: 'insensitive'。它还会按库的区域设置折 É/é，所以比内存口径宽，漏不了 A-Z 的大小写。
 * 共享类型来自 SQLite 客户端，mode 只在 PostgreSQL 运行时的对象上。
 */
function textContains(value: string, dbKind: DbKind): Prisma.StringFilter {
  if (dbKind !== 'postgres') return { contains: value }
  return { contains: value, mode: 'insensitive' } as Prisma.StringFilter
}

/**
 * 粗筛用的片段。整段都是 ASCII 时原样交给 contains。
 * 段里夹着非 ASCII 时只留下 ASCII 连续段，École 和 école 都会进内存，
 * 再由只折 A-Z 的比较决定留哪一条。没有 ASCII 的段（例如纯汉字）仍按原段匹配。
 */
function coarsePieces(segment: string): string[] {
  const asciiRuns = segment.match(/[\u0000-\u007F]+/g) ?? []
  if (asciiRuns.length > 0 && asciiRuns.join('') !== segment) return asciiRuns
  return [segment]
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
  // 普通词和含 % _ \ 的词走同一条路：数据库只粗筛，literal 交给内存精筛。
  // Prisma 的 contains 会生成 LIKE。SQLite 没有默认转义字符，PostgreSQL 默认用反斜杠。
  // 这些字符不放进 contains，只拿去掉它们之后的各段做粗筛，避免一边按字面、另一边仍是通配。
  // 连续元字符切成空段后丢掉。没有元字符时整词就是一段，不能在这里把 literal 留空。
  const segments = keyword.split(/[%_\\]+/).filter((segment) => segment.length > 0)
  const pieces = segments.flatMap(coarsePieces).filter((piece) => piece.length > 0)
  if (pieces.length === 0) {
    // 关键词只有 % _ \，或去掉之后没有可 contains 的片段。调用方整批取完再精筛。
    return { where: {}, literal: keyword }
  }
  const containsAll = (field: 'title' | 'summary'): Prisma.PolicyPostWhereInput => ({
    AND: pieces.map((piece) => ({ [field]: textContains(piece, dbKind) })),
  })
  return {
    where: { OR: [containsAll('title'), containsAll('summary')] },
    literal: keyword,
  }
}
