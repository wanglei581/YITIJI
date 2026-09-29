/**
 * 出纸监控窗口。
 *
 * 唤醒预热 90 秒 + 面数 × 每面秒数。面数 = 计费页数 × 份数。
 * 每面秒数：单面黑白 3 秒、彩色单面 4 秒、黑白双面 6 秒、彩色且双面 8 秒。
 * colorMode / duplex 先去掉首尾空白再按小写比较。缺省或空白仍按单面黑白。
 * 写了但认不出的取值按最慢档（8 秒）算，不按最快档。
 * 封顶 15 分钟。100 面彩色双面最坏 90 + 100×8 = 890 秒，仍落在封顶内。
 * Agent 不因面数拒单。服务端 printing 未确认时限仍是 20 分钟。
 */

export const PRINT_MAX_SIDES_PER_ORDER = 100
/**
 * 须与服务端报价 / 建单上限相等。服务端常量由后端窗口的 PR 定义，
 * 并由该 PR 加跨端一致性断言。本常量只参与最坏情况校验，不拦单。
 */
export const PRINT_MONITOR_CAP_MS = 15 * 60_000
export const PRINT_MONITOR_WARMUP_MS = 90_000

const SIMPLEX_BW_SIDE_MS = 3_000
const COLOR_SIDE_MS = 4_000
const DUPLEX_SIDE_MS = 6_000
const COLOR_DUPLEX_SIDE_MS = 8_000

export interface MonitorTimeoutParams {
  colorMode?: string
  duplex?: string
}

function positiveCount(value: number | undefined): number {
  return Number.isFinite(value) && (value as number) > 0 ? Math.floor(value as number) : 1
}

function normalizeToken(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function millisecondsPerSide(params: MonitorTimeoutParams | undefined): number {
  const color = normalizeToken(params?.colorMode)
  const duplex = normalizeToken(params?.duplex)
  const colorKnown = color === '' || color === 'black_white' || color === 'color'
  const duplexKnown = duplex === '' || duplex === 'simplex' || duplex === 'duplex_long_edge' || duplex === 'duplex_short_edge'
  if (!colorKnown || !duplexKnown) return COLOR_DUPLEX_SIDE_MS
  const isDuplex = duplex === 'duplex_long_edge' || duplex === 'duplex_short_edge'
  const isColor = color === 'color'
  if (isColor && isDuplex) return COLOR_DUPLEX_SIDE_MS
  if (isDuplex) return DUPLEX_SIDE_MS
  if (isColor) return COLOR_SIDE_MS
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
