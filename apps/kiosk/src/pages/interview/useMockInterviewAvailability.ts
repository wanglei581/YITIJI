import { useEffect, useState } from 'react'
import { API_BASE_URL } from '../../services/api/client'
import { terminalAttributedFetch } from '../../services/terminalAuth'
import { interviewProbeFromBody, type InterviewProbe } from './interviewStartControl'

export { interviewProbeFromBody, interviewStartControl, INTERVIEW_DOWN_NOTE } from './interviewStartControl'
export type { InterviewProbe } from './interviewStartControl'

/**
 * GET /mock-interviews/availability。只读，不调模型。
 * 网络失败、非 200、读不懂都记成没确认：不当成不能用，也不当成能用。
 */
export function useMockInterviewAvailability(): InterviewProbe {
  const [probe, setProbe] = useState<InterviewProbe>('checking')
  useEffect(() => {
    let alive = true
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 4_000)
    void terminalAttributedFetch(`${API_BASE_URL}/mock-interviews/availability`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!alive) return
        if (!res.ok) {
          setProbe('unconfirmed')
          return
        }
        const body: unknown = await res.json()
        setProbe(interviewProbeFromBody(body))
      })
      .catch(() => { if (alive) setProbe('unconfirmed') })
      .finally(() => window.clearTimeout(timer))
    return () => {
      alive = false
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [])
  return probe
}
