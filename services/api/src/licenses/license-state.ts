/**
 * 授权状态的统一推导（纯函数，不碰数据库、不读时钟）。
 *
 * 一体机会话签发、机构后台写操作、绑定终端、告警、管理员与机构后台的展示，
 * 全部读这一个函数的结果——不许各处自己算「过没过期」。
 *
 * 时间口径（毫秒精度）：
 *   起点含，到期不含：startsAt ≤ 现在 < endsAt 是「在期内」；
 *   endsAt ≤ 现在 < endsAt + graceDays 天 是「宽限期」（照常服务）；
 *   现在 ≥ 宽限结束 是「已过期」。graceDays = 0 即到期当刻就停。
 *   startsAt 在未来的授权是「待生效」，不算当前。
 *
 * 机构状态（只对 licenseMode = required 管控；none 恒为 ok、不管控）：
 *   ok         有一条 active 授权覆盖当前时刻
 *   suspended  没有 ok，且有一条被暂停的授权（含宽限期）还罩着当前时刻
 *   grace      没有 ok / suspended，且有一条 active 授权处在宽限期
 *   expired    起点已到的授权都已过了宽限
 *   unlicensed 一条可用授权都没有（没建过、只有吊销的、只有待生效的）
 *   优先级 ok > suspended > grace > expired > unlicensed。
 *   expired / suspended / unlicensed 同等处理：不可用。
 */
import type { KioskLicenseState, LicenseMode, LicensePhase, LicenseStatus, OrgLicenseState } from './license.types'

export const DAY_MS = 24 * 60 * 60 * 1000

export interface LicenseWindow {
  id: string
  status: LicenseStatus
  startsAt: Date
  endsAt: Date
  graceDays: number
  terminalQuota: number
  createdAt: Date
}

export interface OrgLicenseResolution {
  mode: LicenseMode
  /** mode === 'required'。 */
  managed: boolean
  /** 不管控时恒为 ok。 */
  state: OrgLicenseState
  /** 一体机能签发新会话、机构后台能写：不管控，或 ok / grace。 */
  usable: boolean
  /** 认定的那条：ok / grace / suspended 时是对应那条，expired 时是最近到期的那条，unlicensed 为 null。 */
  current: LicenseWindow | null
  /** 最近一条待生效（未吊销、startsAt 在未来）的授权。 */
  upcoming: LicenseWindow | null
  /** ok：距到期；grace：距宽限结束；其余 null。向上取整的整天数。 */
  daysLeft: number | null
  /** 连续覆盖到哪一刻（把首尾相接的后续 active 授权一并算上）；仅 ok 时有值。 */
  coveredUntil: Date | null
}

export function graceEndsAt(license: Pick<LicenseWindow, 'endsAt' | 'graceDays'>): Date {
  return new Date(license.endsAt.getTime() + license.graceDays * DAY_MS)
}

export function normalizeLicenseMode(value: string | null | undefined): LicenseMode {
  return value === 'required' ? 'required' : 'none'
}

/** 单条授权在列表里的展示阶段：revoked > suspended > 按时间。 */
export function licensePhase(
  license: Pick<LicenseWindow, 'status' | 'startsAt' | 'endsAt' | 'graceDays'>,
  now: Date,
): LicensePhase {
  if (license.status === 'revoked') return 'revoked'
  if (license.status === 'suspended') return 'suspended'
  const t = now.getTime()
  if (t < license.startsAt.getTime()) return 'pending'
  if (t < license.endsAt.getTime()) return 'active'
  if (t < graceEndsAt(license).getTime()) return 'grace'
  return 'expired'
}

/** 同样"最晚到期"的取 endsAt 最大的；再相同取后建的（createdAt 大、id 大）。 */
function latest(list: LicenseWindow[]): LicenseWindow {
  return list.reduce((best, item) => {
    const a = item.endsAt.getTime()
    const b = best.endsAt.getTime()
    if (a !== b) return a > b ? item : best
    const c = item.createdAt.getTime()
    const d = best.createdAt.getTime()
    if (c !== d) return c > d ? item : best
    return item.id > best.id ? item : best
  })
}

function daysUntil(target: Date, now: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - now.getTime()) / DAY_MS))
}

/**
 * 从 cursor 起把「首尾相接」的后续 active 授权串起来，返回连续覆盖到的终点。
 * 相接 = 后续授权的 startsAt ≤ 当前终点、endsAt > 当前终点。
 */
export function continuousCoverageEnd(licenses: LicenseWindow[], from: Date): Date {
  let cursor = from.getTime()
  for (;;) {
    const next = licenses.filter(
      (item) =>
        item.status === 'active' && item.startsAt.getTime() <= cursor && item.endsAt.getTime() > cursor,
    )
    if (next.length === 0) return new Date(cursor)
    cursor = Math.max(...next.map((item) => item.endsAt.getTime()))
  }
}

export function resolveOrgLicense(input: {
  mode: string | null | undefined
  licenses: LicenseWindow[]
  now: Date
}): OrgLicenseResolution {
  const mode = normalizeLicenseMode(input.mode)
  const t = input.now.getTime()
  const live = input.licenses.filter((item) => item.status !== 'revoked')
  const started = live.filter((item) => item.startsAt.getTime() <= t)
  const pending = live
    .filter((item) => item.startsAt.getTime() > t)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime())
  const upcoming = pending[0] ?? null

  let state: OrgLicenseState
  let current: LicenseWindow | null = null
  const covering = started.filter((item) => item.status === 'active' && t < item.endsAt.getTime())
  if (covering.length > 0) {
    state = 'ok'
    current = latest(covering)
  } else {
    const suspended = started.filter((item) => item.status === 'suspended' && t < graceEndsAt(item).getTime())
    if (suspended.length > 0) {
      state = 'suspended'
      current = latest(suspended)
    } else {
      const inGrace = started.filter(
        (item) => item.status === 'active' && t >= item.endsAt.getTime() && t < graceEndsAt(item).getTime(),
      )
      if (inGrace.length > 0) {
        state = 'grace'
        current = latest(inGrace)
      } else if (started.length > 0) {
        state = 'expired'
        current = latest(started)
      } else {
        state = 'unlicensed'
      }
    }
  }

  const managed = mode === 'required'
  const effectiveState: OrgLicenseState = managed ? state : 'ok'
  const usable = !managed || state === 'ok' || state === 'grace'
  let daysLeft: number | null = null
  let coveredUntil: Date | null = null
  if (current && state === 'ok') {
    daysLeft = daysUntil(current.endsAt, input.now)
    coveredUntil = continuousCoverageEnd(input.licenses, current.endsAt)
  } else if (current && state === 'grace') {
    daysLeft = daysUntil(graceEndsAt(current), input.now)
  }
  return {
    mode,
    managed,
    state: effectiveState,
    usable,
    current,
    upcoming,
    daysLeft,
    coveredUntil,
  }
}

/** 一体机只需要知道能不能用：ok / grace / inactive。 */
export function kioskLicenseState(resolution: Pick<OrgLicenseResolution, 'managed' | 'state'>): KioskLicenseState {
  if (!resolution.managed) return 'ok'
  if (resolution.state === 'ok') return 'ok'
  if (resolution.state === 'grace') return 'grace'
  return 'inactive'
}

export type BindingQuota =
  | { allowed: true; quota: number | null }
  | { allowed: false; reason: 'suspended' | 'expired' | 'unlicensed' }

/**
 * 「新增绑定」按哪条授权的台数算：
 *   不管控 → 不限；ok / grace → 认定那条的台数；
 *   expired / unlicensed 但有待生效的（提前装机）→ 按待生效那条的台数；
 *   suspended → 不许（暂停是管理员明确叫停）；其余不许。
 * 只管新增绑定：已绑终端运行期不按台数裁决。
 */
export function bindingQuota(resolution: OrgLicenseResolution): BindingQuota {
  if (!resolution.managed) return { allowed: true, quota: null }
  if ((resolution.state === 'ok' || resolution.state === 'grace') && resolution.current) {
    return { allowed: true, quota: resolution.current.terminalQuota }
  }
  if (resolution.state === 'suspended') return { allowed: false, reason: 'suspended' }
  if (resolution.upcoming) return { allowed: true, quota: resolution.upcoming.terminalQuota }
  return { allowed: false, reason: resolution.state === 'expired' ? 'expired' : 'unlicensed' }
}
