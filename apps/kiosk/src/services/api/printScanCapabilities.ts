// 终端能力开关下发（Task 10）：GET /terminals/:terminalId/capabilities（匿名只读）。
//
// 语义：只把「管理员配置过（configured=true）」的能力键返回给页面做覆盖；
// 未配置的键由页面保持各自的保守硬编码默认。请求失败 / mock 模式 / 未配置
// terminalId 时：getConfiguredCapabilities 仍返回空覆盖集（兼容服务中心旧行为）；
// ScanStart 等深链门禁应使用 loadConfiguredCapabilities，把失败与「未配置」区分开。
import type {
  PrintScanCapabilityKey,
  PrintScanCapabilityStatus,
  TerminalCapabilityView,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'
import { getTerminalId } from './screensaver'

export interface ConfiguredCapability {
  status: PrintScanCapabilityStatus
  note: string | null
}

export type ConfiguredCapabilityMap = Partial<Record<PrintScanCapabilityKey, ConfiguredCapability>>

export type CapabilitiesLoadResult =
  | { status: 'ok'; map: ConfiguredCapabilityMap }
  | { status: 'skipped'; map: ConfiguredCapabilityMap }
  | { status: 'error'; map: ConfiguredCapabilityMap }

const CAPABILITY_TIMEOUT_MS = 4_000

function emptyMap(): ConfiguredCapabilityMap {
  return {}
}

function toMap(capabilities: TerminalCapabilityView[] | undefined): ConfiguredCapabilityMap {
  const map: ConfiguredCapabilityMap = {}
  for (const cap of capabilities ?? []) {
    if (cap.configured) map[cap.capabilityKey] = { status: cap.status, note: cap.note }
  }
  return map
}

/** 深链门禁用：区分拉取成功 / 跳过 / 失败，避免把失败当成「未配置可放行」。 */
export async function loadConfiguredCapabilities(): Promise<CapabilitiesLoadResult> {
  if (API_MODE !== 'http') return { status: 'skipped', map: emptyMap() }
  const terminalId = getTerminalId()
  if (!terminalId) return { status: 'error', map: emptyMap() }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), CAPABILITY_TIMEOUT_MS)
  try {
    const res = await fetch(
      `${API_BASE_URL}/terminals/${encodeURIComponent(terminalId)}/capabilities`,
      {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }
    )
    if (!res.ok) return { status: 'error', map: emptyMap() }
    const body = (await res.json()) as { capabilities?: TerminalCapabilityView[] }
    return { status: 'ok', map: toMap(body.capabilities) }
  } catch {
    return { status: 'error', map: emptyMap() }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

/** 服务中心覆盖用：失败时回落空 map，不放大可用性。 */
export async function getConfiguredCapabilities(): Promise<ConfiguredCapabilityMap> {
  const result = await loadConfiguredCapabilities()
  return result.map
}
