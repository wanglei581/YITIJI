import { fetchProtectedLocalAgent } from '../localAgentBridge'

const WAKE_TIMEOUT_MS = 1_200

export type LocalPrintWakeOutcome = 'accepted' | 'skipped' | 'unavailable'

/** Best-effort latency hint. Cloud claim remains the only print dispatch path. */
export async function wakeLocalPrintQueue(): Promise<LocalPrintWakeOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WAKE_TIMEOUT_MS)
  try {
    const response = await fetchProtectedLocalAgent('/local/print/wake', {
      method: 'POST',
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
