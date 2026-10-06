import { TERMINAL_ONLINE_WINDOW_MS } from '../terminals/printer-availability'

export { TERMINAL_ONLINE_WINDOW_MS }

/**
 * 终端是否在线。
 *
 * 口径与 terminals-admin.service.ts listTerminalsForAdmin 第 328 行相同，
 * 窗口用 printer-availability.ts 的 TERMINAL_ONLINE_WINDOW_MS（5 分钟）：
 *
 *   hbAt = 最新一条 TerminalHeartbeat.createdAt，没有则为 null
 *   effective = 列 lastHeartbeatAt 存在且比 hbAt 更新 ? 列 : hbAt
 *   在线 = effective 有值，且 now - effective < TERMINAL_ONLINE_WINDOW_MS
 *
 * 有心跳时 lastSeen 就是 effective，registeredAt 不参与。比较是严格小于。
 * 不用 lastSeenAt：那一列是 @updatedAt，改名称、改点位也会刷新。
 */
export function terminalHeartbeatOnline(
  columnLastHeartbeatAt: Date | null,
  latestHeartbeatCreatedAt: Date | null,
  nowMs: number,
): boolean {
  const hbAt = latestHeartbeatCreatedAt
  const effective =
    columnLastHeartbeatAt && (!hbAt || columnLastHeartbeatAt > hbAt)
      ? columnLastHeartbeatAt
      : hbAt
  if (!effective) return false
  return nowMs - effective.getTime() < TERMINAL_ONLINE_WINDOW_MS
}
