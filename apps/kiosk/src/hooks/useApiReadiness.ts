import { useCallback, useEffect, useState } from 'react'
import { API_BASE_URL } from '../services/api/client'

export type ApiReadinessStatus = 'checking' | 'ready' | 'unavailable'

const READINESS_TIMEOUT_MS = 4_000

/**
 * 入口级在线服务探测。它只证明 API 可达，不替代具体业务、设备或配额门禁。
 */
export function useApiReadiness(): {
  status: ApiReadinessStatus
  retry: () => void
} {
  const [status, setStatus] = useState<ApiReadinessStatus>('checking')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), READINESS_TIMEOUT_MS)

    setStatus('checking')
    void fetch(`${API_BASE_URL}/health`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then((response) => {
        if (active) setStatus(response.ok ? 'ready' : 'unavailable')
      })
      .catch(() => {
        if (active) setStatus('unavailable')
      })
      .finally(() => window.clearTimeout(timeoutId))

    return () => {
      active = false
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  return { status, retry }
}
