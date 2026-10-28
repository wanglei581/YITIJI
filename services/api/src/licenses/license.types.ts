/**
 * 软件使用授权契约本地副本。
 *
 * **契约源**：packages/shared/src/types/license.ts
 *
 * services/api 走 commonjs，无法直接 import 共享包（shared 为 ESM-only），
 * 所以常量与类型在此留一份；门禁 verify:license 逐项比对两份，改一处必须改两处。
 *
 * 定位：公司是设备与软件供应方，授权是「软件使用授权」，只按期限与终端台数授权，
 * 不得与岗位、招聘会、浏览、投递、入职挂钩（CLAUDE.md §1）——所以这里没有任何这类字段。
 */

export const LICENSE_MODES = ['none', 'required'] as const
export type LicenseMode = (typeof LICENSE_MODES)[number]

export const LICENSE_STATUSES = ['active', 'suspended', 'revoked'] as const
export type LicenseStatus = (typeof LICENSE_STATUSES)[number]

export const ORG_LICENSE_STATES = ['ok', 'grace', 'expired', 'suspended', 'unlicensed'] as const
export type OrgLicenseState = (typeof ORG_LICENSE_STATES)[number]

export const LICENSE_PHASES = ['pending', 'active', 'grace', 'expired', 'suspended', 'revoked'] as const
export type LicensePhase = (typeof LICENSE_PHASES)[number]

export const LICENSE_DEFAULT_GRACE_DAYS = 7
export const LICENSE_MAX_GRACE_DAYS = 30
export const LICENSE_MAX_TERMINAL_QUOTA = 10000
export const LICENSE_REASON_MIN_LENGTH = 2
export const LICENSE_REASON_MAX_LENGTH = 200
export const LICENSE_TICKET_NO_MAX_LENGTH = 64
export const LICENSE_TICKET_NO_PATTERN = '^[A-Za-z0-9_/-]+$'
export const LICENSE_CONTRACT_NO_MAX_LENGTH = 64
export const LICENSE_WARN_DAYS = [30, 7, 1] as const

export type KioskLicenseState = 'ok' | 'grace' | 'inactive'

export interface LicenseView {
  id: string
  orgId: string
  version: number
  licenseeName: string
  creditCode: string
  contractNo: string
  startsAt: string
  endsAt: string
  startsOn: string
  endsOn: string
  periodText: string
  graceDays: number
  graceEndsAt: string
  graceEndsOn: string | null
  terminalQuota: number
  status: LicenseStatus
  phase: LicensePhase
  note: string | null
  statusReason: string | null
  statusTicketNo: string | null
  statusChangedAt: string | null
  statusChangedBy: string | null
  createdBy: string
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface OrgLicenseOverview {
  orgId: string
  orgName: string
  licenseMode: LicenseMode
  managed: boolean
  state: OrgLicenseState
  usable: boolean
  daysLeft: number | null
  coveredUntil: string | null
  coveredUntilOn: string | null
  current: LicenseView | null
  upcoming: LicenseView | null
  terminalQuota: number | null
  terminalsBound: number
  overQuota: boolean
}

export interface OrgLicenseDetail extends OrgLicenseOverview {
  items: LicenseView[]
}

/** 增改续期暂停恢复吊销接口的统一返回：被改动（或新建）的那条授权的编号，加上刷新后的整个机构授权一节。 */
export interface LicenseMutationResult {
  licenseId: string
  org: OrgLicenseDetail
}

export interface LicenseAttention {
  expiringSoon: OrgLicenseOverview[]
  grace: OrgLicenseOverview[]
  inactive: OrgLicenseOverview[]
  counts: { expiringSoon: number; grace: number; inactive: number }
}

export interface PartnerLicenseView {
  licenseMode: LicenseMode
  managed: boolean
  state: OrgLicenseState
  usable: boolean
  daysLeft: number | null
  current: {
    licenseeName: string
    startsAt: string
    endsAt: string
    startsOn: string
    endsOn: string
    periodText: string
    graceDays: number
    graceEndsAt: string
    graceEndsOn: string | null
    terminalQuota: number
    status: LicenseStatus
  } | null
  upcoming: {
    startsAt: string
    endsAt: string
    startsOn: string
    endsOn: string
    periodText: string
    graceEndsOn: string | null
    terminalQuota: number
  } | null
  terminalsBound: number
}

export interface CreateLicenseInput {
  licenseeName: string
  creditCode: string
  contractNo: string
  startsOn: string
  endsOn: string
  terminalQuota: number
  graceDays?: number
  note?: string | null
}

export interface UpdateLicenseInput {
  version: number
  reason: string
  licenseeName?: string
  creditCode?: string
  contractNo?: string
  startsOn?: string
  endsOn?: string
  terminalQuota?: number
  graceDays?: number
  note?: string | null
}

export interface RenewLicenseInput {
  licenseeName: string
  creditCode: string
  contractNo: string
  startsOn?: string
  endsOn: string
  terminalQuota?: number
  graceDays?: number
  note?: string | null
}

export interface LicenseStatusChangeInput {
  version: number
  reason: string
  approvalTicketNo: string
}

export interface LicenseResumeInput {
  version: number
  reason: string
}

export interface SetLicenseModeInput {
  licenseMode: LicenseMode
  confirmLockout?: boolean
  reason: string
}
