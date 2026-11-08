/**
 * agent/scan-device/scan-device-sync.ts — 屏上扫描回报要补的中间状态
 *
 * 与后端 SCAN_DEVICE_STATE_TRANSITIONS 一致。网络把某一拍回报重试尽了之后，
 * 后端还停在上一拍，下一拍不能跳着发。这里只算出要补的状态，不发请求。
 */

import type { ScanDeviceReportState } from './scan-device-backend'

/** 与 services 侧 scan-device-protocol 的转移表保持一致。同状态重发由调用方自己发。 */
const TRANSITIONS: Readonly<Record<ScanDeviceReportState, readonly ScanDeviceReportState[]>> = {
  ready: ['ready', 'scanning', 'error', 'aborted'],
  scanning: ['scanning', 'page_ready', 'composing', 'error', 'aborted'],
  page_ready: ['page_ready', 'scanning', 'composing', 'error', 'aborted'],
  composing: ['composing', 'delivering', 'error', 'aborted'],
  delivering: ['delivering', 'error', 'aborted'],
  error: ['error', 'scanning', 'aborted'],
  aborted: ['aborted'],
}

const NOT_A_BRIDGE: ReadonlySet<ScanDeviceReportState> = new Set(['error', 'aborted'])

/**
 * 从 `from` 到 `to` 要先补发的状态，不含这两头。
 * 已经能直接转移时返回空数组。图上走不到时返回 undefined（调用方应停扫删页，不要硬投递）。
 * 不借 error / aborted 当跳板。
 */
export function scanDeviceReportBridge(
  from: ScanDeviceReportState,
  to: ScanDeviceReportState,
): ScanDeviceReportState[] | undefined {
  if (from === to || TRANSITIONS[from].includes(to)) return []
  const queue: ScanDeviceReportState[][] = [[from]]
  const seen = new Set<ScanDeviceReportState>([from])
  while (queue.length > 0) {
    const path = queue.shift()
    if (!path) break
    const tip = path[path.length - 1]
    if (!tip) break
    for (const next of TRANSITIONS[tip]) {
      if (seen.has(next)) continue
      if (next !== to && NOT_A_BRIDGE.has(next)) continue
      seen.add(next)
      const longer = [...path, next]
      if (next === to) return longer.slice(1, -1)
      queue.push(longer)
    }
  }
  return undefined
}
