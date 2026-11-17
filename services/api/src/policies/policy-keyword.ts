import { BadRequestException } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client'

/** 公开列表关键词上限。按字符串长度计，一个汉字算一个字。 */
export const POLICY_KEYWORD_MAX_LENGTH = 30

/**
 * 公开政策列表的可选关键词。
 * 先去掉首尾空白；空白等于不筛选。超长直接 400。
 * 只按标题和摘要做包含匹配，交给 Prisma 参数化查询，不用正则，也不拼 SQL。
 * 返回的条件要和类别、分页、范围、截止日期各自独立，由调用方 AND 进去。
 */
export function policyKeywordWhere(raw: string | undefined): Prisma.PolicyPostWhereInput {
  if (raw === undefined) return {}
  const keyword = raw.trim()
  if (!keyword) return {}
  if (keyword.length > POLICY_KEYWORD_MAX_LENGTH) {
    throw new BadRequestException({
      error: { code: 'POLICY_KEYWORD_TOO_LONG', message: '关键词最长 30 字' },
    })
  }
  return {
    OR: [
      { title: { contains: keyword } },
      { summary: { contains: keyword } },
    ],
  }
}
