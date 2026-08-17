// ============================================================
// bulk-publish-expiry.ts — 批量发布的「过期」判据(按内容类型分别定义)
//
// 修复背景(这个文件出现之前):
//   BulkPublishPreviewResult.excluded.expired 统计的是 publishStatus === 'expired'。
//   **全仓没有任何代码把 publishStatus 写成 'expired'** —— 恰恰相反,
//   verify-job-validity-expiry.ts §8 专门断言不得把它落库
//   (「有效期只允许读取时派生」,见 src/jobs/job-validity.ts 顶部)。
//   于是那个统计对岗位 / 招聘会 / 政策三种内容**恒为 0**:
//     - 运营在预览页永远看到「已过期 0 条」,拿不到任何异常信号;
//     - 与此同时候选池只筛 reviewStatus + publishStatus,完全不看日期,
//       validThrough 已过的岗位、endAt 已过的招聘会照样进候选、照样被发布。
//   统计说排除了 0 条,实际一条也没排除 —— 两头同时失灵。
//
// 本文件只做一件事:把「过期」翻译成**每种内容各自真实存在的那个字段**,
// 并且**不引入第二套定义**:
//   - 岗位   → 复用 job-validity.ts 的 canonical 谓词(与求职者可见性同源)
//   - 招聘会 → 复用 jobs-shared.ts 的 buildFairStatusWhere('ended') 时间边界
//   - 政策   → PolicyPost 模型里没有任何有效期字段(只有 publishedDate 发布日期),
//              没有有效期概念就不假装有,返回 null,统计如实为 0。
//
// 为什么批量路径拦、单条路径不拦:
//   BULK_PUBLISHABLE_FROM 的原始意图就是「批量动作不复活过期内容」。
//   批量是「一键几十上百条」,操作者不可能逐条核对日期,必须默认安全;
//   单条发布是操作者对着这一条做的具名决定(且有审计),保留为逃生口 ——
//   历史招聘会补录、有效期填错需要先发布再修正等场景仍然可做。
// ============================================================

import type { Prisma } from '../generated/prisma/client'
import { jobValidityWhere, jobExpiredWhere, isJobExpired } from '../jobs/job-validity'
import { buildFairStatusWhere } from '../jobs/jobs-shared'
// 纯类型引用(编译期擦除),不会与 bulk-publish.service.ts 形成运行时循环依赖。
import type { BulkPublishKind } from './bulk-publish.service'

/** 判定过期所需的列名;null = 该内容类型没有有效期概念。 */
export function bulkPublishExpiryField(kind: BulkPublishKind): string | null {
  if (kind === 'job') return 'validThrough'
  if (kind === 'fair') return 'endAt'
  return null
}

/**
 * 「未过期」条件,用于收窄候选池。
 * null = 该内容类型没有有效期概念,不附加任何条件。
 *
 * 岗位这一支直接复用 jobValidityWhere —— 即**求职者可见性用的同一个条件**。
 * 含义因此非常硬:批量发布只发「发布后真的会被求职者看到」的岗位。
 */
export function bulkPublishNotExpiredWhere(
  kind: BulkPublishKind,
  now: Date,
): Prisma.JobWhereInput | Prisma.JobFairWhereInput | null {
  if (kind === 'job') return jobValidityWhere(now)
  // endAt 在 schema 里非空,可以直接写正向比较;与 buildFairStatusWhere('ended')
  // 的 `endAt < now` 恰为互补。
  if (kind === 'fair') return { endAt: { gte: now } }
  return null
}

/**
 * 「已过期」条件,用于如实统计 excluded.expired。
 * null = 没有有效期概念 → 调用方按 0 计。
 */
export function bulkPublishExpiredWhere(
  kind: BulkPublishKind,
  now: Date,
): Prisma.JobWhereInput | Prisma.JobFairWhereInput | null {
  if (kind === 'job') return jobExpiredWhere(now)
  if (kind === 'fair') return buildFairStatusWhere('ended', now)
  return null
}

/**
 * 行级判定,用于 execute 阶段。
 *
 * preview 与 execute 之间可能隔着很久(操作者看完清单去开会了),
 * 期间条目可能刚好过期。只在 preview 收窄候选池不够 ——
 * execute 必须对**实际提交的每一条**再判一次,否则过期条目仍会从
 * 「预览时还没过期」这条缝里漏上前台。
 */
export function isBulkPublishExpired(
  kind: BulkPublishKind,
  row: Record<string, unknown> | undefined,
  now: Date,
): boolean {
  if (!row) return false
  if (kind === 'job') {
    const v = row.validThrough
    return isJobExpired(v instanceof Date ? v : null, now)
  }
  if (kind === 'fair') {
    const v = row.endAt
    return v instanceof Date && v.getTime() < now.getTime()
  }
  return false
}

/** 人话原因,直接展示给运营(逐条失败明细里的 errorMessage)。 */
export function bulkPublishExpiredMessage(kind: BulkPublishKind, row: Record<string, unknown> | undefined): string {
  const field = kind === 'job' ? row?.validThrough : row?.endAt
  const when = field instanceof Date ? field.toISOString().slice(0, 10) : '未知日期'
  const what = kind === 'job' ? `该岗位有效期已于 ${when} 截止` : `该招聘会已于 ${when} 结束`
  return `${what},批量发布不复活过期内容。如确需上线请核对来源数据后单条发布。`
}
