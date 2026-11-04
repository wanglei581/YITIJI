import { toLicenseWindow } from './license-gate'
import { graceEndsAt, licensePhase, normalizeLicenseMode, resolveOrgLicense } from './license-state'
import { beijingDateOf, lastDayOf, periodText } from './license-time'
import type {
  LicenseMode,
  LicenseStatus,
  LicenseView,
  OrgLicenseOverview,
  PartnerLicenseView,
} from './license.types'

/** 库里的一行授权（只列用到的列）。 */
export interface LicenseRow {
  id: string
  orgId: string
  licenseeName: string
  creditCode: string
  contractNo: string
  startsAt: Date
  endsAt: Date
  terminalQuota: number
  graceDays: number
  status: string
  note: string | null
  statusReason: string | null
  statusTicketNo: string | null
  statusChangedAt: Date | null
  statusChangedBy: string | null
  createdBy: string
  updatedBy: string | null
  version: number
  createdAt: Date
  updatedAt: Date
}

/** 宽限的最后一天（含当天）；没有宽限（graceDays 为 0）时 null。 */
export function graceEndsOn(row: Pick<LicenseRow, 'endsAt' | 'graceDays'>): string | null {
  return row.graceDays > 0 ? lastDayOf(graceEndsAt(row)) : null
}

export function licenseView(row: LicenseRow, now: Date): LicenseView {
  const window = toLicenseWindow(row)
  return {
    id: row.id,
    orgId: row.orgId,
    version: row.version,
    licenseeName: row.licenseeName,
    creditCode: row.creditCode,
    contractNo: row.contractNo,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    startsOn: beijingDateOf(row.startsAt),
    endsOn: lastDayOf(row.endsAt),
    periodText: periodText(row.startsAt, row.endsAt),
    graceDays: row.graceDays,
    graceEndsAt: graceEndsAt(window).toISOString(),
    graceEndsOn: graceEndsOn(row),
    terminalQuota: row.terminalQuota,
    status: row.status as LicenseStatus,
    phase: licensePhase(window, now),
    note: row.note,
    statusReason: row.statusReason,
    statusTicketNo: row.statusTicketNo,
    statusChangedAt: row.statusChangedAt?.toISOString() ?? null,
    statusChangedBy: row.statusChangedBy,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 给审计用的快照：只放业务字段，不放时间戳噪声。 */
export function licenseSnapshot(row: LicenseRow): Record<string, unknown> {
  return {
    id: row.id,
    orgId: row.orgId,
    licenseeName: row.licenseeName,
    creditCode: row.creditCode,
    contractNo: row.contractNo,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    startsOn: beijingDateOf(row.startsAt),
    endsOn: lastDayOf(row.endsAt),
    terminalQuota: row.terminalQuota,
    graceDays: row.graceDays,
    status: row.status,
    note: row.note,
    version: row.version,
  }
}

export interface OrgForOverview {
  id: string
  name: string
  licenseMode: string | null
}

export interface BuiltOverview {
  overview: OrgLicenseOverview
  resolution: ReturnType<typeof resolveOrgLicense>
}

/** 把一个机构的授权行 + 已绑终端数，整理成界面要的概览。 */
export function buildOverview(
  org: OrgForOverview,
  rows: LicenseRow[],
  terminalsBound: number,
  now: Date,
): BuiltOverview {
  const resolution = resolveOrgLicense({
    mode: org.licenseMode,
    licenses: rows.map(toLicenseWindow),
    now,
  })
  const byId = new Map(rows.map((row) => [row.id, row]))
  const view = (id: string | undefined): LicenseView | null => {
    const row = id ? byId.get(id) : undefined
    return row ? licenseView(row, now) : null
  }
  const terminalQuota = resolution.current?.terminalQuota ?? null
  return {
    resolution,
    overview: {
      orgId: org.id,
      orgName: org.name,
      licenseMode: normalizeLicenseMode(org.licenseMode) as LicenseMode,
      managed: resolution.managed,
      state: resolution.state,
      usable: resolution.usable,
      daysLeft: resolution.daysLeft,
      coveredUntil: resolution.coveredUntil?.toISOString() ?? null,
      coveredUntilOn: resolution.coveredUntil ? lastDayOf(resolution.coveredUntil) : null,
      current: view(resolution.current?.id),
      upcoming: view(resolution.upcoming?.id),
      terminalQuota,
      terminalsBound,
      overQuota: resolution.managed && terminalQuota !== null && terminalsBound > terminalQuota,
    },
  }
}

/** 机构自己看：不含备注、暂停理由、工单号、经办人。 */
export function partnerView(overview: OrgLicenseOverview): PartnerLicenseView {
  const current = overview.current
  const upcoming = overview.upcoming
  return {
    licenseMode: overview.licenseMode,
    managed: overview.managed,
    state: overview.state,
    usable: overview.usable,
    daysLeft: overview.daysLeft,
    current: current
      ? {
          licenseeName: current.licenseeName,
          startsAt: current.startsAt,
          endsAt: current.endsAt,
          startsOn: current.startsOn,
          endsOn: current.endsOn,
          periodText: current.periodText,
          graceDays: current.graceDays,
          graceEndsAt: current.graceEndsAt,
          graceEndsOn: current.graceEndsOn,
          terminalQuota: current.terminalQuota,
          status: current.status,
        }
      : null,
    upcoming: upcoming
      ? {
          startsAt: upcoming.startsAt,
          endsAt: upcoming.endsAt,
          startsOn: upcoming.startsOn,
          endsOn: upcoming.endsOn,
          periodText: upcoming.periodText,
          graceEndsOn: upcoming.graceEndsOn,
          terminalQuota: upcoming.terminalQuota,
        }
      : null,
    terminalsBound: overview.terminalsBound,
  }
}
