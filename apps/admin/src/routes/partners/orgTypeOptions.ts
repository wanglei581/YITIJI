// ============================================================
// 合作机构「机构类型」下拉的可选项（3.15 停放）
//
// 企业数据来源（enterprise_source）与招聘会主办方（fair_organizer）已停放：
//   - 新建机构：下拉里没有这两类；
//   - 编辑存量机构：下拉保留当前值（存量照常显示、原样回传不算改），但不能改成另一类停放类型；
//   - 列表与筛选照常显示这两类的标签（存量仍在）。
// 服务端同一规则见 services/api/src/orgs/parked-org-types.ts（错误码 ORG_TYPE_PARKED），两边清单必须一致，
// apps/admin/scripts/verify-admin-parked-recruitment-ui.mjs 在纯 node 下加载本文件并与服务端清单比对。
//
// 本文件刻意零 import：门禁要在纯 node 下 transpile 后直接求值。
// ============================================================

export const PARKED_ORG_TYPES = ['enterprise_source', 'fair_organizer'] as const

export const PARKED_ORG_TYPE_SUFFIX = '（已停放）'

export function isParkedOrgType(type: string | null | undefined): boolean {
  return typeof type === 'string' && (PARKED_ORG_TYPES as readonly string[]).includes(type)
}

export interface OrgTypeOption {
  value: string
  label: string
}

/** 新建机构：去掉停放类型。 */
export function createOrgTypeOptions(labels: Record<string, string>): OrgTypeOption[] {
  return Object.entries(labels)
    .filter(([value]) => !isParkedOrgType(value))
    .map(([value, label]) => ({ value, label }))
}

/**
 * 编辑机构：非停放类型全部可选；当前值若是停放类型，只保留它自己（标注已停放），
 * 另一类停放类型不出现。
 */
export function editOrgTypeOptions(labels: Record<string, string>, current: string): OrgTypeOption[] {
  return Object.entries(labels)
    .filter(([value]) => !isParkedOrgType(value) || value === current)
    .map(([value, label]) => ({ value, label: isParkedOrgType(value) ? `${label}${PARKED_ORG_TYPE_SUFFIX}` : label }))
}
