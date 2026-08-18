// ============================================================
// 「内容可信」控件的纯规则 + 控件位置常量
//
// ## 为什么单独成一个不 import 任何东西的文件
//
// 1. 门禁 apps/admin/scripts/verify-admin-content-trust-ui.mjs 要把这里的提交
//    守卫拿去和**服务端** services/api/src/orgs/admin-org-content-trust.service.ts
//    的两处 throw 守卫做全矩阵比对。规则写在 .tsx 组件里就只能做字符串匹配，
//    锁不住行为；写在这里，门禁可以真正求值。
//    因此本文件不得 import 任何模块（尤其不得碰 import.meta.env / React），
//    否则门禁无法在纯 node 下加载它。
//
// 2. 「去哪把机构标成内容可信」这句指路文案必须引用本文件的路径常量，不许各处
//    手写。手写过一次的代价：apps/admin/src/routes/components/BulkPublishButton.tsx
//    在 2026-08-17 就写着「到『合作机构』把该机构标记为内容可信」，而当时
//    apps/admin/src/routes/partners/ 下**没有任何 trust 控件** —— 运营照着那句话
//    找不到东西，只能去连数据库或跑维护脚本，绕过审计留痕。
//
// ## 契约锚点
//
// 状态取值：services/api/src/orgs/admin-org-content-trust.service.ts
//           的 ORG_CONTENT_TRUST_STATUSES。
// 发布判据：services/api/src/common/content-trust.ts 的 contentTrustDenial
//           —— contentTrustStatus === 'active' && archivedAt == null。
// ============================================================

/** 与服务端 ORG_CONTENT_TRUST_STATUSES 一致；顺序也一致，直接用于下拉选项。 */
export const ORG_CONTENT_TRUST_STATUSES = ['pending', 'active', 'suspended', 'revoked'] as const

export type OrgContentTrustStatus = (typeof ORG_CONTENT_TRUST_STATUSES)[number]

/** 运营看得懂的说法；括号里保留原值，便于和接口返回、审计日志对照。 */
export const ORG_CONTENT_TRUST_STATUS_LABELS: Record<OrgContentTrustStatus, string> = {
  pending: '待核验',
  active: '内容可信',
  suspended: '已暂停',
  revoked: '已撤销',
}

/** null（从未标记）在页面上的说法。发布闸门对它同样是拒绝。 */
export const ORG_CONTENT_TRUST_UNSET_LABEL = '未标记'

/**
 * 「内容可信」控件在 Admin 后台里的**真实**位置，三段都必须是页面上真渲染得出来的文案：
 *   [0] 左侧导航项           → apps/admin/src/layouts/AdminLayoutWrapper.tsx 的 NAV_ITEMS
 *   [1] 机构行「详情/账号」打开的抽屉标题 → apps/admin/src/routes/partners/index.tsx
 *   [2] 抽屉内该控件的小节标题 → apps/admin/src/routes/partners/OrgContentTrustPanel.tsx
 * 任何指路文案都引用本常量，不许手写。门禁逐段核对它确实被渲染。
 */
export const CONTENT_TRUST_UI_PATH = ['合作机构', '机构详情', '内容可信'] as const

/** 指路文案里直接内插的那一串。 */
export const CONTENT_TRUST_UI_PATH_TEXT = CONTENT_TRUST_UI_PATH.join(' → ')

/** 提交被挡住的原因；null = 可以提交。与服务端两处 400 一一对应。 */
export type ContentTrustSubmitBlock = 'reason_required' | 'archived' | null

/**
 * 提交守卫。**判据与顺序都对齐服务端**：
 *
 *   服务端 setContentTrust 先 `const reason = (dto.reason ?? '').trim()`，然后
 *     if (status === 'active' && reason.length === 0)  → 400 CONTENT_TRUST_REASON_REQUIRED
 *     if (status === 'active' && org.archivedAt != null) → 400 ORG_ARCHIVED
 *
 * 前端不是在「帮服务端判一遍」，而是要让运营在点下去之前就知道会被拒、以及为什么。
 * 服务端那两道校验一条都不能因此拿掉 —— 它们才是真正生效的那道。
 */
export function contentTrustSubmitBlock(input: {
  status: OrgContentTrustStatus
  reason: string
  archived: boolean
}): ContentTrustSubmitBlock {
  if (input.status === 'active' && input.reason.trim().length === 0) return 'reason_required'
  if (input.status === 'active' && input.archived) return 'archived'
  return null
}

/** 被挡住时给运营看的话；说清「凭什么信任这个来源」要写什么。 */
export function contentTrustSubmitBlockMessage(block: Exclude<ContentTrustSubmitBlock, null>): string {
  if (block === 'reason_required') {
    return '标记为「内容可信」必须填写核验依据：这批岗位/招聘会/政策凭什么可以对外展示（合作协议编号、授权函编号、公开数据许可等）。依据会写进审计日志。'
  }
  return '该机构已归档。已归档机构即使标记为内容可信，其内容仍然发布不出去（发布闸门要求 active 且未归档）。请先取消归档再核验。'
}

/**
 * 发布闸门判据的正向说法，与 services/api/src/common/content-trust.ts 的
 * contentTrustDenial 同源：两个条件都要，缺一即拒。
 * 页面用它回答运营那句「我标了，为什么还发不出去」。
 */
export function contentTrustPublishable(status: string | null, archived: boolean): boolean {
  return status === 'active' && !archived
}
