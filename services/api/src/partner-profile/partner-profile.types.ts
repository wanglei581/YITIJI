// ============================================================
// 合作机构资料返回契约（Sprint 1 / Task 4）。
//
// 数据源是 Organization 表（Task 4 扩字段）。partner 只能读写**本机构**（orgId from JWT）。
//
// 合规边界（CLAUDE.md §2/§6/§18）：
//   - 这是「合作机构资料维护」，纯机构主体信息，不涉招聘闭环 / 候选人 / 简历 / 面试 / Offer。
//   - type（机构类型）/ enabled（合作状态）由平台管理员维护，对 partner **只读**。
//   - contactName 复用 Organization.contact 列（单一真相源）。
// ============================================================

export interface PartnerProfile {
  id: string
  /** 机构名称（可编辑） */
  name: string
  /** 机构类型（只读，平台管理员维护）。取值同 packages/shared PartnerType。 */
  type: string
  creditCode: string | null
  /** 联系人姓名（可编辑，落 Organization.contact 列） */
  contactName: string | null
  contactPhone: string | null
  contactEmail: string | null
  address: string | null
  description: string | null
  websiteUrl: string | null
  /** 合作状态（只读，平台管理员维护）：true=启用 / false=停用 */
  enabled: boolean
  createdAt: string
  updatedAt: string
}
