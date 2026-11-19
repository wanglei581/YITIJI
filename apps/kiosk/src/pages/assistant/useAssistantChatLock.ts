import { useEffect } from 'react'
import type { AiAvailability } from '../../ai'
import { API_BASE_URL } from '../../services/api/client'
import { terminalAttributedFetch } from '../../services/terminalAuth'
import { assistantLockFromProbe } from './assistantLockFromProbe'

/**
 * 小青文字对话的只读探针。只有 200 且 available 为 false 才锁输入。
 * 探不到、超时、读不懂都不改当前状态：不把 AI 说成正常，也不说成不能用。
 */
export { assistantLockFromProbe } from './assistantLockFromProbe'

export function useAssistantChatLock(
  setAvailability: (value: AiAvailability) => void,
  nonce: number,
): void {
  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 4_000)
    void terminalAttributedFetch(`${API_BASE_URL}/assistant/availability`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) return
        const body: unknown = await res.json()
        if (alive && assistantLockFromProbe(body) === 'lock') setAvailability('unavailable')
      })
      .catch(() => undefined)
      .finally(() => window.clearTimeout(timer))
    return () => {
      alive = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [nonce, setAvailability])
}
