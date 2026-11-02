import { BadRequestException, ConflictException } from '@nestjs/common'
import {
  scanDeviceLeaseLimits,
  scanDeviceTooManyPagesMessage,
} from '../files/file-validation'

/**
 * 屏上扫描（device 路线）协议：常量、状态转移表、纯校验函数。
 *
 * 为什么单独成文件：scan-tasks.service.ts 已超过 1000 行（CLAUDE.md §8 的拆分清单线），
 * 屏上扫描的规则不再往里堆；它只在建会话、签租约、查状态、收投递四处调用这里的纯函数。
 *
 * 面板扫描（startMode='panel'）不经过本文件里任何会改变行为的分支：
 * 建会话不带新字段 → resolveScanStartParams 返回 panel → 原路径一字不变。
 *
 * 协议依据：任务包 ③ 屏上扫描 §2（2026-11-02 v2）。云端只记状态、管能力、管投递；
 * 实时指令（开始 / 下一页 / 完成 / 中止）走一体机到终端程序的本机通道，不在这里。
 */

export const SCAN_START_MODES = ['panel', 'device'] as const
export type ScanStartMode = (typeof SCAN_START_MODES)[number]

/** 原件放哪：玻璃台一次一页；进纸器一叠（硬件只有单面进纸）。 */
export const SCAN_DEVICE_SOURCES = ['flatbed', 'feeder'] as const
export type ScanDeviceSource = (typeof SCAN_DEVICE_SOURCES)[number]

/** 屏上「黑白」= gray。 */
export const SCAN_DEVICE_COLOR_MODES = ['gray', 'color'] as const
export type ScanDeviceColorMode = (typeof SCAN_DEVICE_COLOR_MODES)[number]

export const SCAN_DEVICE_STATES = [
  'ready',
  'scanning',
  'page_ready',
  'composing',
  'delivering',
  'error',
  'aborted',
] as const
export type ScanDeviceState = (typeof SCAN_DEVICE_STATES)[number]

export const SCAN_DEVICE_ERROR_CODES = [
  'feeder_empty',
  'paper_jam',
  'cover_open',
  'busy',
  'warming_up',
  'not_ready',
  'timeout',
  'too_large',
  'unknown',
] as const
export type ScanDeviceErrorCode = (typeof SCAN_DEVICE_ERROR_CODES)[number]

/** 投递来源：watcher = 面板扫描后由终端程序监听目录投递；device = 屏上扫描由终端程序自己合成 PDF 投递。 */
export const SCAN_DELIVER_ORIGINS = ['watcher', 'device'] as const
export type ScanDeliverOrigin = (typeof SCAN_DELIVER_ORIGINS)[number]

/** 续期上限：从建会话起最多 30 分钟（hardExpiresAt = createdAt + 30 分钟）。 */
export const SCAN_DEVICE_HARD_LIFETIME_MS = 30 * 60 * 1000
/** 每次收下终端程序回报，把 expiresAt 至少续到「现在 + 3 分钟」（不超过上限）；page_ready 例外，见下一个常量。 */
export const SCAN_DEVICE_RENEW_WINDOW_MS = 3 * 60 * 1000
/**
 * 玻璃台「这一页扫好了」（回报 state = page_ready）时，把 expiresAt 至少续到「现在 + 10 分钟」（不超过上限）。
 * 来源：补稿 cs-scan-more（玻璃台「这一页扫好了」屏）写的「最多 20 页；10 分钟内没操作会自动结束，并删除已扫的页」——
 * 用户放下一页稍慢一点，会话不能只剩 3 分钟就过期。其余 state 的回报仍续 3 分钟。
 */
export const SCAN_DEVICE_PAGE_READY_RENEW_WINDOW_MS = 10 * 60 * 1000
/**
 * 用户「改用面板扫描」时，把 expiresAt 至少续到「现在 + 10 分钟」（= 面板会话的初始时长，不超过上限）。
 * 用户在屏上试了很久（出错、重试）再切回面板，不能只剩一两分钟去面板上操作。
 */
export const SCAN_DEVICE_SWITCH_RENEW_WINDOW_MS = 10 * 60 * 1000
/** 回报页数的合理上限（进纸器 50 页；终端程序默认页数上限 20，可配）。超过视为回报有误。 */
export const SCAN_DEVICE_MAX_PAGE_COUNT = 200

/**
 * 状态转移表：key = 当前 deviceState，value = 允许收下的下一个 state。
 *
 * 对着任务包 §2.3 时序写：
 *   进纸器  ready → scanning →（每页 scanning 带页数）→ composing → delivering →（deliver 成功，后端转 completed）
 *   玻璃台  scanning → page_ready →（再扫一页）scanning …（扫完了）composing → delivering
 *   出错    ready / scanning / page_ready / composing / delivering → error（带 errorCode）
 *   重试    error → scanning（同一会话「放好再试」；页数从 0 重新数，见 planScanDeviceReport）
 *   中止    任何未结束状态 → aborted（终态；之后只能新建会话或改用面板扫描）
 * 同状态重复回报（网络重试）一律允许，只刷新续期与页数。除此之外的组合一律 409。
 *
 * 这张表只管「终端程序回报」。还有一条状态变化不经过它，也不进它：
 *   error → ready   只发生在用户在屏上点「改用玻璃台 / 改颜色」之后（POST /scan/sessions/:id/device-settings，
 *                   见 scan-device-sessions.service.ts 的 updateDeviceSettings），由云端在同一次条件更新里把
 *                   deviceState 写回 ready、清掉 deviceErrorCode、把 devicePageCount 归 0。
 * 终端程序不会也不许回报 error → ready（表里没有这一格，回报它一律 409 SCAN_DEVICE_TRANSITION_INVALID）。
 * 用户改完设置之后，终端程序下一次回报 scanning，走的是表里已有的 ready → scanning，不需要任何新转移。
 * 所以回报表保持原样不动；改设置只在 ready / error 两个状态允许（SCAN_DEVICE_SETTABLE_STATES），
 * 正在扫或已经收到页（scanning / page_ready / composing / delivering）时 409 SCAN_DEVICE_SETTINGS_LOCKED，
 * 要换设置先停下（改用面板或取消重来）。
 */
export const SCAN_DEVICE_STATE_TRANSITIONS: Readonly<Record<ScanDeviceState, readonly ScanDeviceState[]>> = {
  ready: ['ready', 'scanning', 'error', 'aborted'],
  scanning: ['scanning', 'page_ready', 'composing', 'error', 'aborted'],
  page_ready: ['page_ready', 'scanning', 'composing', 'error', 'aborted'],
  composing: ['composing', 'delivering', 'error', 'aborted'],
  delivering: ['delivering', 'error', 'aborted'],
  error: ['error', 'scanning', 'aborted'],
  aborted: ['aborted'],
}

/** 这些 state 说明至少已经收到一整页图（deliver 也要求 devicePageCount ≥ 1）。 */
const STATES_REQUIRING_PAGES: readonly ScanDeviceState[] = ['page_ready', 'composing', 'delivering']

/** deliver 只在这两个 state 下收 device 投递。 */
export const SCAN_DEVICE_DELIVERABLE_STATES: readonly ScanDeviceState[] = ['composing', 'delivering']

/**
 * 用户改扫描设置（来源 / 颜色）只在这两个 state 下允许：ready（还没开始）、error（出错了，放好纸再来）。
 * 其余（含 aborted）一律 SCAN_DEVICE_SETTINGS_LOCKED：正在扫、已经收到页、正在合成或投递时换设置，
 * 会让已经扫下来的页和新设置对不上。
 */
export const SCAN_DEVICE_SETTABLE_STATES: readonly ScanDeviceState[] = ['ready', 'error']

export function isScanDeviceState(value: unknown): value is ScanDeviceState {
  return typeof value === 'string' && (SCAN_DEVICE_STATES as readonly string[]).includes(value)
}

export function isScanDeviceErrorCode(value: unknown): value is ScanDeviceErrorCode {
  return typeof value === 'string' && (SCAN_DEVICE_ERROR_CODES as readonly string[]).includes(value)
}

export function canTransitionScanDeviceState(from: ScanDeviceState, to: ScanDeviceState): boolean {
  return SCAN_DEVICE_STATE_TRANSITIONS[from].includes(to)
}

/**
 * 终端程序回报被收下后，按收下的 state 选续期窗口：page_ready 10 分钟（用户要放下一页，补稿 cs-scan-more），
 * 其余 3 分钟。改用面板扫描、改扫描设置各自传 SCAN_DEVICE_SWITCH_RENEW_WINDOW_MS（10 分钟）。
 */
export function scanDeviceReportRenewWindowMs(state: ScanDeviceState): number {
  return state === 'page_ready' ? SCAN_DEVICE_PAGE_READY_RENEW_WINDOW_MS : SCAN_DEVICE_RENEW_WINDOW_MS
}

/**
 * 取消响应里的静默期结束时刻。与 assertTerminalQuietPeriod 同一条规则：
 * 从最近一条 cancelled / expired 的 updatedAt 起算 quietPeriodMs。
 * 静默期关着，或窗口内没有已结束的会话时，结束时刻就是 serverNow，一体机倒计时为 0。
 */
export function quietPeriodEndsAtIso(endedAt: Date | null, now: Date, quietPeriodMs: number): string {
  if (quietPeriodMs <= 0 || !endedAt) return now.toISOString()
  return new Date(endedAt.getTime() + quietPeriodMs).toISOString()
}

/**
 * 续期：min(max(expiresAt, now + 窗口), hardExpiresAt)。窗口缺省 3 分钟（终端程序每次回报，见 scanDeviceReportRenewWindowMs）；
 * 改用面板扫描、改扫描设置时传 SCAN_DEVICE_SWITCH_RENEW_WINDOW_MS（10 分钟）。
 * 只会把截止时间往后推、且永远不超过 hardExpiresAt；已经过了上限的会话不会被续命。
 */
export function renewScanDeviceExpiry(args: {
  expiresAt: Date
  hardExpiresAt: Date
  now: Date
  windowMs?: number
}): Date {
  const windowMs = args.windowMs ?? SCAN_DEVICE_RENEW_WINDOW_MS
  const wanted = Math.max(args.expiresAt.getTime(), args.now.getTime() + windowMs)
  return new Date(Math.min(wanted, args.hardExpiresAt.getTime()))
}

// ── 建会话参数 ────────────────────────────────────────────────────────────────

export type ScanStartParams =
  | { startMode: 'panel' }
  | { startMode: 'device'; source: ScanDeviceSource; colorMode: ScanDeviceColorMode }

function isAbsent(value: unknown): boolean {
  return value === undefined || value === null
}

function badStartParams(code: string, message: string): never {
  throw new BadRequestException({ error: { code, message } })
}

/**
 * 建会话的新字段怎么组合：
 *   - 不传 startMode（或 panel）→ 面板扫描；此时带 source / colorMode 一律 400（只在 device 时允许）；
 *   - startMode=device → source 与 colorMode 必填且取值合法；
 *   - device 不支持 retryOfScanTaskId（安全重扫那套授权是按面板投递的同字节内容设计的）。
 * 单个字段的取值范围在 DTO 里已用 @IsIn 校验；这里再校验一次是因为字段组合只能在这里判，
 * 且门禁和别的调用方可能绕过 ValidationPipe 直接调 service。
 */
export function resolveScanStartParams(input: {
  startMode?: unknown
  source?: unknown
  colorMode?: unknown
  retryOfScanTaskId?: unknown
}): ScanStartParams {
  const rawMode = isAbsent(input.startMode) ? 'panel' : input.startMode
  if (rawMode !== 'panel' && rawMode !== 'device') {
    badStartParams('SCAN_START_MODE_INVALID', 'startMode 只能是 panel 或 device')
  }
  if (rawMode === 'panel') {
    if (!isAbsent(input.source) || !isAbsent(input.colorMode)) {
      badStartParams('SCAN_START_PARAMS_INVALID', 'source / colorMode 只在 startMode=device 时允许')
    }
    return { startMode: 'panel' }
  }
  if (!(SCAN_DEVICE_SOURCES as readonly unknown[]).includes(input.source)) {
    badStartParams('SCAN_START_PARAMS_INVALID', 'startMode=device 时 source 必填（flatbed / feeder）')
  }
  if (!(SCAN_DEVICE_COLOR_MODES as readonly unknown[]).includes(input.colorMode)) {
    badStartParams('SCAN_START_PARAMS_INVALID', 'startMode=device 时 colorMode 必填（gray / color）')
  }
  if (!isAbsent(input.retryOfScanTaskId)) {
    badStartParams('SCAN_DEVICE_RETRY_UNSUPPORTED', '屏上扫描会话不支持安全重扫授权，请重新发起')
  }
  return {
    startMode: 'device',
    source: input.source as ScanDeviceSource,
    colorMode: input.colorMode as ScanDeviceColorMode,
  }
}

/** device 会话建档时额外写入的列。createdAt 显式给出，保证 hardExpiresAt = createdAt + 30 分钟分毫不差。 */
export function buildScanDeviceCreateData(
  params: Extract<ScanStartParams, { startMode: 'device' }>,
  createdAt: Date,
): {
  createdAt: Date
  startMode: 'device'
  deviceSource: ScanDeviceSource
  deviceColorMode: ScanDeviceColorMode
  deviceState: 'ready'
  devicePageCount: 0
  hardExpiresAt: Date
} {
  return {
    createdAt,
    startMode: 'device',
    deviceSource: params.source,
    deviceColorMode: params.colorMode,
    deviceState: 'ready',
    devicePageCount: 0,
    hardExpiresAt: new Date(createdAt.getTime() + SCAN_DEVICE_HARD_LIFETIME_MS),
  }
}

// ── 改扫描设置（来源 / 颜色）──────────────────────────────────────────────────

/** 用户在放纸与设置屏换来源 / 颜色：两个至少给一个，没给的保持原值。 */
export interface ScanDeviceSettingsInput {
  source?: ScanDeviceSource
  colorMode?: ScanDeviceColorMode
}

/**
 * 校验改设置的请求体：取值范围在 DTO 里已用 @IsIn 校验；这里再判一次，是因为「至少给一个」只能在这里判，
 * 且门禁和别的调用方可能绕过 ValidationPipe 直接调 service。null 与不传同样算没给。
 * 400 SCAN_DEVICE_SETTINGS_INVALID：两个都没给，或给了不认识的取值。先于任何数据库访问。
 */
export function resolveScanDeviceSettingsInput(input: { source?: unknown; colorMode?: unknown }): ScanDeviceSettingsInput {
  const hasSource = !isAbsent(input.source)
  const hasColorMode = !isAbsent(input.colorMode)
  if (!hasSource && !hasColorMode) {
    badSettings('请至少给出 source（flatbed / feeder）或 colorMode（gray / color）之一')
  }
  if (hasSource && !(SCAN_DEVICE_SOURCES as readonly unknown[]).includes(input.source)) {
    badSettings('source 只能是 flatbed 或 feeder')
  }
  if (hasColorMode && !(SCAN_DEVICE_COLOR_MODES as readonly unknown[]).includes(input.colorMode)) {
    badSettings('colorMode 只能是 gray 或 color')
  }
  return {
    ...(hasSource ? { source: input.source as ScanDeviceSource } : {}),
    ...(hasColorMode ? { colorMode: input.colorMode as ScanDeviceColorMode } : {}),
  }
}

function badSettings(message: string): never {
  throw new BadRequestException({ error: { code: 'SCAN_DEVICE_SETTINGS_INVALID', message } })
}

export function isScanDeviceSettingsEditableState(state: ScanDeviceState): boolean {
  return (SCAN_DEVICE_SETTABLE_STATES as readonly string[]).includes(state)
}

// ── 对外视图 ──────────────────────────────────────────────────────────────────

type DeviceFieldsRow = {
  startMode?: string | null
  scanType?: string | null
  deviceSource?: string | null
  deviceColorMode?: string | null
  deviceState?: string | null
  devicePageCount?: number | null
  deviceErrorCode?: string | null
  deviceUpdatedAt?: Date | null
}

export function isScanDeviceTask(task: Pick<DeviceFieldsRow, 'startMode'>): boolean {
  return task.startMode === 'device'
}

/** 「改用面板扫描」之后的会话：startMode 回到 panel，deviceState 留作 aborted。 */
export function isSwitchedToPanel(task: Pick<DeviceFieldsRow, 'startMode' | 'deviceState'>): boolean {
  return task.startMode === 'panel' && task.deviceState === 'aborted'
}

/**
 * GET /scan/sessions/:id 多返回的字段（B1 加前四项，B2 加来源 / 颜色 / deviceUpdatedAt，B4 加 deviceMaxPages）。
 * 面板任务（含已改用面板的）一律 startMode:'panel'、deviceMaxPages:null、其余 null / 0——哪怕库里还留着 device 时期的列值。
 * deviceSource / deviceColorMode 是用户当前选的来源与颜色（改设置之后读到的就是新值）；
 * deviceUpdatedAt 是最近一次状态变化（ISO 字符串）：终端程序回报，或用户改设置 / 改用面板。
 * deviceMaxPages 与租约 device.maxPages 同源（证件 4，其余 20）。一体机用它写「最多 N 页」。
 */
export function scanDeviceStatusFields(task: DeviceFieldsRow): {
  startMode: ScanStartMode
  deviceState: ScanDeviceState | null
  devicePageCount: number
  deviceErrorCode: ScanDeviceErrorCode | null
  deviceSource: ScanDeviceSource | null
  deviceColorMode: ScanDeviceColorMode | null
  deviceUpdatedAt: string | null
  deviceMaxPages: number | null
} {
  if (!isScanDeviceTask(task)) {
    return {
      startMode: 'panel',
      deviceState: null,
      devicePageCount: 0,
      deviceErrorCode: null,
      deviceSource: null,
      deviceColorMode: null,
      deviceUpdatedAt: null,
      deviceMaxPages: null,
    }
  }
  return {
    startMode: 'device',
    deviceState: isScanDeviceState(task.deviceState) ? task.deviceState : null,
    devicePageCount: typeof task.devicePageCount === 'number' ? task.devicePageCount : 0,
    deviceErrorCode: isScanDeviceErrorCode(task.deviceErrorCode) ? task.deviceErrorCode : null,
    deviceSource: (SCAN_DEVICE_SOURCES as readonly unknown[]).includes(task.deviceSource)
      ? (task.deviceSource as ScanDeviceSource)
      : null,
    deviceColorMode: (SCAN_DEVICE_COLOR_MODES as readonly unknown[]).includes(task.deviceColorMode)
      ? (task.deviceColorMode as ScanDeviceColorMode)
      : null,
    deviceUpdatedAt: task.deviceUpdatedAt instanceof Date ? task.deviceUpdatedAt.toISOString() : null,
    deviceMaxPages: scanDeviceLeaseLimits(task.scanType).maxPages,
  }
}

/**
 * current-lease 对 device 任务多带的字段。面板任务返回空对象——响应里不多出任何键，
 * 免得现有终端程序解析变化。
 *
 * device 段在 source / colorMode 之外还有 maxPages、maxBytes，按扫描类型从
 * scanDeviceLeaseLimits 取（证件 4 页 / 10 MiB，其余 20 页 / 18 MiB）。一体机不读租约。
 */
export function scanDeviceLeaseFields(task: DeviceFieldsRow & { scanType?: string | null }):
  | {
      startMode: 'device'
      device: { source: string | null; colorMode: string | null; maxPages: number; maxBytes: number }
    }
  | Record<string, never> {
  if (!isScanDeviceTask(task)) return {}
  const limits = scanDeviceLeaseLimits(task.scanType)
  return {
    startMode: 'device',
    device: {
      source: task.deviceSource ?? null,
      colorMode: task.deviceColorMode ?? null,
      maxPages: limits.maxPages,
      maxBytes: limits.maxBytes,
    },
  }
}

// ── 回报（device-report）校验与规划 ────────────────────────────────────────────

export interface ScanDeviceReportInput {
  state: ScanDeviceState
  pageCount?: number | null
  errorCode?: ScanDeviceErrorCode | null
  /**
   * 终端程序这一场实际在用的来源 / 颜色。不给（或缺省 null）= 旧终端程序，不比对、条件更新也不钉。
   * 给了且与库里的 deviceSource / deviceColorMode 不一致 → 409 SCAN_DEVICE_SETTINGS_CHANGED（必须停扫）。
   */
  source?: ScanDeviceSource | null
  colorMode?: ScanDeviceColorMode | null
}

/** 回报里带来源 / 颜色时，条件更新要钉住的列。没给的不钉，旧终端程序的 where 与以前一样。 */
export function scanDeviceReportSettingsPins(reported: {
  source?: ScanDeviceSource
  colorMode?: ScanDeviceColorMode
}): { deviceSource?: ScanDeviceSource; deviceColorMode?: ScanDeviceColorMode } {
  return {
    ...(reported.source !== undefined ? { deviceSource: reported.source } : {}),
    ...(reported.colorMode !== undefined ? { deviceColorMode: reported.colorMode } : {}),
  }
}

/**
 * 从回报体里取出终端程序声明的来源 / 颜色。null / undefined = 没给。
 * 给了空串或别的取值 → 400 SCAN_DEVICE_REPORT_INVALID，先于任何数据库访问。
 */
export function parseScanDeviceReportSettings(input: {
  source?: unknown
  colorMode?: unknown
}): { source?: ScanDeviceSource; colorMode?: ScanDeviceColorMode } {
  const sourceAbsent = input.source === undefined || input.source === null
  const colorAbsent = input.colorMode === undefined || input.colorMode === null
  if (!sourceAbsent && !(SCAN_DEVICE_SOURCES as readonly unknown[]).includes(input.source)) {
    badReport('source 只能是 flatbed 或 feeder')
  }
  if (!colorAbsent && !(SCAN_DEVICE_COLOR_MODES as readonly unknown[]).includes(input.colorMode)) {
    badReport('colorMode 只能是 gray 或 color')
  }
  return {
    ...(sourceAbsent ? {} : { source: input.source as ScanDeviceSource }),
    ...(colorAbsent ? {} : { colorMode: input.colorMode as ScanDeviceColorMode }),
  }
}

/** 给了来源或颜色、且与这一行不一致：必须停扫，不能把旧一场的回报写进新设置。 */
export function assertScanDeviceReportSettingsMatch(
  task: { deviceSource?: string | null; deviceColorMode?: string | null },
  reported: { source?: ScanDeviceSource; colorMode?: ScanDeviceColorMode },
): void {
  if (
    (reported.source !== undefined && reported.source !== task.deviceSource) ||
    (reported.colorMode !== undefined && reported.colorMode !== task.deviceColorMode)
  ) {
    conflict(
      'SCAN_DEVICE_SETTINGS_CHANGED',
      '扫描设置已更改，请停止屏上扫描，按新的来源和颜色重新开始',
    )
  }
}

export interface ScanDeviceReportPlan {
  deviceState: ScanDeviceState
  devicePageCount: number
  deviceErrorCode: ScanDeviceErrorCode | null
}

function badReport(message: string): never {
  throw new BadRequestException({ error: { code: 'SCAN_DEVICE_REPORT_INVALID', message } })
}

function conflict(code: string, message: string): never {
  throw new ConflictException({ error: { code, message } })
}

/**
 * 在当前行状态上规划一次回报。合法则给出要写的三列；不合法抛 Nest 异常：
 *   400 SCAN_DEVICE_REPORT_INVALID  回报内容自相矛盾（error 没带 errorCode、非 error 带了 errorCode、
 *                                    页数不是 0…200 的整数、ready 带了页数、page_ready / composing / delivering 一页都没有）
 *   409 SCAN_DEVICE_TRANSITION_INVALID   状态转移表里没有这一步
 *   409 SCAN_DEVICE_PAGE_COUNT_DECREASED 页数比库里已记的小（devicePageCount 只许不减）
 *
 * 页数规则：同一轮扫描内只许不减；缺省 = 不变。唯一例外是 error → scanning（同一会话「放好再试」）：
 * 那一轮已扫的页在出错时已被终端程序删除，新一轮从 0 页重新数。
 */
export function planScanDeviceReport(
  current: { deviceState: string | null; devicePageCount: number; scanType?: string | null },
  input: ScanDeviceReportInput,
): ScanDeviceReportPlan {
  const from: ScanDeviceState = isScanDeviceState(current.deviceState) ? current.deviceState : 'ready'
  const to = input.state
  if (!isScanDeviceState(to)) badReport('state 取值无效')

  const errorCode = input.errorCode ?? null
  if (to === 'error') {
    if (!isScanDeviceErrorCode(errorCode)) badReport('state=error 必须带有效的 errorCode')
  } else if (errorCode !== null) {
    badReport('errorCode 只能随 state=error 回报')
  }

  const requested = input.pageCount ?? null
  if (
    requested !== null &&
    (!Number.isInteger(requested) || requested < 0 || requested > SCAN_DEVICE_MAX_PAGE_COUNT)
  ) {
    badReport(`pageCount 必须是 0 到 ${SCAN_DEVICE_MAX_PAGE_COUNT} 的整数`)
  }

  if (!canTransitionScanDeviceState(from, to)) {
    conflict('SCAN_DEVICE_TRANSITION_INVALID', `屏上扫描状态不能从 ${from} 变为 ${to}`)
  }

  const newAttempt = from === 'error' && to === 'scanning'
  const baseline = newAttempt ? 0 : current.devicePageCount
  const nextCount = requested ?? baseline
  if (nextCount < baseline) {
    conflict('SCAN_DEVICE_PAGE_COUNT_DECREASED', `pageCount 不能从 ${baseline} 减少到 ${nextCount}`)
  }

  if (to === 'ready' && nextCount !== 0) badReport('state=ready 时还没有收到任何页，pageCount 只能是 0')
  if ((STATES_REQUIRING_PAGES as readonly string[]).includes(to) && nextCount < 1) {
    badReport(`state=${to} 至少要已收到 1 页`)
  }

  // 0…200 的整数检查在上面（格式不对是 400）。这里按扫描类型再拦一次：
  // 证件 4 页，其余 20 页。超过是业务上限，不是报文格式错误，所以 409。
  const maxPages = scanDeviceLeaseLimits(current.scanType).maxPages
  if (nextCount > maxPages) {
    conflict('SCAN_DEVICE_TOO_MANY_PAGES', scanDeviceTooManyPagesMessage(maxPages, nextCount))
  }

  return { deviceState: to, devicePageCount: nextCount, deviceErrorCode: to === 'error' ? errorCode : null }
}

// ── deliver 的来源校验 ────────────────────────────────────────────────────────

/**
 * 没带 origin（现有终端程序）一律按 watcher；带了但不是 watcher / device → 400。
 * multipart 字段重复出现会变成数组，同样不是合法取值。
 */
export function normalizeScanDeliverOrigin(raw: unknown): ScanDeliverOrigin {
  if (raw === undefined || raw === null || raw === '') return 'watcher'
  if (raw === 'watcher' || raw === 'device') return raw
  throw new BadRequestException({
    error: { code: 'SCAN_DELIVER_ORIGIN_INVALID', message: 'origin 只能是 watcher 或 device' },
  })
}

/**
 * 投递时把任务从 waiting 抢占成 matched 的那次条件更新（deliverScanFile 第 6 步）要钉住的扫描方式与设备状态。
 * assertScanDeliverOriginAllowed 是在读到的快照上判的；读与这次抢占之间，用户可能「改用面板」（startMode→panel、
 * deviceState→aborted），终端程序也可能回报 error / aborted。条件更新里没有这几条，已切面板 / 已中止的会话
 * 仍会被挂上设备扫描件。所以：
 *   - 所有任务都钉读到的 startMode（面板任务恒为 'panel'，是一条恒真条件，行为不变）；
 *   - device 任务再钉 deviceState ∈ composing / delivering 且 devicePageCount ≥ 1（与 assertScanDeliverOriginAllowed 同一组条件）；
 *   - device 任务再钉读到的 deviceUpdatedAt（B4 防 ABA，不加列）。出错重扫会把状态和页数重新走回 composing / delivering，
 *     只钉那两列时，上一轮还没抢占成功的旧投递会把旧 PDF 挂到新一轮。正常流程里 delivering 回报在投递之前，
 *     投递期间只有用户动作或新一轮回报会改 deviceUpdatedAt。没读到（一直是 null）就钉 null。
 * 面板任务不加后三条：面板路线行为一字不变。条件失效按现有写法回 409 SCAN_TASK_STATE_CHANGED。
 */
export function scanDeliverClaimPins(task: Pick<DeviceFieldsRow, 'startMode' | 'deviceUpdatedAt'>): {
  startMode: string
  deviceState?: { in: string[] }
  devicePageCount?: { gte: number }
  deviceUpdatedAt?: Date | null
} {
  const startMode = task.startMode ?? 'panel'
  if (!isScanDeviceTask(task)) return { startMode }
  return {
    startMode,
    deviceState: { in: [...SCAN_DEVICE_DELIVERABLE_STATES] },
    devicePageCount: { gte: 1 },
    deviceUpdatedAt: task.deviceUpdatedAt ?? null,
  }
}

export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-'
}

function isPdfMimeType(mimeType: string): boolean {
  return (mimeType ?? '').split(';')[0]!.trim().toLowerCase() === 'application/pdf'
}

/**
 * 屏上扫描投递凭据。只有 assertScanDeliverOriginAllowed 在 device 检查全部通过后签发。
 * 用模块内的 Symbol 做记号，请求体、DTO、控制器拼不出这个对象。
 * 面板投递不签发（返回 null）。
 */
const VERIFIED_DEVICE_SCAN_DELIVERY = Symbol('verified-device-scan-delivery')

export type VerifiedDeviceScanDelivery = {
  readonly kind: 'verified-device-scan-delivery'
  readonly [VERIFIED_DEVICE_SCAN_DELIVERY]: true
}

export function isVerifiedDeviceScanDelivery(value: unknown): value is VerifiedDeviceScanDelivery {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [VERIFIED_DEVICE_SCAN_DELIVERY]?: unknown })[VERIFIED_DEVICE_SCAN_DELIVERY] === true
  )
}

function issueVerifiedDeviceScanDelivery(): VerifiedDeviceScanDelivery {
  return Object.freeze({
    kind: 'verified-device-scan-delivery' as const,
    [VERIFIED_DEVICE_SCAN_DELIVERY]: true as const,
  })
}

/**
 * 投递来源必须与会话一致：
 *   - device 会话只收 origin=device，且回报状态在 composing / delivering、已收到 ≥ 1 页、文件是 PDF；
 *   - panel 会话（含已「改用面板扫描」的）只收 watcher。
 * 来源错配、状态不对 → 409；device 投递的不是 PDF → 400。
 *
 * device 检查全部通过时返回凭据，供文件服务放行证件 PDF。面板检查通过返回 null。
 * 凭据不能由调用方自己造：没有布尔参数。
 */
export function assertScanDeliverOriginAllowed(
  task: DeviceFieldsRow,
  origin: ScanDeliverOrigin,
  file: { buffer: Buffer; mimeType: string },
): VerifiedDeviceScanDelivery | null {
  if (!isScanDeviceTask(task)) {
    if (origin !== 'watcher') {
      conflict('SCAN_DELIVER_ORIGIN_MISMATCH', '该扫描会话是面板扫描，只接收面板投递')
    }
    return null
  }
  if (origin !== 'device') {
    conflict('SCAN_DELIVER_ORIGIN_MISMATCH', '该扫描会话是屏上扫描，只接收终端程序自己扫描的投递')
  }
  if (
    !isScanDeviceState(task.deviceState) ||
    !(SCAN_DEVICE_DELIVERABLE_STATES as readonly string[]).includes(task.deviceState)
  ) {
    conflict('SCAN_DEVICE_STATE_NOT_DELIVERABLE', '屏上扫描还没有整理好文件，暂不能投递')
  }
  if (typeof task.devicePageCount !== 'number' || task.devicePageCount < 1) {
    conflict('SCAN_DEVICE_STATE_NOT_DELIVERABLE', '屏上扫描一页都还没收到，不能投递')
  }
  if (!isPdfMimeType(file.mimeType) || !looksLikePdf(file.buffer)) {
    throw new BadRequestException({
      error: { code: 'SCAN_DEVICE_FILE_NOT_PDF', message: '屏上扫描只接收 PDF' },
    })
  }
  return issueVerifiedDeviceScanDelivery()
}
