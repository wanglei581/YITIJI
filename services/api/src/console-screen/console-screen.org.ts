/**
 * Partner 大屏机构范围。空值不得退化成全局查询。
 */

declare const partnerOrgIdBrand: unique symbol

export type PartnerOrgId = string & { readonly [partnerOrgIdBrand]: true }

export class PartnerOrgRequiredError extends Error {
  readonly code = 'ORG_REQUIRED' as const

  constructor() {
    super('当前账号未绑定机构')
    this.name = 'PartnerOrgRequiredError'
  }
}

export function requirePartnerOrgId(orgId: unknown): PartnerOrgId {
  if (typeof orgId !== 'string') {
    throw new PartnerOrgRequiredError()
  }
  const trimmed = orgId.trim()
  if (trimmed.length === 0) {
    throw new PartnerOrgRequiredError()
  }
  return trimmed as PartnerOrgId
}

export function partnerSourceOrgWhere(orgId: PartnerOrgId): { sourceOrgId: string } {
  return { sourceOrgId: requirePartnerOrgId(orgId) }
}

export function partnerOrgIdWhere(orgId: PartnerOrgId): { orgId: string } {
  return { orgId: requirePartnerOrgId(orgId) }
}
