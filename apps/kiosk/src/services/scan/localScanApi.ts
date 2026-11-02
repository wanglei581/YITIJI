// 本机扫描仪探测。只打终端程序的 127.0.0.1，不把云端令牌带过去。
// K1b-1 只用 probe。开始扫描、翻页、结束、中止留到后续批次，这里不导出用不到的函数。

const configuredLocalAgentBaseUrl = (import.meta.env['VITE_TERMINAL_AGENT_LOCAL_URL'] ?? '').trim()
const LOCAL_AGENT_BASE_URL = configuredLocalAgentBaseUrl || 'http://127.0.0.1:9527'
const BRIDGE_TOKEN = (import.meta.env['VITE_TERMINAL_AGENT_BRIDGE_TOKEN'] ?? '').trim()
const PROBE_TIMEOUT_MS = 8_000

/** 与终端程序当场探测的健康态一致。不认识的值一律当成 unknown。 */
export const LOCAL_SCAN_HEALTHS = ['ready', 'busy', 'not_found', 'error', 'unknown'] as const
export type LocalScanHealth = (typeof LOCAL_SCAN_HEALTHS)[number]

export type LocalScanProbeFailure = 'unreachable' | 'unknown'

export type LocalScanProbeResult =
  | { ok: true; health: LocalScanHealth }
  | { ok: false; failure: LocalScanProbeFailure }

function isHealth(value: unknown): value is LocalScanHealth {
  return typeof value === 'string' && (LOCAL_SCAN_HEALTHS as readonly string[]).includes(value)
}

/**
 * GET /local/scan/probe。
 * 没有桥接令牌、网络失败、超时：unreachable（本机程序连不上）。
 * HTTP 错误、信封对不上、健康态不认识：unknown（状态未知）。这两种都不是就绪。
 */
export async function probeLocalScanner(signal?: AbortSignal): Promise<LocalScanProbeResult> {
  if (!BRIDGE_TOKEN) return { ok: false, failure: 'unreachable' }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const response = await fetch(`${LOCAL_AGENT_BASE_URL}/local/scan/probe`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'X-Local-Bridge-Token': BRIDGE_TOKEN,
      },
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false, failure: 'unknown' }
    const body = (await response.json()) as { success?: unknown; data?: { state?: unknown } }
    if (body.success !== true || !isHealth(body.data?.state)) return { ok: false, failure: 'unknown' }
    return { ok: true, health: body.data.state }
  } catch {
    return { ok: false, failure: 'unreachable' }
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}
