const base = ((import.meta.env['VITE_TERMINAL_AGENT_LOCAL_URL'] ?? '').trim() || 'http://127.0.0.1:9527').replace(/\/+$/, '')
const token = (import.meta.env['VITE_TERMINAL_AGENT_BRIDGE_TOKEN'] ?? '').trim()

export type LocalAgentStatus = 'unconfigured' | 'checking' | 'reachable' | 'unreachable'
let status: LocalAgentStatus = token ? 'checking' : 'unconfigured'
let sequence = 0
const listeners = new Set<() => void>()
export const localAgentSnapshot = (): LocalAgentStatus => status
export function subscribeLocalAgent(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 只读查询；U 盘有无不影响网桥是否回应。 */
export async function probeLocalAgent(signal?: AbortSignal): Promise<LocalAgentStatus> {
  if (!token) return 'unconfigured'
  const mine = ++sequence
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) return status
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = window.setTimeout(abort, 2500)
  let next: LocalAgentStatus = 'unreachable'
  try {
    const response = await fetch(`${base}/local/usb/status`, {
      method: 'GET', headers: { Accept: 'application/json', 'X-Local-Bridge-Token': token },
      cache: 'no-store', signal: controller.signal,
    })
    if (response.ok) next = 'reachable'
  } catch { /* 拒连、超时和鉴权失败都不能确认本机程序可用。 */ }
  finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
  if (!signal?.aborted && mine === sequence) {
    status = next
    listeners.forEach((listener) => listener())
  }
  return signal?.aborted || mine !== sequence ? status : next
}
