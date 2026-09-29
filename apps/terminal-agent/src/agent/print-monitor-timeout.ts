/**
 * 出纸监控窗口。
 *
 * 唤醒预热 60 秒 + 面数 × 每面秒数。面数 = 计费页数 × 份数。
 * 每面秒数取任务参数里最慢的一档：单面黑白 3 秒、彩色 4 秒、双面 6 秒
 * （彩色且双面仍取 6 秒）。6 秒是保守值，发布当天按 R 段实测后回填。
 * 封顶 15 分钟。Agent 不因面数拒单，100 面只用来核对最坏情况仍落在封顶内。
 */

export const PRINT_MAX_SIDES_PER_ORDER = 100
/**
 * 须与服务端报价 / 建单上限相等。服务端常量由后端窗口的 PR 定义，
 * 并由该 PR 加跨端一致性断言。本常量只参与最坏情况校验，不拦单。
 */
export const PRINT_MONITOR_CAP_MS = 15 * 60_000
export const PRINT_MONITOR_WARMUP_MS = 60_000

const SIMPLEX_BW_SIDE_MS = 3_000
const COLOR_SIDE_MS = 4_000
const DUPLEX_SIDE_MS = 6_000

export interface MonitorTimeoutParams {
  colorMode?: string
  duplex?: string
}

function positiveCount(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : 1
}

function millisecondsPerSide(params: MonitorTimeoutParams | undefined): number {
  if (params?.duplex === 'duplex_long_edge' || params?.duplex === 'duplex_short_edge') return DUPLEX_SIDE_MS
  if (params?.colorMode === 'color') return COLOR_SIDE_MS
  return SIMPLEX_BW_SIDE_MS
}

export function computeMonitorTimeoutMs(
  billablePages: number | undefined,
  copies: number | undefined,
  params?: MonitorTimeoutParams,
): number {
  const sides = positiveCount(billablePages) * positiveCount(copies)
  return Math.min(PRINT_MONITOR_CAP_MS, PRINT_MONITOR_WARMUP_MS + sides * millisecondsPerSide(params))
}

/** 100 面双面彩色按保守速度。Agent 不拒绝超过此面数的任务。 */
export function worstCaseDuplexColorTimeoutMs(): number {
  return computeMonitorTimeoutMs(PRINT_MAX_SIDES_PER_ORDER, 1, {
    colorMode: 'color',
    duplex: 'duplex_long_edge',
  })
}
