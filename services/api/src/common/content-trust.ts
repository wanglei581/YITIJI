// ============================================================
// 发布闸门 —— 来源机构内容信任(contentTrust)fail-closed
//
// ## 为什么存在这个文件
//
// `Organization.contentTrustStatus` 等 5 列在 P1 expand（20260810100000）
// 就已建好，schema 注释写的是「nullable，旧 reader 不读取；Wave 2 经审计/人工
// 清单回填后**再切门禁**」。那句「再切门禁」从未在发布路径发生：
//
//   - `RecruitmentContentReadService` 里确实有 `contentTrustStatus !== 'active'`
//     的 fail-closed，但它只被 `admin-recruitment-content.controller.ts`
//     （管理端只读治理视图）使用，不在公开路径、更不在发布路径上。
//   - 单条发布（publishJobSource / publishFairSource / publishPolicy /
//     companies.adminPublish）和批量发布对 contentTrust 零引用。
//
// 后果是一起真实事故：治理清单 `docs/operations/production-content-data-
// replacement-list-2026-08.md` 对 `org-tencent-real-job-sample-20260701`
// 的裁定逐字是「未授权不进入生产」，但该机构的岗位仍被推上了生产公网 —— 因为
// 闸门根本没装在门上，靠的是人不点那个按钮。
//
// 更糟的是：下架后 `publishStatus` 变成 `unpublished`，而
// `BULK_PUBLISHABLE_FROM = ['draft','unpublished']`，被下架的内容原样落回批量
// 发布候选池。只下架不装闸门，下一次点「批量发布」就会原样复发。
//
// ## 判据（两个条件都要，缺一即拒）
//
//   contentTrustStatus === 'active'  &&  archivedAt == null
//
// fail-closed 的含义是「未知即拒绝」：nullable 未标记(null)、pending、
// suspended、revoked、机构行不存在 —— 一律拒绝。只有被人显式核验并标记为
// active 且未归档的机构，其内容才允许发布。
//
// ## 不做什么（本轮明确划走的范围）
//
// 公开**读取**路径这次不接。回填未完成时给读路径加同样判据会让前台整体变空，
// 风险大于收益。读路径是后续项，不在本文件承担。
// ============================================================

import { BadRequestException } from '@nestjs/common'

/** 唯一放行值。任何其它取值（含 null）都不放行。 */
export const CONTENT_TRUST_ACTIVE = 'active'

/** 发布被信任闸门拒绝时的错误码。前端 / 批量明细 / 运营话术都认这个串。 */
export const CONTENT_TRUST_DENIED_CODE = 'ORG_CONTENT_TRUST_REQUIRED'

/** 闸门只需要机构的这 4 个字段，调用方 select 时按这个取即可。 */
export interface OrgTrustFacts {
  id: string
  name: string | null
  contentTrustStatus: string | null
  archivedAt: Date | null
}

/** 闸门只用到 organization 表的两个只读方法，便于验证脚本用内存假 Prisma 驱动。 */
export interface OrgTrustReader {
  organization: {
    findUnique(args: {
      where: { id: string }
      select: { id: true; name: true; contentTrustStatus: true; archivedAt: true }
    }): Promise<OrgTrustFacts | null>
    findMany(args: {
      where: { contentTrustStatus: string; archivedAt: null }
      select: { id: true }
    }): Promise<{ id: string }[]>
  }
}

export type ContentTrustDenial = 'org_missing' | 'trust_not_active' | 'archived'

/**
 * 纯判定：可以发布返回 null，不可以返回拒绝原因。
 * 没有任何 I/O，验证脚本可以直接对它做穷举。
 */
export function contentTrustDenial(org: OrgTrustFacts | null): ContentTrustDenial | null {
  if (!org) return 'org_missing'
  if (org.contentTrustStatus !== CONTENT_TRUST_ACTIVE) return 'trust_not_active'
  if (org.archivedAt != null) return 'archived'
  return null
}

/** 判定的正向说法，供批量预览、脚本、未来的读路径复用。 */
export function isContentTrustActive(org: OrgTrustFacts | null): boolean {
  return contentTrustDenial(org) === null
}

/**
 * 人类可读的拒绝原因：说清**哪个机构**、**当前什么状态**、**该怎么办**。
 * 运营看到这句话应该不需要再问工程师。
 */
export function contentTrustDenialMessage(
  sourceOrgId: string,
  org: OrgTrustFacts | null,
  denial: ContentTrustDenial,
): string {
  const who = org?.name ? `来源机构「${org.name}」(${sourceOrgId})` : `来源机构 ${sourceOrgId}`
  const howTo =
    '请先完成来源授权核验，再由管理员在「管理员后台 → 合作机构」把该机构标记为内容可信' +
    '(PATCH /api/v1/admin/orgs/:id/content-trust，body: { "status": "active", "reason": "<授权依据>" })，然后重试发布。'

  if (denial === 'org_missing') {
    return `${who} 在机构表中不存在，无法核验内容信任状态，按 fail-closed 拒绝发布。${howTo}`
  }
  if (denial === 'archived') {
    return `${who} 已归档(archivedAt=${org?.archivedAt?.toISOString() ?? '非空'})，已归档机构的内容不得发布。如需继续供稿，请先取消归档并重新核验。`
  }
  const current = org?.contentTrustStatus ?? '未标记(null)'
  return `${who} 未通过内容信任核验：当前 contentTrustStatus=${current}，发布要求 ${CONTENT_TRUST_ACTIVE} 且未归档。${howTo}`
}

/**
 * 发布闸门本体。所有能把内容变成 `published` 的路径都必须先过这里。
 *
 * 刻意写成「拿 prisma 的普通函数」而不是可注入的 Nest service：
 * 少一层 DI 就少一种「构造时忘了传、闸门静默变成 undefined」的绕过方式。
 *
 * @param contentType 用于错误信息定位，如 'job' / 'fair' / 'policy'
 */
export async function assertOrgContentTrustActive(
  prisma: OrgTrustReader,
  sourceOrgId: string | null | undefined,
  ctx: { contentType: string; contentId: string },
): Promise<void> {
  // 空 sourceOrgId 同样 fail-closed：org 归属未知的内容不该走到有 sourceOrgId 的
  // 发布路径上（Job / JobFair / PolicyPost / CompanyProfile 的 sourceOrgId 都是
  // schema 层 NOT NULL）。真正「本来就没有来源机构」的内容类型，调用方自己判断
  // 后不要调本函数，而不是让本函数放行未知。
  if (!sourceOrgId) {
    throw new BadRequestException({
      error: {
        code: CONTENT_TRUST_DENIED_CODE,
        message: `${ctx.contentType} ${ctx.contentId} 没有来源机构(sourceOrgId 为空)，无法核验内容信任状态，按 fail-closed 拒绝发布。`,
      },
    })
  }

  const org = await prisma.organization.findUnique({
    where: { id: sourceOrgId },
    select: { id: true, name: true, contentTrustStatus: true, archivedAt: true },
  })

  const denial = contentTrustDenial(org)
  if (denial === null) return

  throw new BadRequestException({
    error: {
      code: CONTENT_TRUST_DENIED_CODE,
      message: contentTrustDenialMessage(sourceOrgId, org, denial),
      details: {
        sourceOrgId,
        organizationName: org?.name ?? null,
        contentTrustStatus: org?.contentTrustStatus ?? null,
        archived: org?.archivedAt != null,
        denial,
        contentType: ctx.contentType,
        contentId: ctx.contentId,
      },
    },
  })
}

/**
 * 当前允许发布的机构 id 全集，供批量预览把不可信来源**在预览阶段**就分流进
 * excluded 统计（而不是等执行时逐条报错）。
 *
 * 为什么用 id 集合而不是 Prisma 关系过滤 `org: { is: {...} }`：
 *   - Organization 是机构表，量级是「几十到几百」，一次取全集代价可忽略；
 *   - 生成的 SQL 是纯 `IN (...)`，SQLite 与 PostgreSQL 行为一致，
 *     不依赖 relation filter 在两种 provider 上的等价性。
 * 空集合时 Prisma 的 `in: []` 命中 0 行、`notIn: []` 命中全部 —— 正是要的语义
 * （没有任何可信机构 ⇒ 没有任何内容可发布，全部落进 excluded）。
 */
export async function listContentTrustedOrgIds(prisma: OrgTrustReader): Promise<string[]> {
  const rows = await prisma.organization.findMany({
    where: { contentTrustStatus: CONTENT_TRUST_ACTIVE, archivedAt: null },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}
