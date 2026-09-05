import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import { API_BASE_URL, API_MODE } from '../../services/api/client'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../../services/auth/memberSessionEvents'
import { userMessageOf } from '../../services/api/userErrorMessage'

const GUEST_ACK_KEY = 'kiosk.resume_ai.guest_ack'

interface ConsentRow {
  scope: string
  granted: boolean
}

interface Envelope<T> {
  success?: boolean
  data?: T
}

async function readJson<T>(res: Response, token?: string): Promise<T> {
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    if (token && isMemberSessionInvalidError(res.status, code, true)) notifyMemberSessionExpired(token)
    throw new ApiHttpError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T> | T
  if (json && typeof json === 'object' && 'data' in json && (json as Envelope<T>).data !== undefined) {
    return (json as Envelope<T>).data as T
  }
  return json as T
}

async function fetchResumeAiGranted(token: string): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/me/ai-consents/status`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    credentials: 'include',
    signal: AbortSignal.timeout(8_000),
  })
  const rows = await readJson<ConsentRow[]>(res, token)
  return Array.isArray(rows) && rows.some((row) => row.scope === 'resume_ai' && row.granted)
}

async function grantResumeAiConsent(token: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/me/ai-consents`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    credentials: 'include',
    body: JSON.stringify({ scope: 'resume_ai' }),
    signal: AbortSignal.timeout(8_000),
  })
  await readJson<ConsentRow>(res, token)
}

export function useResumeAiConsent() {
  const { getToken } = useAuth()
  const token = getToken()
  const [phase, setPhase] = useState<'checking' | 'needed' | 'granted'>('checking')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      if (API_MODE !== 'http' || !token) {
        const ack = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(GUEST_ACK_KEY) === '1'
        if (!cancelled) setPhase(ack ? 'granted' : 'needed')
        return
      }
      try {
        const granted = await fetchResumeAiGranted(token)
        if (!cancelled) setPhase(granted ? 'granted' : 'needed')
      } catch {
        if (!cancelled) setPhase('needed')
      }
    }
    void run()
    return () => { cancelled = true }
  }, [token])

  const confirm = useCallback(async (): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      if (API_MODE !== 'http' || !token) {
        sessionStorage.setItem(GUEST_ACK_KEY, '1')
        setPhase('granted')
        return true
      }
      await grantResumeAiConsent(token)
      setPhase('granted')
      return true
    } catch (err) {
      setError(userMessageOf(err, '授权未完成，请重试'))
      return false
    } finally {
      setBusy(false)
    }
  }, [token])

  return {
    checking: phase === 'checking',
    needsPrompt: phase === 'needed',
    ready: phase === 'granted',
    busy,
    error,
    confirm,
  }
}
