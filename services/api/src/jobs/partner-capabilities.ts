import { ForbiddenException } from '@nestjs/common'
import type { AccessMode, SourceKind } from './jobs-shared'

export const ADMIN_MANAGED_ACCESS_MODES = ['api', 'webhook'] as const satisfies readonly AccessMode[]

export type CompanyManageScope = 'unrestricted' | 'fair_associated' | 'own_enterprise'

interface PartnerCapabilityRule {
  allowedAccessModes: readonly AccessMode[]
  allowedSourceKinds: readonly SourceKind[]
  defaultSourceKind: SourceKind
  canImportJobs: boolean
  canImportFairs: boolean
  /**
   * 能否**创建**政策内容。规则原本硬编码在 policies.service.ts 的
   * POLICY_CAPABLE_ORG_TYPES 里，2026-09-02 上收到本矩阵，避免服务端与
   * Partner 控制台各存一份而漂移。语义与拒写理由见 policies.service.ts
   * 的 assertPolicyCapableOrgType（政策属官方性质，商业机构不得冒名发布）。
   */
  canManagePolicies: boolean
  /** 能否配置智慧校园（读写都拒，见 smart-campus.service.ts 的 assertSchoolOrg）。 */
  canManageSmartCampus: boolean
  /**
   * 能否维护企业展示资料（CompanyProfile）。所有已知机构类型均可进入该页；
   * 写入范围由 companyManageScope 收窄（fair_organizer / enterprise_source）。
   */
  canManageCompanies: boolean
  companyManageScope: CompanyManageScope
}

const FULL_ACCESS_MODES = ['api', 'excel', 'csv', 'json', 'webhook', 'manual'] as const

const PARTNER_CAPABILITY_MATRIX: Record<string, PartnerCapabilityRule> = {
  school_employment_center: {
    allowedAccessModes: FULL_ACCESS_MODES,
    allowedSourceKinds: ['school', 'manual'],
    defaultSourceKind: 'school',
    canImportJobs: true,
    canImportFairs: true,
    canManagePolicies: true,
    canManageSmartCampus: true,
    canManageCompanies: true,
    companyManageScope: 'unrestricted',
  },
  public_employment_service: {
    allowedAccessModes: FULL_ACCESS_MODES,
    allowedSourceKinds: ['aggregator', 'manual'],
    defaultSourceKind: 'aggregator',
    canImportJobs: true,
    canImportFairs: true,
    canManagePolicies: true,
    canManageSmartCampus: false,
    canManageCompanies: true,
    companyManageScope: 'unrestricted',
  },
  licensed_hr_agency: {
    allowedAccessModes: FULL_ACCESS_MODES,
    allowedSourceKinds: ['hr_company', 'job_platform', 'aggregator', 'manual'],
    defaultSourceKind: 'hr_company',
    canImportJobs: true,
    canImportFairs: false,
    canManagePolicies: false,
    canManageSmartCampus: false,
    canManageCompanies: true,
    companyManageScope: 'unrestricted',
  },
  fair_organizer: {
    // 当前 Webhook 端点只接受岗位，尚无招聘会 Webhook，先 fail-closed。
    allowedAccessModes: ['api', 'excel', 'csv', 'json', 'manual'],
    allowedSourceKinds: ['fair_organizer', 'manual'],
    defaultSourceKind: 'fair_organizer',
    canImportJobs: false,
    canImportFairs: true,
    canManagePolicies: false,
    canManageSmartCampus: false,
    canManageCompanies: true,
    companyManageScope: 'fair_associated',
  },
  enterprise_source: {
    allowedAccessModes: ['excel', 'csv', 'manual'],
    allowedSourceKinds: ['manual'],
    defaultSourceKind: 'manual',
    canImportJobs: true,
    canImportFairs: false,
    canManagePolicies: false,
    canManageSmartCampus: false,
    canManageCompanies: true,
    companyManageScope: 'own_enterprise',
  },
}

function deny(message: string): never {
  throw new ForbiddenException({
    error: { code: 'PARTNER_CAPABILITY_DENIED', message },
  })
}

export function getPartnerCapabilities(orgType: string) {
  const rule = PARTNER_CAPABILITY_MATRIX[orgType]
  if (!rule) deny(`机构类型 ${orgType} 尚未配置数据接入权限`)
  return {
    orgType,
    allowedAccessModes: [...rule.allowedAccessModes],
    allowedSourceKinds: [...rule.allowedSourceKinds],
    defaultSourceKind: rule.defaultSourceKind,
    adminManagedAccessModes: [...ADMIN_MANAGED_ACCESS_MODES],
    canImportJobs: rule.canImportJobs,
    canImportFairs: rule.canImportFairs,
    canManagePolicies: rule.canManagePolicies,
    canManageSmartCampus: rule.canManageSmartCampus,
    canManageCompanies: rule.canManageCompanies,
    companyManageScope: rule.companyManageScope,
  }
}

/**
 * 不抛异常的能力查询，给「已经有自己的错误码/文案」的调用点用
 * （policies.service.ts 的 ORG_TYPE_NOT_ALLOWED_FOR_POLICY、
 * smart-campus.service.ts 的 PARTNER_NOT_SCHOOL）。
 *
 * 它们改成读本矩阵，是为了让规则**只有一处定义**：Partner 控制台通过
 * `GET /partner/data-sources/capabilities` 读到的就是这同一份，
 * 不会出现前端放行、服务端拒写的漂移。
 *
 * 未知机构类型一律 false（fail-closed），与 getPartnerCapabilities 的 deny 一致。
 */
export function partnerOrgTypeCan(
  orgType: string,
  capability: 'importJobs' | 'importFairs' | 'managePolicies' | 'manageSmartCampus' | 'manageCompanies',
): boolean {
  const rule = PARTNER_CAPABILITY_MATRIX[orgType]
  if (!rule) return false
  switch (capability) {
    case 'importJobs':        return rule.canImportJobs
    case 'importFairs':       return rule.canImportFairs
    case 'managePolicies':    return rule.canManagePolicies
    case 'manageSmartCampus': return rule.canManageSmartCampus
    case 'manageCompanies':   return rule.canManageCompanies
  }
}

export function assertDataSourceCapability(orgType: string, accessMode: string, sourceKind: string): void {
  const capabilities = getPartnerCapabilities(orgType)
  if (!capabilities.allowedAccessModes.includes(accessMode as AccessMode)) {
    deny(`机构类型 ${orgType} 不允许使用 ${accessMode} 接入方式`)
  }
  if (!capabilities.allowedSourceKinds.includes(sourceKind as SourceKind)) {
    deny(`机构类型 ${orgType} 不允许声明 ${sourceKind} 来源类型`)
  }
}

export function assertPartnerDataTypeCapability(orgType: string, dataType: 'job' | 'fair'): void {
  const capabilities = getPartnerCapabilities(orgType)
  if (dataType === 'job' && !capabilities.canImportJobs) {
    deny(`机构类型 ${orgType} 不允许录入通用岗位数据`)
  }
  if (dataType === 'fair' && !capabilities.canImportFairs) {
    deny(`机构类型 ${orgType} 不允许录入招聘会数据`)
  }
}

export function isAdminManagedAccessMode(accessMode: string): boolean {
  return (ADMIN_MANAGED_ACCESS_MODES as readonly string[]).includes(accessMode)
}
