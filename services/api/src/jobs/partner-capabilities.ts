import { ForbiddenException } from '@nestjs/common'
import type { AccessMode, SourceKind } from './jobs-shared'

export const ADMIN_MANAGED_ACCESS_MODES = ['api', 'webhook'] as const satisfies readonly AccessMode[]

interface PartnerCapabilityRule {
  allowedAccessModes: readonly AccessMode[]
  allowedSourceKinds: readonly SourceKind[]
  defaultSourceKind: SourceKind
  canImportJobs: boolean
  canImportFairs: boolean
}

const FULL_ACCESS_MODES = ['api', 'excel', 'csv', 'json', 'webhook', 'manual'] as const

const PARTNER_CAPABILITY_MATRIX: Record<string, PartnerCapabilityRule> = {
  school_employment_center: {
    allowedAccessModes: FULL_ACCESS_MODES,
    allowedSourceKinds: ['school', 'manual'],
    defaultSourceKind: 'school',
    canImportJobs: true,
    canImportFairs: true,
  },
  public_employment_service: {
    allowedAccessModes: FULL_ACCESS_MODES,
    allowedSourceKinds: ['aggregator', 'manual'],
    defaultSourceKind: 'aggregator',
    canImportJobs: true,
    canImportFairs: true,
  },
  licensed_hr_agency: {
    allowedAccessModes: FULL_ACCESS_MODES,
    allowedSourceKinds: ['hr_company', 'job_platform', 'aggregator', 'manual'],
    defaultSourceKind: 'hr_company',
    canImportJobs: true,
    canImportFairs: false,
  },
  fair_organizer: {
    // 当前 Webhook 端点只接受岗位，尚无招聘会 Webhook，先 fail-closed。
    allowedAccessModes: ['api', 'excel', 'csv', 'json', 'manual'],
    allowedSourceKinds: ['fair_organizer', 'manual'],
    defaultSourceKind: 'fair_organizer',
    canImportJobs: false,
    canImportFairs: true,
  },
  enterprise_source: {
    allowedAccessModes: ['excel', 'csv', 'manual'],
    allowedSourceKinds: ['manual'],
    defaultSourceKind: 'manual',
    canImportJobs: true,
    canImportFairs: false,
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
