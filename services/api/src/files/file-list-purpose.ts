/**
 * 管理端文件列表的用途条件。
 *
 * 合同风险提示报告不进这张表。单个用途沿用原来的等值；逗号分隔的多个用途
 * 取并集，用来让「招聘会资料」同时覆盖 fair_material 与 job_fair_material。
 */
export function filePurposeWhere(purpose?: string): {
  purpose: string | { not: string } | { in: string[] }
} {
  const requested = (purpose ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (requested.length === 0) return { purpose: { not: 'contract_review_report' } }
  const visible = requested.filter((item) => item !== 'contract_review_report')
  if (visible.length === 0) return { purpose: '__hidden__' }
  if (visible.length === 1) return { purpose: visible[0]! }
  return { purpose: { in: visible } }
}
