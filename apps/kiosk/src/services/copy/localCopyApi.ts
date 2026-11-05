// 本机复印协议独立于扫描上传；控制凭证从不发往本机。
const BASE = (import.meta.env['VITE_TERMINAL_AGENT_LOCAL_URL'] ?? '').trim() || 'http://127.0.0.1:9527'
const BRIDGE_TOKEN = (import.meta.env['VITE_TERMINAL_AGENT_BRIDGE_TOKEN'] ?? '').trim()
export type LocalCopyAction = 'start' | 'next-page' | 'finish' | 'status' | 'preview' | 'abort' | 'clear'
export interface LocalCopyIdentity { copyId: string; generation: number }
export interface LocalCopyView {
  state: 'starting' | 'scanning' | 'page_ready' | 'composing' | 'scanned' | 'cancelled' | 'cleared' | 'expired' | 'failed'
  generation: number
  pageCount: number | null
  errorCode: string | null
  purged?: boolean
}
const STATES = ['starting', 'scanning', 'page_ready', 'composing', 'scanned', 'cancelled', 'cleared', 'expired', 'failed']
async function request(action: LocalCopyAction, identity: LocalCopyIdentity, extra: object, signal?: AbortSignal): Promise<Response> {
  if (!BRIDGE_TOKEN) throw new Error('COPY_BRIDGE_UNAVAILABLE')
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort)
  if (signal?.aborted) abort()
  const timer = window.setTimeout(abort, 8000)
  try {
    const response = await fetch(`${BASE}/local/copy/${action}`, {
      method: 'POST', cache: 'no-store', credentials: 'omit', signal: controller.signal,
      headers: { Accept: action === 'preview' ? 'image/jpeg' : 'application/json', 'Content-Type': 'application/json', 'X-Local-Bridge-Token': BRIDGE_TOKEN },
      body: JSON.stringify({ ...identity, operationId: crypto.randomUUID(), ...extra }),
    })
    // 读完整个字节体也受同一超时与离页中止约束。
    const bytes = await response.arrayBuffer()
    if (!response.ok) throw new Error('COPY_LOCAL_UNKNOWN')
    return new Response(bytes, { status: response.status, headers: response.headers })
  } finally {
    window.clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }
}
export async function postLocalCopy(action: Exclude<LocalCopyAction, 'preview'>, identity: LocalCopyIdentity,
  extra: { source?: 'flatbed' | 'feeder'; scanColor?: 'color' | 'gray' } = {}, signal?: AbortSignal): Promise<LocalCopyView> {
  const response = await request(action, identity, extra, signal)
  const payload = await response.json() as { success?: boolean; data?: LocalCopyView }
  const view = payload.data
  if (payload.success !== true || !view || !STATES.includes(view.state) || view.generation !== identity.generation) throw new Error('COPY_LOCAL_UNKNOWN')
  return { state: view.state, generation: view.generation,
    pageCount: Number.isSafeInteger(view.pageCount) && Number(view.pageCount) > 0 ? view.pageCount : null,
    errorCode: typeof view.errorCode === 'string' ? view.errorCode : null,
    ...(typeof view.purged === 'boolean' ? { purged: view.purged } : {}) }
}
export async function fetchCopyPreview(identity: LocalCopyIdentity, page: number, signal: AbortSignal): Promise<Blob> {
  const response = await request('preview', identity, { page }, signal)
  if (response.headers.get('content-type')?.split(';')[0] !== 'image/jpeg') throw new Error('COPY_PREVIEW_UNKNOWN')
  const blob = await response.blob()
  if (!blob.size) throw new Error('COPY_PREVIEW_EMPTY')
  return blob
}
