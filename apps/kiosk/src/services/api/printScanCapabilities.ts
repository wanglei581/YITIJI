// 终端能力开关下发（Task 10）：GET /terminals/:terminalId/capabilities（匿名只读）。
//
// 语义：只把「管理员配置过（configured=true）」的能力键返回给页面做覆盖；
// 未配置的键由页面保持各自的保守硬编码默认。请求失败 / mock 模式 / 未配置
// terminalId 时：getConfiguredCapabilities 仍返回空覆盖集（兼容服务中心旧行为）；
// ScanStart 等深链门禁应使用 loadConfiguredCapabilities，把失败与「未配置」区分开。
// 例外：DEFAULT_DENY_CAPABILITY_KEYS 里的键未配置不能当放行，见 resolveCapabilityOverride。
import {
  DEFAULT_DENY_CAPABILITY_KEYS,
  type PrintScanCapabilityKey,
  type PrintScanCapabilityStatus,
  type TerminalCapabilityView,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'
import { getTerminalId } from './screensaver'

export interface ConfiguredCapability {
  status: PrintScanCapabilityStatus
  note: string | null
}

export type ConfiguredCapabilityMap = Partial<Record<PrintScanCapabilityKey, ConfiguredCapability>>

/**
 * 管理员没写说明时，一体机按能力状态给用户看的固定话。
 * 打印扫描首页卡片和 U 盘入口共用这一份，避免各写各的。
 */
export const CAPABILITY_STATUS_NOTES: Record<PrintScanCapabilityStatus, string | null> = {
  available: null,
  testing: '测试中，暂未对用户开放',
  maintenance: '维护中，暂时不可用',
  unsupported: '本机不支持此项服务',
  not_verified: '本机暂未开通',
}

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

/**
 * 页面要按哪条能力配置处理某个键：管理员配置过的行照用；否则返回 undefined，
 * 由页面按各自的默认处理 —— 只有一种例外。
 *
 * 例外（2026-09-28 D3）：DEFAULT_DENY_CAPABILITY_KEYS 里的键（签名等）服务端
 * 「未配置即拒绝」（TerminalCapabilitiesService.assertUserTaskAllowed），没有可兼容的
 * 既有闭环。所以拉取成功（status='ok'）而这个键没有已配置的行时，按「本机暂未开通」
 * （not_verified）处理，与管理员显式配成 not_verified 效果一致；否则用户能进页面、
 * 传完文件才被服务端拒绝。
 *
 * skipped（非 http 的演示 / mock 模式）与 error、loading 不在这里改口径，
 * 仍由调用方按原有规则处理；其余键「未配置」的含义也不变。
 */
export function resolveCapabilityOverride(
  load: { readonly status: CapabilitiesLoadResult['status'] | 'loading'; readonly map: ConfiguredCapabilityMap },
  key: PrintScanCapabilityKey,
): ConfiguredCapability | undefined {
  const configured = load.map[key]
  if (configured) return configured
  if (load.status === 'ok' && DEFAULT_DENY_CAPABILITY_KEYS.includes(key)) {
    return { status: 'not_verified', note: null }
  }
  return undefined
}
