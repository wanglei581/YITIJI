import type { ScreenMetric, ScreenAudience, ScreenFleetHealth, SCREEN_ONLINE_WINDOW_SECONDS } from './console-screen.types'

export type ScreenTimelineState = 'idle' | 'printing' | 'alert' | 'offline' | 'unknown'

export interface ScreenTerminalTwin {
  generatedAt: string
  audience: ScreenAudience
  terminal: {
    id: string
    code: string
    displayName: string | null
    areaLabel: string | null
    locationLabel: string | null
    geo: { lat: number; lng: number } | null
  }
  status: {
    health: ScreenFleetHealth
    lastHeartbeatAt: string | null
    onlineWindowSeconds: typeof SCREEN_ONLINE_WINDOW_SECONDS
    agentVersion: string | null
    wiredNetwork: string | null
  }
  printer: ScreenMetric<{
    name: string | null
    state: 'ready' | 'printing' | 'error' | 'offline' | 'unknown'
    errorLabel: string | null
    colorEnabled: boolean
    duplexEnabled: boolean
  }>
  scanner: ScreenMetric<{ state: 'ready' | 'busy' | 'error' | 'unknown'; label: string | null }>
  currentTask: ScreenMetric<{ pages: number; colorMode: 'bw' | 'color' | null; startedAt: string | null } | null>
  today: {
    // 0 保留；1–4 为 null；≥5 原样。管理员与机构同一口径。
    // printPages 只计已出纸：计费页 × 份数，按 PrintTask.completedAt 落入上海自然日（与北京时间同一东八区）。
    printPages: number | null
    printTasks: number | null
    scans: number | null
    failed: number | null
    visits: ScreenMetric<number>
  }
  consumables: ScreenMetric<{ paper: string | null; toner: string | null }>
  /** 近 24 小时打印段样本不足，已撤掉逐单覆盖。 */
  timelinePrintingSuppressed: boolean
  /** 分钟精度；达到阈值的短打印可为 from===to 的位置标记，不虚增持续时间。 */
  timeline24h: ScreenMetric<Array<{ from: string; to: string; state: ScreenTimelineState }>>
}

