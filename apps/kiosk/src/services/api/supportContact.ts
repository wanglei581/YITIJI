/**
 * 公开服务联系方式。GET /api/v1/public/support-contact?terminalId=
 *
 * 接口可能尚未合入。404、超时、字段缺失都记成最保守的一套：
 * 没号码、没服务时间、附近没有别的在线终端、小程序未发布。
 * 不在模块加载时发请求。整个会话共用一次在途请求，结果 5 分钟内复用。
 *
 * 谁来读：运行时根（KioskRuntimeRoot）挂载时调 startSupportContactKeeper()——
 * 立刻读一次，之后每 4 分钟续一次（赶在 5 分钟缓存过期前换新），终端号变了就丢缓存按新号重读。
 * 后台改了服务电话，一体机最迟一个周期（加服务端自己的 5 分钟缓存）后上屏。
 * 页面只读：useSupportContact / useSupportContactSnapshot 订阅这里的变化，号码到了、
 * 续上换了值、终端号换了，用到标准句的地方都会跟着重绘，不靠各自的轮询碰运气。
 */

import {
  bindSupportContactPeek,
  CONSERVATIVE_SUPPORT_CONTACT,
  type PublicSupportContact,
} from '../../copy/unattendedCopy'
import { API_BASE_URL } from './client'
import { getTerminalId, subscribeTerminalIdentity } from './screensaver'

const TTL_MS = 5 * 60 * 1000
/** 缓存 5 分钟，赶在过期前续上；留一分钟余量给慢网和超时（单次请求最长 8 秒）。 */
export const SUPPORT_CONTACT_RENEW_MS = 4 * 60 * 1000
const TIMEOUT_MS = 8000

/** 缓存记着是为哪台终端读的：终端号换了，旧号的结果一律不认。 */
type CacheEntry = { contact: PublicSupportContact; at: number; terminalId: string }
type Inflight = { terminalId: string; promise: Promise<PublicSupportContact> }

let cache: CacheEntry | null = null
let inflight: Inflight | null = null
const listeners = new Set<() => void>()

export type { PublicSupportContact }

function usable(entry: CacheEntry | null): entry is CacheEntry {
  return entry !== null && entry.terminalId === getTerminalId() && Date.now() - entry.at <= TTL_MS
}

export function peekSupportContact(): PublicSupportContact {
  return usable(cache) ? cache.contact : CONSERVATIVE_SUPPORT_CONTACT
}

bindSupportContactPeek(peekSupportContact)

/** 订阅 peekSupportContact() 的变化（给 useSyncExternalStore 用）。值没变的续期不会通知。 */
export function subscribeSupportContact(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notifyListeners(): void {
  for (const listener of [...listeners]) listener()
}

/** 逐字段比，字段以后再加也不用回来改。 */
function sameContact(a: PublicSupportContact, b: PublicSupportContact): boolean {
  const keys = Object.keys(b) as Array<keyof PublicSupportContact>
  return keys.length === Object.keys(a).length && keys.every((key) => a[key] === b[key])
}

/**
 * 记下结果。值没变就沿用旧对象，订阅者不会白白重绘；
 * 读到的值和订阅者手里的不一样（号码到了、被后台改了、被清空了）才通知。
 * 请求发出后终端号又换了：这份是旧号的结果，只还给当时的调用方，不进缓存（否则会盖掉新号刚读到的）。
 */
function remember(contact: PublicSupportContact, terminalId: string): PublicSupportContact {
  if (terminalId !== getTerminalId()) return contact
  const before = peekSupportContact()
  cache = { contact: sameContact(before, contact) ? before : contact, at: Date.now(), terminalId }
  if (peekSupportContact() !== before) notifyListeners()
  return contact
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

/** 缺哪个字段，哪个字段用保守值。不把缺的布尔读成真。 */
export function supportContactFromPayload(body: unknown): PublicSupportContact {
  if (!body || typeof body !== 'object') return CONSERVATIVE_SUPPORT_CONTACT
  const data = (body as { data?: unknown }).data
  if (!data || typeof data !== 'object') return CONSERVATIVE_SUPPORT_CONTACT
  const row = data as {
    servicePhone?: unknown
    serviceHours?: unknown
    otherOnlineTerminalNearby?: unknown
    miniappPublished?: unknown
  }
  return {
    servicePhone: textOrNull(row.servicePhone),
    serviceHours: textOrNull(row.serviceHours),
    otherOnlineTerminalNearby: row.otherOnlineTerminalNearby === true,
    miniappPublished: row.miniappPublished === true,
  }
}

async function requestSupportContact(terminalId: string): Promise<PublicSupportContact> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const query = terminalId ? `?terminalId=${encodeURIComponent(terminalId)}` : ''
    const response = await fetch(`${API_BASE_URL}/public/support-contact${query}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return remember(CONSERVATIVE_SUPPORT_CONTACT, terminalId)
    const body: unknown = await response.json()
    return remember(supportContactFromPayload(body), terminalId)
  } catch {
    return remember(CONSERVATIVE_SUPPORT_CONTACT, terminalId)
  } finally {
    clearTimeout(timer)
  }
}

/** 同一台终端的并发调用共用一次请求；终端号换了就另起一次，旧号的在途结果落不进新号的缓存。 */
function request(): Promise<PublicSupportContact> {
  const terminalId = getTerminalId()
  if (inflight && inflight.terminalId === terminalId) return inflight.promise
  const promise: Promise<PublicSupportContact> = requestSupportContact(terminalId).finally(() => {
    if (inflight?.promise === promise) inflight = null
  })
  inflight = { terminalId, promise }
  return promise
}

/** 5 分钟内直接复用（只认当前终端号的结果）；并发调用共用同一次请求。失败也缓存，避免每屏重打。 */
export function loadSupportContact(): Promise<PublicSupportContact> {
  if (usable(cache)) return Promise.resolve(cache.contact)
  return request()
}

/** 不看缓存，重新读一次。运行时根用它在缓存过期前续上。 */
export function refreshSupportContact(): Promise<PublicSupportContact> {
  return request()
}

/**
 * 运行时根挂载时调用，返回停止函数（卸载时调）。
 * - 立刻读一次（缓存还新就不发请求）；
 * - 之后每 SUPPORT_CONTACT_RENEW_MS 强制续一次，后台改了号码最迟一个周期后上屏；
 * - 终端号变了（Agent 晚于浏览器启动、改绑）：丢缓存，订阅者先回到保守值，再按新号重读。
 */
export function startSupportContactKeeper(): () => void {
  let lastTerminalId = getTerminalId()
  void loadSupportContact()
  const timer = setInterval(() => {
    void refreshSupportContact()
  }, SUPPORT_CONTACT_RENEW_MS)
  const unsubscribe = subscribeTerminalIdentity(() => {
    const next = getTerminalId()
    if (next === lastTerminalId) return
    lastTerminalId = next
    cache = null
    notifyListeners()
    void refreshSupportContact()
  })
  return () => {
    clearInterval(timer)
    unsubscribe()
  }
}

/** 测试用：丢掉缓存和在途请求。页面不要调用；终端号换了由 startSupportContactKeeper 处理。 */
export function resetSupportContactCacheForTests(): void {
  cache = null
  inflight = null
}
