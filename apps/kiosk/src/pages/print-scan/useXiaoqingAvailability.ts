import { useEffect, useState } from 'react'
import { API_BASE_URL } from '../../services/api/client'
import { terminalAttributedFetch } from '../../services/terminalAuth'

/**
 * 「小青现在能不能用」。
 *
 * 只认服务端那一个真探测：GET /advisor/availability，200 + available:false 才算不可用
 * （它把「不可用」当成正常回答，不是错误）。探不到、超时、读不懂一律是 unknown —— 不写「接不上」，
 * 也不写「正常」：没有真实回答就不替它下结论。结果在本页会话里缓存一分钟，换屏不重复探。
 */
export type XiaoqingAvailability = 'unknown' | 'available' | 'unavailable'

const FRESH_MS = 60_000
const PROBE_TIMEOUT_MS = 4_000

let cached: { value: 'available' | 'unavailable'; at: number } | null = null
let inflight: Promise<XiaoqingAvailability> | null = null

function freshValue(): XiaoqingAvailability {
  return cached && Date.now() - cached.at < FRESH_MS ? cached.value : 'unknown'
}

async function probe(): Promise<XiaoqingAvailability> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await terminalAttributedFetch(`${API_BASE_URL}/advisor/availability`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
      signal: controller.signal,
    })
    if (!res.ok) return 'unknown'
    const body: unknown = await res.json()
    const row = (body && typeof body === 'object' && 'data' in body ? (body as { data: unknown }).data : body) as
      | { available?: unknown }
      | null
    if (!row || typeof row !== 'object') return 'unknown'
    if (row.available === true) return 'available'
    if (row.available === false) return 'unavailable'
    return 'unknown'
  } catch {
    return 'unknown'
  } finally {
    window.clearTimeout(timer)
  }
}

function load(): Promise<XiaoqingAvailability> {
  const hit = freshValue()
  if (hit !== 'unknown') return Promise.resolve(hit)
  if (!inflight) {
    inflight = probe()
      .then((value) => {
        if (value !== 'unknown') cached = { value, at: Date.now() }
        return value
      })
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

export function useXiaoqingAvailability(): XiaoqingAvailability {
  const [value, setValue] = useState<XiaoqingAvailability>(() => freshValue())
  useEffect(() => {
    let alive = true
    void load().then((next) => {
      if (alive) setValue(next)
    })
    return () => {
      alive = false
    }
  }, [])
  return value
}
