import type { Prisma } from '../generated/prisma/client'
import type { PrismaService } from '../prisma/prisma.service'
import { policyKeywordIncludes } from './policy-keyword'

/**
 * 含 LIKE 元字符时，数据库 contains 只做粗筛。
 * 这里按与公开列表相同的排序把粗筛结果分批取完，再用与数据库同一口径
 * （英文字母不分大小写，其余字符按字面）过滤，然后才分页和计数。
 * 一批不满就停，不许取到固定上限就截断。
 */
const LITERAL_KEYWORD_BATCH = 200

type ListedPolicy = Prisma.PolicyPostGetPayload<{
  include: { org: { select: { verifiedOfficialDomainsJson: true } } }
}>

export async function pagePoliciesMatchingLiteral(
  prisma: PrismaService,
  where: Prisma.PolicyPostWhereInput,
  literal: string,
  page: number,
  pageSize: number,
): Promise<{ rows: ListedPolicy[]; total: number }> {
  const matched: ListedPolicy[] = []
  let skip = 0
  for (;;) {
    const batch = await prisma.policyPost.findMany({
      where,
      include: { org: { select: { verifiedOfficialDomainsJson: true } } },
      orderBy: [{ publishedDate: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      skip,
      take: LITERAL_KEYWORD_BATCH,
    })
    for (const row of batch) {
      if (policyKeywordIncludes(row.title, literal) || policyKeywordIncludes(row.summary ?? '', literal)) matched.push(row)
    }
    if (batch.length < LITERAL_KEYWORD_BATCH) break
    skip += batch.length
  }
  const start = (page - 1) * pageSize
  return { rows: matched.slice(start, start + pageSize), total: matched.length }
}
