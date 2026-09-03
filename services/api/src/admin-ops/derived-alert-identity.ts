/**
 * 派生告警的稳定身份。
 *
 * 告警没有 Alert 行，每次 GET 都是现算。不能把「确认」挂在列表里的临时 id 上，
 * 也不能把时间 / 心跳 id / 离线分钟数编进主键——那些在同一条故障持续期间会变。
 *
 * 现有 listDerivedAlerts 已经在用 `${type}:${entityId}` 当前端 key。
 * 那一组键其实是稳定的（Terminal.id / PrintTask.id 不会因重算而变）。
 * 本模块把它升级成唯一挂载点，并额外用 episodeToken 区分「恢复后又发生」。
 *
 * 为什么新建 AlertDisposition 而不是给 Terminal / PrintTask 加字段：
 *   1. 一台终端有两类告警（离线 vs 打印机异常），确认态不能挤在同一列。
 *   2. 静默 TTL、episode、操作者属于运营处理，不是设备或打印任务域。
 *   3. 退款消警必须读 Order.payStatus；禁止为了让红条消失去写 printOutcome。
 */

export const ALERT_TYPES = ['terminal_offline', 'printer_issue', 'print_failed'] as const
export type DerivedAlertType = (typeof ALERT_TYPES)[number]

export const ALERT_ACTIONS = ['acknowledge', 'silence', 'close', 'reopen'] as const
export type AlertActionInput = (typeof ALERT_ACTIONS)[number]
export type AlertDispositionAction = 'acknowledged' | 'silenced' | 'closed' | 'reopened'

export const ALERT_LIST_VIEWS = ['open', 'acknowledged', 'suppressed', 'all'] as const
export type AlertListView = (typeof ALERT_LIST_VIEWS)[number]

export const SILENCE_DURATIONS = {
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
} as const
export type SilenceDuration = keyof typeof SILENCE_DURATIONS

export type AlertHandlingState = 'open' | 'acknowledged' | 'silenced' | 'closed'

export function buildSubjectKey(type: DerivedAlertType, subjectId: string): string {
  return `${type}:${subjectId}`
}

export function parseSubjectKey(raw: string): { type: DerivedAlertType; subjectId: string } | null {
  const idx = raw.indexOf(':')
  if (idx <= 0) return null
  const type = raw.slice(0, idx)
  const subjectId = raw.slice(idx + 1).trim()
  if (!isAlertType(type) || subjectId.length === 0) return null
  return { type, subjectId }
}

export function isAlertType(value: string): value is DerivedAlertType {
  return (ALERT_TYPES as readonly string[]).includes(value)
}

export function parseAlertListView(raw: string | undefined): AlertListView | null {
  if (raw === undefined || raw === '') return 'open'
  if ((ALERT_LIST_VIEWS as readonly string[]).includes(raw)) return raw as AlertListView
  return null
}

export function parseAlertAction(raw: unknown): AlertActionInput | null {
  return typeof raw === 'string' && (ALERT_ACTIONS as readonly string[]).includes(raw)
    ? (raw as AlertActionInput)
    : null
}

export function parseSilenceDuration(raw: unknown): SilenceDuration | null {
  return typeof raw === 'string' && raw in SILENCE_DURATIONS ? (raw as SilenceDuration) : null
}

export function storedAction(action: AlertActionInput): AlertDispositionAction {
  if (action === 'acknowledge') return 'acknowledged'
  if (action === 'silence') return 'silenced'
  if (action === 'reopen') return 'reopened'
  return 'closed'
}

export function auditActionFor(
  action: AlertActionInput,
): 'alert.acknowledge' | 'alert.silence' | 'alert.close' | 'alert.reopen' {
  if (action === 'acknowledge') return 'alert.acknowledge'
  if (action === 'silence') return 'alert.silence'
  if (action === 'reopen') return 'alert.reopen'
  return 'alert.close'
}

/** 持续离线期间 lastSeen 不变；恢复后再离线会换新时间，旧确认失效。 */
export function offlineEpisodeToken(lastSeen: Date): string {
  return lastSeen.toISOString()
}

/**
 * 不能用「最新心跳时间」：在线但缺纸时心跳一直刷新，确认会被下一跳心跳打掉。
 * 用 printerStatus + 最近一次健康心跳时间：持续异常期间稳定，恢复后再异常会换新键。
 */
export function printerIssueEpisodeToken(printerStatus: string, lastHealthyAt: Date): string {
  return `${printerStatus}:${lastHealthyAt.toISOString()}`
}

/** 失败任务是一次性事件，episode 就是任务 id。新失败是新任务、新 subjectKey。 */
export function printFailedEpisodeToken(taskId: string): string {
  return taskId
}

/**
 * 处置态解析。默认值是 open——凡是拿不准的一律回到待处理,宁可让操作员多看一眼,
 * 不能让一条仍在发生的告警悄悄从默认视图消失。
 *
 * recoveredAt 只作为历史兼容读:旧版本会在「本次查询没看见」时给它写值,
 * 那是错误推断。现在没有任何读路径再写它;残留的旧值被当成「处置已失效」处理,
 * 也就是回到 open,方向仍然是安全的那一侧。
 */
export function resolveHandlingState(
  row: {
    action: string
    episodeToken: string
    recoveredAt: Date | null
    silencedUntil: Date | null
  } | null,
  currentEpisode: string,
  now: Date,
): AlertHandlingState {
  if (!row || row.recoveredAt || row.episodeToken !== currentEpisode) return 'open'
  if (row.action === 'silenced') {
    if (row.silencedUntil && row.silencedUntil.getTime() > now.getTime()) return 'silenced'
    return 'open'
  }
  if (row.action === 'acknowledged') return 'acknowledged'
  if (row.action === 'closed') return 'closed'
  // reopened:操作员显式撤回了处置,本轮故障重新回到待处理。
  if (row.action === 'reopened') return 'open'
  return 'open'
}

export function matchesView(handling: AlertHandlingState, view: AlertListView): boolean {
  if (view === 'all') return true
  if (view === 'open') return handling === 'open'
  if (view === 'acknowledged') return handling === 'acknowledged'
  return handling === 'silenced' || handling === 'closed'
}
