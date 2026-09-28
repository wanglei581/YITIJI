import type { Prisma } from '../generated/prisma/client'
import {
  isRecruitmentContentHostingEnabled,
  recruitmentHostingDisabledException,
} from '../recruitment-hosting/recruitment-hosting'

/**
 * 政策分类里可以写成岗位、招聘会的那一档。
 * 托管关闭时不得再写入，公开读取也不再返回。存量留给 3.15 清理。
 */
export const RECRUITMENT_POLICY_CATEGORY = 'recruitment'

export type PolicyPublicScope = { mode: 'all' } | { mode: 'org'; orgId: string | null; state: 'bound' | 'unbound' | 'missing' }

export function policyScopeMode(): 'all' | 'org' {
  return process.env['POLICY_SCOPE']?.trim().toLowerCase() === 'org' ? 'org' : 'all'
}

type HoldReader = {
  recruitmentEmergencyHold?: {
    findMany?: (args: {
      where: { targetType: string }
      select: { targetId: true }
    }) => Promise<Array<{ targetId: string }>>
  }
}

/** 新建、审核通过、发布：这一档在托管关闭时直接拒绝。 */
export function assertRecruitmentPolicyCategoryAllowed(category: string | null | undefined): void {
  if (isRecruitmentContentHostingEnabled()) return
  if (category === RECRUITMENT_POLICY_CATEGORY) throw recruitmentHostingDisabledException()
}

/**
 * 修改：当前已是这一档，或改完会变成这一档，都拒绝。
 * 存量因此留在原分类上，不能改头换面后再公开。
 */
export function assertRecruitmentPolicyWriteAllowed(
  current: string | null | undefined,
  next: string | null | undefined,
): void {
  if (isRecruitmentContentHostingEnabled()) return
  if (current === RECRUITMENT_POLICY_CATEGORY || next === RECRUITMENT_POLICY_CATEGORY) {
    throw recruitmentHostingDisabledException()
  }
}

export async function listPolicyHoldIds(prisma: HoldReader): Promise<string[]> {
  const findMany = prisma.recruitmentEmergencyHold?.findMany
  if (!findMany) return []
  const rows = await findMany({
    where: { targetType: 'policy' },
    select: { targetId: true },
  })
  return rows.map((row) => row.targetId)
}

function recruitmentCategoryExclusion(): Prisma.PolicyPostWhereInput {
  if (isRecruitmentContentHostingEnabled()) return {}
  // SQL 的「不等于」匹配不到 NULL。没填分类的公告必须继续公开。
  return {
    OR: [
      { category: null },
      { category: { not: RECRUITMENT_POLICY_CATEGORY } },
    ],
  }
}

/**
 * 一体机和小程序的政策读取：托管关闭时去掉 recruitment 分类，
 * 并始终去掉已经写下架留痕的行（即使状态仍是 published）。
 */
export function publicPolicyWhere(
  extra: Prisma.PolicyPostWhereInput,
  heldIds: string[],
  scope: PolicyPublicScope = { mode: 'all' },
): Prisma.PolicyPostWhereInput {
  const parts: Prisma.PolicyPostWhereInput[] = [extra, recruitmentCategoryExclusion()]
  if (scope.mode === 'org') {
    parts.push(scope.orgId ? { sourceOrgId: scope.orgId } : { sourceOrgId: '__no_public_terminal__' })
  }
  if (heldIds.length > 0) parts.push({ id: { notIn: heldIds } })
  const present = parts.filter((part) => Object.keys(part).length > 0)
  if (present.length === 1) return present[0]!
  return { AND: present }
}

export async function publicPolicyLookupWhere(
  prisma: HoldReader,
  extra: Prisma.PolicyPostWhereInput,
  scope: PolicyPublicScope = { mode: 'all' },
): Promise<Prisma.PolicyPostWhereInput> {
  return publicPolicyWhere(extra, await listPolicyHoldIds(prisma), scope)
}
