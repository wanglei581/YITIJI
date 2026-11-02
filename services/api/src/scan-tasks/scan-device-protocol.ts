import { BadRequestException, ConflictException } from '@nestjs/common'

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
/** 每次收下终端程序回报，把 expiresAt 至少续到「现在 + 3 分钟」（不超过上限）。 */
export const SCAN_DEVICE_RENEW_WINDOW_MS = 3 * 60 * 1000
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
 * 续期：min(max(expiresAt, now + 3 分钟), hardExpiresAt)。
 * 只会把截止时间往后推、且永远不超过 hardExpiresAt；已经过了上限的会话不会被续命。
 */
export function renewScanDeviceExpiry(args: { expiresAt: Date; hardExpiresAt: Date; now: Date }): Date {
  const wanted = Math.max(args.expiresAt.getTime(), args.now.getTime() + SCAN_DEVICE_RENEW_WINDOW_MS)
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

// ── 对外视图 ──────────────────────────────────────────────────────────────────

type DeviceFieldsRow = {
  startMode?: string | null
  deviceSource?: string | null
  deviceColorMode?: string | null
  deviceState?: string | null
  devicePageCount?: number | null
  deviceErrorCode?: string | null
}

export function isScanDeviceTask(task: Pick<DeviceFieldsRow, 'startMode'>): boolean {
  return task.startMode === 'device'
}

/** 「改用面板扫描」之后的会话：startMode 回到 panel，deviceState 留作 aborted。 */
export function isSwitchedToPanel(task: Pick<DeviceFieldsRow, 'startMode' | 'deviceState'>): boolean {
  return task.startMode === 'panel' && task.deviceState === 'aborted'
}

/**
 * GET /scan/sessions/:id 多返回的四项。面板任务（含已改用面板的）一律 startMode:'panel'、其余 null / 0。
 */
export function scanDeviceStatusFields(task: DeviceFieldsRow): {
  startMode: ScanStartMode
  deviceState: ScanDeviceState | null
  devicePageCount: number
  deviceErrorCode: ScanDeviceErrorCode | null
} {
  if (!isScanDeviceTask(task)) {
    return { startMode: 'panel', deviceState: null, devicePageCount: 0, deviceErrorCode: null }
  }
  return {
    startMode: 'device',
    deviceState: isScanDeviceState(task.deviceState) ? task.deviceState : null,
    devicePageCount: typeof task.devicePageCount === 'number' ? task.devicePageCount : 0,
    deviceErrorCode: isScanDeviceErrorCode(task.deviceErrorCode) ? task.deviceErrorCode : null,
  }
}

/**
 * current-lease 对 device 任务多带的字段。面板任务返回空对象——响应里不多出任何键，
 * 免得现有终端程序解析变化。
 */
export function scanDeviceLeaseFields(task: DeviceFieldsRow):
  | { startMode: 'device'; device: { source: string | null; colorMode: string | null } }
  | Record<string, never> {
  if (!isScanDeviceTask(task)) return {}
  return {
    startMode: 'device',
    device: { source: task.deviceSource ?? null, colorMode: task.deviceColorMode ?? null },
  }
}

// ── 回报（device-report）校验与规划 ────────────────────────────────────────────

export interface ScanDeviceReportInput {
  state: ScanDeviceState
  pageCount?: number | null
  errorCode?: ScanDeviceErrorCode | null
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
  current: { deviceState: string | null; devicePageCount: number },
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

export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-'
}

function isPdfMimeType(mimeType: string): boolean {
  return (mimeType ?? '').split(';')[0]!.trim().toLowerCase() === 'application/pdf'
}

/**
 * 投递来源必须与会话一致：
 *   - device 会话只收 origin=device，且回报状态在 composing / delivering、已收到 ≥ 1 页、文件是 PDF；
 *   - panel 会话（含已「改用面板扫描」的）只收 watcher。
 * 来源错配、状态不对 → 409；device 投递的不是 PDF → 400。
 */
export function assertScanDeliverOriginAllowed(
  task: DeviceFieldsRow,
  origin: ScanDeliverOrigin,
  file: { buffer: Buffer; mimeType: string },
): void {
  if (!isScanDeviceTask(task)) {
    if (origin !== 'watcher') {
      conflict('SCAN_DELIVER_ORIGIN_MISMATCH', '该扫描会话是面板扫描，只接收面板投递')
    }
    return
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
}
