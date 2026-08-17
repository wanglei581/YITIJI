// ============================================================
// job-validity.ts — 岗位有效期派生（不落库）
//
// 法规依据：《关于规范网络平台招聘类信息发布的通知》（人社部等五部门，2026-01）
//   「发布的招聘信息应当……标注信息有效期限或者及时更新」。
//   即：一条 validThrough 已过的岗位不得继续对求职者展示。
//
// 现状（本文件出现前）：
//   PublishStatus 枚举里有 'expired'，但**全仓没有任何代码把 Job.publishStatus
//   写成 'expired'**（写入点只有 jobs-admin.publishJobSource 的 published/unpublished、
//   review 动作的 'draft'、以及各导入路径的 'draft'），也没有到期扫描任务。
//   于是一条 validThrough 已过的岗位会永远以 publishStatus='published' 存库，
//   而 buildPublishedJobWhere 只筛 reviewStatus+publishStatus，不看日期 ——
//   过期岗位就一直挂在 GET /api/v1/jobs 上。
//
// 处理方式与 deriveBenefitStatus（member-benefits/benefit-status.ts）一致：
//   **只派生、不落库**。理由相同且更强：
//     - 无需迁移、无需 cron，天然幂等；
//     - 服务端时钟是唯一权威时钟（一体机本地时钟可能漂移，不能用设备时间判有效期）；
//     - 生产存量数据的下架属于运营动作，需产品负责人具名授权，
//       读取侧过滤不写库，因此不会替运营做不可逆决定。
//
// 谓词唯一性（本文件存在的主要理由）：
//   isJobExpired 与 jobValidityWhere 必须是严格互补的两种写法，
//   否则「列表里筛掉的」和「详情页/管理端标成过期的」会对不上，
//   重演 fair-list-integrity 当年「筛出来的 ≠ 卡片上显示的」那类事故。
//     isJobExpired    : validThrough != null && validThrough <  now
//     jobValidityWhere: validThrough == null || validThrough >= now
//   两者对同一 (validThrough, now) 恒为相反结论 —— 由 verify:job-validity-expiry 断言。
// ============================================================

import type { Prisma } from '../generated/prisma/client'

/**
 * 岗位是否已过有效期。
 *
 * validThrough 为空 = 来源未提供有效期 → **不判过期**。
 * 法规要求「标注有效期限**或者**及时更新」，缺有效期是数据质量问题
 * （已由 job-quality.service 的 missingFields 记账），不等于失效，
 * 在这里判过期会把大批仍在招的岗位误杀。
 *
 * 边界取 strict `<`：validThrough 当天仍然有效。
 */
export function isJobExpired(validThrough: Date | null | undefined, now: Date = new Date()): boolean {
  if (!validThrough) return false
  return validThrough.getTime() < now.getTime()
}

/**
 * 求职者可见岗位的有效期条件，下推到 SQL。
 *
 * 必须下推而不是取回内存里过滤：分页 total 与 data 要描述同一批岗位，
 * 内存过滤会让「第 1 页只剩 3 条但 total 说 5 条」。
 */
export function jobValidityWhere(now: Date = new Date()): Prisma.JobWhereInput {
  return { OR: [{ validThrough: null }, { validThrough: { gte: now } }] }
}

/**
 * 已过有效期岗位的 SQL 条件 —— jobValidityWhere 的严格补集。
 *
 * 为什么需要「反向」写法而不是让调用方套 NOT:
 *   Prisma 的 `NOT` 会翻成 SQL 的 NOT,而 `NOT (validThrough < now)` 在
 *   validThrough IS NULL 时是 UNKNOWN,行会被整条丢掉 —— 「来源未提供有效期」
 *   的岗位会被误判。所以正向条件必须写成显式 OR(jobValidityWhere),
 *   反向条件必须写成裸比较(本函数),两者都不能由对方取反得到。
 *
 * NULL 语义与 isJobExpired 一致:validThrough 为空 = 不算过期。
 * SQL 里 `validThrough < now` 对 NULL 恒为 UNKNOWN,天然不命中,无需额外分支。
 *
 * 三处写法的互补性由 verify:job-validity-expiry 断言,不得各自漂移。
 */
export function jobExpiredWhere(now: Date = new Date()): Prisma.JobWhereInput {
  return { validThrough: { lt: now } }
}

/**
 * 管理端 / 机构端的过期标记。
 *
 * 与公开侧相反 —— 管理端**必须看得见**过期岗位，否则运营无从发现和处置。
 *
 * 刻意**不**把 publishStatus 派生成 'expired'（这与 deriveBenefitStatus 的做法不同，
 * 原因是消费端不同）：Admin 岗位表的两个动作按钮直接按 publishStatus 取值开关 ——
 *   apps/admin/src/routes/job-sources/index.tsx
 *     `reviewStatus === 'approved' && publishStatus !== 'published'` → 显示「发布」
 *     `publishStatus === 'published'`                               → 显示「下架」
 * 一旦把过期岗位的 publishStatus 报成 'expired'，运营会**失去「下架」按钮**、
 * 反而被提示「发布」，正好把唯一的处置动作挡掉。
 *
 * 所以这里回一个**并列**的派生布尔：publishStatus 保持库里的真值 'published'
 * （运营执行下架后才真正落成 'unpublished'），过期与否单独标记、单独渲染。
 */
export function isJobExpiredForAdmin(
  storedStatus: string,
  validThrough: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (storedStatus !== 'published') return false
  return isJobExpired(validThrough, now)
}
