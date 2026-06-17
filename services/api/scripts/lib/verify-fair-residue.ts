/**
 * 校招/招聘会 verify 脚本共用的「测试数据残留清理」工具。
 *
 * 背景:这些脚本会创建 approved+published 的 JobFair / Job / PolicyPost 作为夹具。
 * 公开前台(/campus、/job-fairs 等)只读 approved+published,因此一旦某次运行在
 * finally 清理前被强杀(或 finally 的 deleteMany 撞上 SQLite 锁抛错),残留就会
 * 直接显示在前台(本地 dev 没开 EXCLUDE_DEMO_PUBLIC_DATA 兜底时尤其明显)。
 *
 * 收敛策略:每个脚本用一个「稳定且唯一」的 tag(跨运行不变,绝不随机),把它嵌进
 * 自己创建的 Organization.id / User.username / EndUser.phoneHash。
 *   - 运行开始前调用一次  → 预清上一次被强杀漏掉的历史残留;
 *   - finally 再调用一次   → 清理本次。
 * 即使本次 finally 也被漏掉,下一次运行的预清也会按 tag 收掉 → 最终收敛,
 * 不会有夹具泄漏到公开前台。
 *
 * tag 必须是真实数据绝不会出现的字符串(约定以 `vresid` 开头,例如 `vresidpubguard`),
 * 这样 `contains` 匹配只命中本脚本族的测试数据,不会误伤真实招聘会/机构/用户。
 */
import type { PrismaService } from '../../src/prisma/prisma.service'

export async function cleanFairVerifyResidue(prisma: PrismaService, tag: string): Promise<void> {
  if (!tag || tag.length < 6 || !tag.startsWith('vresid')) {
    throw new Error(`residue tag 不合法(必须以 vresid 开头且足够独特): ${JSON.stringify(tag)}`)
  }

  // 1) tag 命中的机构 → 删其名下 JobFair / Job / PolicyPost。
  //    JobFair 删除经 onDelete:Cascade 连带 企业(FairCompany)/岗位/展区/资料/导览。
  const orgs = await prisma.organization.findMany({ where: { id: { contains: tag } }, select: { id: true } })
  const orgIds = orgs.map((o: { id: string }) => o.id)
  if (orgIds.length > 0) {
    await prisma.jobFair.deleteMany({ where: { sourceOrgId: { in: orgIds } } })
    await prisma.job.deleteMany({ where: { sourceOrgId: { in: orgIds } } })
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: { in: orgIds } } })
  }

  // 2) tag 命中的测试会员(EndUser)→ 先删其浏览/外跳记录,再删本人。
  const endUsers = await prisma.endUser.findMany({ where: { phoneHash: { contains: tag } }, select: { id: true } })
  const endUserIds = endUsers.map((u: { id: string }) => u.id)
  if (endUserIds.length > 0) {
    await prisma.browseLog.deleteMany({ where: { endUserId: { in: endUserIds } } })
    await prisma.externalJumpLog.deleteMany({ where: { endUserId: { in: endUserIds } } })
    await prisma.endUser.deleteMany({ where: { id: { in: endUserIds } } })
  }

  // 3) tag 命中的测试后台/机构账号(User)→ 先删其审计日志,再删本人。
  const users = await prisma.user.findMany({ where: { username: { contains: tag } }, select: { id: true } })
  const userIds = users.map((u: { id: string }) => u.id)
  if (userIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  }

  // 4) 最后删机构本身(此时已无外键引用)。
  if (orgIds.length > 0) {
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  }
}
