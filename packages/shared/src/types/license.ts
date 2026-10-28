/**
 * 软件使用授权契约。
 *
 * **契约源**：本文件。services/api 是 CommonJS，不能 import 共享包，所以在
 * services/api/src/licenses/license.types.ts 留了一份本地副本；门禁 verify:license
 * 会逐项比对两份（常量、取值集合、接口字段），改一处必须改两处。
 *
 * 定位：公司是设备与软件供应方，授权是「软件使用授权」，**只按期限与终端台数**。
 * 不得与岗位、招聘会、浏览、投递、入职挂钩（CLAUDE.md §1）——所以这里没有任何这类字段。
 * 没设授权的机构（licenseMode = none）一律照旧、不管控。
 */

export const LICENSE_MODES = ['none', 'required'] as const
/** none = 不管控（默认，现有点位照旧）；required = 须有生效授权，否则一体机不再签发新会话、机构后台写操作被拒。 */
export type LicenseMode = (typeof LICENSE_MODES)[number]

export const LICENSE_STATUSES = ['active', 'suspended', 'revoked'] as const
/** 一条授权自身的状态。revoked 不可恢复。 */
export type LicenseStatus = (typeof LICENSE_STATUSES)[number]

export const ORG_LICENSE_STATES = ['ok', 'grace', 'expired', 'suspended', 'unlicensed'] as const
/**
 * 机构当前的授权状态（服务端统一一个函数推导，未来才生效的不算当前）：
 * ok 在期内（licenseMode 为 none 时也是 ok）；grace 已到期但在宽限天数内（照常服务）；
 * expired 超过宽限；suspended 被暂停；unlicensed 没有任何可用授权（含只有吊销的、只有待生效的）。
 * expired / suspended / unlicensed 同等处理：一体机不再签发新会话、机构后台写操作被拒。
 */
export type OrgLicenseState = (typeof ORG_LICENSE_STATES)[number]

export const LICENSE_PHASES = ['pending', 'active', 'grace', 'expired', 'suspended', 'revoked'] as const
/** 单条授权在列表里的展示阶段：revoked > suspended > 按时间（待生效 / 生效中 / 宽限中 / 已过期）。 */
export type LicensePhase = (typeof LICENSE_PHASES)[number]

export const LICENSE_DEFAULT_GRACE_DAYS = 7
export const LICENSE_MAX_GRACE_DAYS = 30
export const LICENSE_MAX_TERMINAL_QUOTA = 10000
/** 更正 / 恢复 / 模式切换 / 暂停 / 吊销的理由：去首尾空白后 2–200 字。 */
export const LICENSE_REASON_MIN_LENGTH = 2
export const LICENSE_REASON_MAX_LENGTH = 200
/** 暂停 / 吊销必填的审批工单号：1–64 位，只许字母、数字、- _ /。 */
export const LICENSE_TICKET_NO_MAX_LENGTH = 64
export const LICENSE_TICKET_NO_PATTERN = '^[A-Za-z0-9_/-]+$'
/** 合同编号：1–64 位。 */
export const LICENSE_CONTRACT_NO_MAX_LENGTH = 64
/** 距到期还剩这几天时，往管理员告警通道各推一次；宽限期内每天推一次；结束宽限时再推一次。 */
export const LICENSE_WARN_DAYS = [30, 7, 1] as const

/**
 * 一条授权。期限按合同口径「含到期日」、北京时间：
 *   录入收 startsOn / endsOn（YYYY-MM-DD，都含当天）；服务端存 startsAt = startsOn 当天北京 0 点（含）、
 *   endsAt = endsOn 次日北京 0 点（不含）。*At 字段是 ISO 8601（UTC，带 Z），*On 字段与 periodText 是给人看的北京日期，
 *   界面直接显示 periodText，不自己换算。
 */
export interface LicenseView {
  id: string
  orgId: string
  /** 版本号：从 1 起，每次变更（更正 / 暂停 / 恢复 / 吊销）+1。更正、暂停、恢复、吊销请求必须带上界面读到的版本。 */
  version: number
  /** 被授权企业全称，可与机构名不同。 */
  licenseeName: string
  /** 统一社会信用代码，18 位（格式与校验位都在服务端校验）。 */
  creditCode: string
  /** 合同编号，必填。 */
  contractNo: string
  startsAt: string
  /** 到期时刻（不含）= endsOn 次日北京 0 点。 */
  endsAt: string
  /** 生效第一天（含），北京时间 YYYY-MM-DD。 */
  startsOn: string
  /** 到期日（含当天），北京时间 YYYY-MM-DD。 */
  endsOn: string
  /** 「2026-11-01 至 2027-10-31（北京时间，含当天）」，界面直接显示。 */
  periodText: string
  graceDays: number
  /** endsAt + graceDays 天（不含）。 */
  graceEndsAt: string
  /** 宽限的最后一天（含当天），北京时间 YYYY-MM-DD；graceDays 为 0（没有宽限）时为 null。 */
  graceEndsOn: string | null
  terminalQuota: number
  status: LicenseStatus
  phase: LicensePhase
  note: string | null
  /** 最近一次暂停 / 吊销的理由与工单号（恢复时清空，完整历史在审计日志）。 */
  statusReason: string | null
  statusTicketNo: string | null
  statusChangedAt: string | null
  statusChangedBy: string | null
  createdBy: string
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

/** 一个机构的授权概览（GET /admin/orgs/:orgId/licenses 的头部，也是「今天要处理」列表的行）。 */
export interface OrgLicenseOverview {
  orgId: string
  orgName: string
  licenseMode: LicenseMode
  /** licenseMode === 'required'。false 时 state 恒为 ok，其余字段仅供参考。 */
  managed: boolean
  state: OrgLicenseState
  /** 一体机能否签发新会话、机构后台能否写（ok / grace，或不管控）。 */
  usable: boolean
  /** ok：距到期；grace：距宽限结束；其余 null。向上取整的整天数。 */
  daysLeft: number | null
  /** 连续覆盖到哪一刻（把首尾相接的后续授权一并算上）；仅 state 为 ok 时有值，告警按它算。 */
  coveredUntil: string | null
  /** 连续覆盖的最后一天（含当天），北京时间 YYYY-MM-DD；与 coveredUntil 同时有值。 */
  coveredUntilOn: string | null
  /** 认定的那条（ok / grace / suspended / expired 时有）。 */
  current: LicenseView | null
  /** 最近一条待生效的授权（提前录入的续期）。只认 active 的：被暂停的待生效授权不算，也不能用来提前绑定终端。 */
  upcoming: LicenseView | null
  /** 认定那条的台数上限；没有则 null。 */
  terminalQuota: number | null
  /** 已绑定到本机构的终端数（不含已退役）。 */
  terminalsBound: number
  /** 已绑 > 上限（降台数后的提示）。不自动解绑，只影响「新增绑定」。 */
  overQuota: boolean
}

export interface OrgLicenseDetail extends OrgLicenseOverview {
  /** 全部历史，新的在前。 */
  items: LicenseView[]
}

/** 增改续期暂停恢复吊销接口的统一返回：被改动（或新建）的那条授权的编号，加上刷新后的整个机构授权一节。 */
export interface LicenseMutationResult {
  licenseId: string
  org: OrgLicenseDetail
}

/** GET /admin/licenses/attention：管理员工作台「今天要处理」。只含 licenseMode = required 的机构。 */
export interface LicenseAttention {
  /** 在期内，但连续覆盖在 30 天内结束。 */
  expiringSoon: OrgLicenseOverview[]
  /** 宽限期内。 */
  grace: OrgLicenseOverview[]
  /** 已停用：expired / suspended / unlicensed。 */
  inactive: OrgLicenseOverview[]
  counts: { expiringSoon: number; grace: number; inactive: number }
}

/** GET /partner/license：机构只看得到自己的授权，只读；不含备注、暂停理由、工单号、经办人。 */
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

/**
 * POST /admin/orgs/:orgId/licenses（每条授权是一份合同）。
 * 期限收含到期日的北京日期：startsOn / endsOn 都是 YYYY-MM-DD，都含当天。不再接受带时区的 startsAt / endsAt。
 */
export interface CreateLicenseInput {
  licenseeName: string
  /** 统一社会信用代码，18 位，按 GB 32100 校验位校验。 */
  creditCode: string
  /** 合同编号，1–64 位。 */
  contractNo: string
  startsOn: string
  endsOn: string
  terminalQuota: number
  /** 默认 7，0–30。 */
  graceDays?: number
  note?: string | null
}

/**
 * PATCH /admin/licenses/:id（更正信息 / 改期 / 改台数）；吊销后的授权不能改。
 * version 必填：对不上回 409 LICENSE_VERSION_CONFLICT（有人先改过了，刷新后重来）；reason 必填。
 * 一个字段都没变：不写库、不审计、不加版本，照常返回。
 */
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

/**
 * POST /admin/licenses/:id/renew：新建一条首尾相接的后续授权（旧到期新接上，不断档）。
 * 续期也是一份合同：licenseeName / creditCode / contractNo 都必填。
 * startsOn 可不填，不填 = 上一条授权 endsOn 的次日；填了照样走「非吊销授权期限不得重叠」的校验。
 */
export interface RenewLicenseInput {
  licenseeName: string
  creditCode: string
  contractNo: string
  startsOn?: string
  endsOn: string
  /** 缺省沿用上一条授权。 */
  terminalQuota?: number
  graceDays?: number
  note?: string | null
}

/** POST /admin/licenses/:id/suspend 与 /revoke：version、reason、approvalTicketNo 都必填。 */
export interface LicenseStatusChangeInput {
  version: number
  /** 去首尾空白后 2–200 字。 */
  reason: string
  /** 审批工单号，1–64 位，只许字母、数字、- _ /。 */
  approvalTicketNo: string
}

/** POST /admin/licenses/:id/resume（只对 suspended）：version、reason 必填。 */
export interface LicenseResumeInput {
  version: number
  reason: string
}

/**
 * PUT /admin/orgs/:orgId/license-mode（含切回「不管控」）：reason 必填。
 * 把没有可用授权的机构切到 required 会让它名下的终端不能开新会话——此时必须带 confirmLockout: true，
 * 否则服务端回 409 LICENSE_MODE_WOULD_LOCK_TERMINALS（文案写明受影响终端数；界面也可先用 terminalsBound 做二次确认）。
 */
export interface SetLicenseModeInput {
  licenseMode: LicenseMode
  confirmLockout?: boolean
  reason: string
}
