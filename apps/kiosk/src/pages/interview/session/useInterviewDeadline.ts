import { useEffect, useRef, useState } from 'react'
import { getInterviewSession } from '../../../services/api/interview'
import { API_MODE } from '../../../services/api/client'
import type { InterviewLiveState } from '../interviewWorkbenchSession'
import type { InterviewSessionRouteState } from './types'
import {
  deadlineFromLegacyRemaining,
  deadlineFromLocalStart,
  deadlineFromServerTiming,
  readInterviewTiming,
  remainingSecAt,
} from './interviewDeadline'

export function useInterviewDeadline(deadlineAtLocalMs: number, onDeadline?: () => void, sessionId?: string): { remainingSec: number } {
  const [remainingSec, setRemainingSec] = useState(() => remainingSecAt(deadlineAtLocalMs, Date.now()))
  useEffect(() => {
    const update = () => setRemainingSec((current) => {
      const next = remainingSecAt(deadlineAtLocalMs, Date.now())
      return current === next ? current : next
    })
    update()
    const timer = setInterval(update, 500)
    return () => clearInterval(timer)
  }, [deadlineAtLocalMs])
  const callbackRef = useRef(onDeadline)
  callbackRef.current = onDeadline
  const firedRef = useRef<string | null>(null)
  const sessionKey = sessionId ?? 'current-session'
  useEffect(() => {
    if (remainingSecAt(deadlineAtLocalMs, Date.now()) > 0 || firedRef.current === sessionKey) return
    firedRef.current = sessionKey
    callbackRef.current?.()
  }, [remainingSec, deadlineAtLocalMs, sessionKey])
  return { remainingSec }
}

export function useInterviewSessionDeadline(
  state: InterviewSessionRouteState | null,
  live: InterviewLiveState | undefined,
  getToken: () => string | null,
  onDeadline?: () => void,
) {
  const [{ deadlineAtLocalMs, deadlineSource }, setDeadline] = useState(() => {
    const sameLive = state?.sessionId && live?.sessionId === state.sessionId ? live : undefined
    const routeDeadline = state?.deadlineAtLocalMs
    const validRouteDeadline = typeof routeDeadline === 'number' && Number.isFinite(routeDeadline) && routeDeadline > 0
    const deadline = validRouteDeadline ? routeDeadline : sameLive?.deadlineAtLocalMs
    return {
      deadlineAtLocalMs: deadline ?? (sameLive
        ? deadlineFromLegacyRemaining(sameLive.remainingSec, Date.now())
        : deadlineFromLocalStart(state?.durationMin ?? 5, Date.now())),
      deadlineSource: (validRouteDeadline ? state?.deadlineSource : sameLive?.deadlineSource) ?? 'local',
    }
  })
  const deadlineSealedRef = useRef(false)
  const sessionId = state?.sessionId
  const accessToken = state?.accessToken
  useEffect(() => {
    if (API_MODE !== 'http' || !sessionId) return
    let cancelled = false
    void getInterviewSession(sessionId, { token: getToken(), accessToken }).then((detail) => {
      if (cancelled || deadlineSealedRef.current) return
      const deadline = deadlineFromServerTiming(readInterviewTiming(detail), Date.now())
      if (deadline !== null) setDeadline({ deadlineAtLocalMs: deadline, deadlineSource: 'server' })
    }).catch(() => { /* 旧后端或网络不可用时保留本场已经确定的截止时刻。 */ })
    return () => { cancelled = true }
  }, [sessionId, accessToken, getToken])
  const markDeadlineReached = () => {
    deadlineSealedRef.current = true
    setDeadline((current) => ({
      ...current, deadlineAtLocalMs: Math.min(current.deadlineAtLocalMs, Date.now()),
    }))
  }
  return { deadlineAtLocalMs, deadlineSource, markDeadlineReached, ...useInterviewDeadline(deadlineAtLocalMs, onDeadline, sessionId) }
}
