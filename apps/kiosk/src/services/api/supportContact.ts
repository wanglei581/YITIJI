/**
 * 公开服务联系方式。GET /api/v1/public/support-contact?terminalId=
 *
 * 接口可能尚未合入。404、超时、字段缺失都记成最保守的一套：
 * 没号码、没服务时间、附近没有别的在线终端、小程序未发布。
 * 不在模块加载时发请求。整个会话共用一次在途请求，结果 5 分钟内复用。
 */

import {
  bindSupportContactPeek,
  CONSERVATIVE_SUPPORT_CONTACT,
  type PublicSupportContact,
} from '../../copy/unattendedCopy'
import { API_BASE_URL } from './client'
import { getTerminalId } from './screensaver'

const TTL_MS = 5 * 60 * 1000
const TIMEOUT_MS = 8000

type CacheEntry = { contact: PublicSupportContact; at: number }

let cache: CacheEntry | null = null
let inflight: Promise<PublicSupportContact> | null = null

export type { PublicSupportContact }

export function peekSupportContact(): PublicSupportContact {
  if (!cache) return CONSERVATIVE_SUPPORT_CONTACT
  if (Date.now() - cache.at > TTL_MS) return CONSERVATIVE_SUPPORT_CONTACT
  return cache.contact
}

bindSupportContactPeek(peekSupportContact)

function remember(contact: PublicSupportContact): PublicSupportContact {
  cache = { contact, at: Date.now() }
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

async function requestSupportContact(): Promise<PublicSupportContact> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const terminalId = getTerminalId()
    const query = terminalId ? `?terminalId=${encodeURIComponent(terminalId)}` : ''
    const response = await fetch(`${API_BASE_URL}/public/support-contact${query}`, {
      signal: controller.signal,
      // 公开配置不需要会员身份；显式禁用同源 Cookie 与浏览器身份凭证。
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return remember(CONSERVATIVE_SUPPORT_CONTACT)
    const body: unknown = await response.json()
    return remember(supportContactFromPayload(body))
  } catch {
    return remember(CONSERVATIVE_SUPPORT_CONTACT)
  } finally {
    clearTimeout(timer)
  }
}

/** 5 分钟内直接复用；并发调用共用同一次请求。失败也缓存，避免每屏重打。 */
export function loadSupportContact(): Promise<PublicSupportContact> {
  if (cache && Date.now() - cache.at <= TTL_MS) return Promise.resolve(cache.contact)
  if (!inflight) {
    inflight = requestSupportContact().finally(() => {
      inflight = null
    })
  }
  return inflight
}

/** 测试或终端号切换时丢掉缓存。页面不要调用。 */
export function resetSupportContactCacheForTests(): void {
  cache = null
  inflight = null
}
