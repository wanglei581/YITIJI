/**
 * 公开服务电话。GET /api/v1/public/service-contact。
 *
 * 接口可能尚未合入。404、超时、空号码都记成 null，页面改用《隐私政策》里的联系方式。
 * 不在模块加载时发请求。整个会话共用一次在途请求，结果 5 分钟内复用。
 */

import { bindServicePhonePeek } from '../../copy/unattendedCopy'
import { API_BASE_URL } from './client'

const TTL_MS = 5 * 60 * 1000
const TIMEOUT_MS = 8000

type CacheEntry = { phone: string | null; at: number }

let cache: CacheEntry | null = null
let inflight: Promise<string | null> | null = null

export function peekServicePhone(): string | null {
  if (!cache) return null
  if (Date.now() - cache.at > TTL_MS) return null
  return cache.phone
}

bindServicePhonePeek(peekServicePhone)

function remember(phone: string | null): string | null {
  cache = { phone, at: Date.now() }
  return phone
}

function phoneFromPayload(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const data = (body as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const phone = (data as { servicePhone?: unknown }).servicePhone
  if (typeof phone !== 'string') return null
  const trimmed = phone.trim()
  return trimmed || null
}

async function requestServicePhone(): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${API_BASE_URL}/public/service-contact`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) return remember(null)
    const body: unknown = await response.json()
    return remember(phoneFromPayload(body))
  } catch {
    return remember(null)
  } finally {
    clearTimeout(timer)
  }
}

/** 5 分钟内直接复用；并发调用共用同一次请求。失败也缓存，避免每屏重打。 */
export function loadServicePhone(): Promise<string | null> {
  if (cache && Date.now() - cache.at <= TTL_MS) return Promise.resolve(cache.phone)
  if (!inflight) {
    inflight = requestServicePhone().finally(() => {
      inflight = null
    })
  }
  return inflight
}
