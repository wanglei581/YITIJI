const configuredLocalAgentBaseUrl = (import.meta.env['VITE_TERMINAL_AGENT_LOCAL_URL'] ?? '').trim()
const LOCAL_AGENT_BASE_URL = (configuredLocalAgentBaseUrl || 'http://127.0.0.1:9527').replace(
  /\/+$/,
  ''
)
const BRIDGE_TOKEN = (import.meta.env['VITE_TERMINAL_AGENT_BRIDGE_TOKEN'] ?? '').trim()
const WAKE_TIMEOUT_MS = 1_200

export type LocalPrintWakeOutcome = 'accepted' | 'skipped' | 'unavailable'

/** Best-effort latency hint. Cloud claim remains the only print dispatch path. */
export async function wakeLocalPrintQueue(): Promise<LocalPrintWakeOutcome> {
  if (!BRIDGE_TOKEN) return 'skipped'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WAKE_TIMEOUT_MS)
  try {
    const response = await fetch(`${LOCAL_AGENT_BASE_URL}/local/print/wake`, {
      method: 'POST',
      headers: { 'X-Local-Bridge-Token': BRIDGE_TOKEN },
      cache: 'no-store',
      signal: controller.signal,
    })
    return response.status === 202 ? 'accepted' : 'unavailable'
  } catch {
    return 'unavailable'
  } finally {
    clearTimeout(timer)
  }
}
