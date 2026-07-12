// 终端能力开关下发（Task 10）：GET /terminals/:terminalId/capabilities（匿名只读）。
//
// 语义：只把「管理员配置过（configured=true）」的能力键返回给页面做覆盖；
// 未配置的键由页面保持各自的保守硬编码默认。请求失败 / mock 模式 / 未配置
// terminalId 时返回空覆盖集——回落到硬编码默认，不放大可用性（默认里未上线
// 能力本就是 available=false）。
import type { PrintScanCapabilityKey, PrintScanCapabilityStatus, TerminalCapabilityView } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'

export interface ConfiguredCapability {
  status: PrintScanCapabilityStatus
  note: string | null
}

export type ConfiguredCapabilityMap = Partial<Record<PrintScanCapabilityKey, ConfiguredCapability>>

export async function getConfiguredCapabilities(): Promise<ConfiguredCapabilityMap> {
  if (API_MODE !== 'http') return {}
  const terminalId = (import.meta.env['VITE_TERMINAL_ID'] ?? '').trim()
  if (!terminalId) return {}

  try {
    const res = await fetch(`${API_BASE_URL}/terminals/${encodeURIComponent(terminalId)}/capabilities`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return {}
    const body = (await res.json()) as { capabilities?: TerminalCapabilityView[] }
    const map: ConfiguredCapabilityMap = {}
    for (const cap of body.capabilities ?? []) {
      if (cap.configured) map[cap.capabilityKey] = { status: cap.status, note: cap.note }
    }
    return map
  } catch {
    return {}
  }
}
