import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { getInterviewSession, type InterviewAccess } from '../../../services/api/interview'
import type { WavRecorder } from '../../../utils/wavRecorder'
import { API_MODE } from '../../../services/api/client'
import type { InterviewLiveState } from '../interviewWorkbenchSession'
import type { InterviewStage } from '../interviewWorkbenchModel'
import { InterviewTimeUp } from './InterviewTimeUp'
import { endInterviewAtDeadline } from './interviewTurnActions'
import type { InterviewSessionPhase, InterviewSessionRouteState, InterviewVoiceState } from './types'
import {
  deadlineFromLegacyRemaining,
  deadlineFromLocalStart,
  deadlineFromServerTiming,
  INTERVIEW_DEADLINE_WARN_SEC,
  readInterviewTiming,
  remainingSecAt,
} from './interviewDeadline'

function initialDeadline(state: InterviewSessionRouteState | null, live: InterviewLiveState | undefined) {
  const same = state?.sessionId && live?.sessionId === state.sessionId ? live : undefined
  const routeDeadline = state?.deadlineAtLocalMs
  const validRoute = typeof routeDeadline === 'number' && Number.isFinite(routeDeadline) && routeDeadline > 0
  const stored = validRoute ? routeDeadline : same?.deadlineAtLocalMs
  return {
    deadlineAtLocalMs: stored ?? (same
      ? deadlineFromLegacyRemaining(same.remainingSec, Date.now())
      : deadlineFromLocalStart(state?.durationMin ?? 5, Date.now())),
    deadlineSource: ((validRoute ? state?.deadlineSource : same?.deadlineSource) ?? 'local') as 'server' | 'local',
  }
}

export function useInterviewDeadlineSeal(args: {
  state: InterviewSessionRouteState | null
  live: InterviewLiveState | undefined
  getToken: () => string | null
  access: InterviewAccess
  phase: InterviewSessionPhase
  omitPrintAnswers: boolean
  answersRecorded: boolean
  onGoStage?: (stage: InterviewStage) => void
  navigate: NavigateFunction
  recorderRef: MutableRefObject<WavRecorder | null>
  recordTimerRef: MutableRefObject<number | null>
  recordStartedAtRef: MutableRefObject<number | null>
  pendingAnswerRef: MutableRefObject<Promise<void> | null>
  stopPlayback: () => void
  setDraft: Dispatch<SetStateAction<string>>
  setVoice: Dispatch<SetStateAction<InterviewVoiceState>>
  setRecordSec: Dispatch<SetStateAction<number>>
  setPhase: Dispatch<SetStateAction<InterviewSessionPhase>>
  setAssistantDown: Dispatch<SetStateAction<boolean>>
}) {
  const [deadline, setDeadline] = useState(() => initialDeadline(args.state, args.live))
  const [remainingSec, setRemainingSec] = useState(() => remainingSecAt(deadline.deadlineAtLocalMs, Date.now()))
  const [timeUpStop, setTimeUpStop] = useState<'no-answers' | 'report-failed' | null>(null)
  const [reportBusy, setReportBusy] = useState(false)
  const sealedRef = useRef(false)
  const phaseRef = useRef(args.phase)
  phaseRef.current = args.phase
  const sealRef = useRef<() => void>(() => {})
  const getTokenRef = useRef(args.getToken)
  getTokenRef.current = args.getToken

  useEffect(() => {
    const update = () => setRemainingSec((current) => {
      const next = remainingSecAt(deadline.deadlineAtLocalMs, Date.now())
      return current === next ? current : next
    })
    update()
    const timer = window.setInterval(update, 500)
    return () => window.clearInterval(timer)
  }, [deadline.deadlineAtLocalMs])

  const sessionKey = args.state?.sessionId ?? ''
  useEffect(() => {
    if (!sessionKey) return
    if (remainingSecAt(deadline.deadlineAtLocalMs, Date.now()) > 0 || sealedRef.current) return
    sealRef.current()
  }, [remainingSec, deadline.deadlineAtLocalMs, sessionKey])

  const sessionId = args.state?.sessionId
  const accessToken = args.state?.accessToken
  useEffect(() => {
    if (API_MODE !== 'http' || !sessionId) return
    let cancelled = false
    void getInterviewSession(sessionId, { token: getTokenRef.current(), accessToken }).then((detail) => {
      if (cancelled || sealedRef.current) return
      const timing = readInterviewTiming(detail)
      if (timing.timeUp) {
        setDeadline((current) => ({
          ...current,
          deadlineAtLocalMs: Math.min(current.deadlineAtLocalMs, Date.now()),
        }))
        return
      }
      const next = deadlineFromServerTiming(timing, Date.now())
      if (next !== null) setDeadline({ deadlineAtLocalMs: next, deadlineSource: 'server' })
    }).catch(() => { /* 读不到会话就沿用开场时记下的截止时刻。 */ })
    return () => { cancelled = true }
  }, [sessionId, accessToken])

  const requestReport = () => {
    if (!args.state?.sessionId) return
    setReportBusy(true)
    args.setPhase('finishing')
    void endInterviewAtDeadline({
      state: args.state,
      access: args.access,
      omitPrintAnswers: args.omitPrintAnswers,
      pendingAnswer: args.pendingAnswerRef.current,
      onGoStage: args.onGoStage,
      navigate: args.navigate,
      setAssistantDown: args.setAssistantDown,
    }).then((result) => {
      setReportBusy(false)
      if (result !== 'reported') setTimeUpStop(result)
    })
  }

  const sealAtDeadline = () => {
    const {
      recorderRef, recordTimerRef, recordStartedAtRef, setRecordSec, setDraft, setVoice, stopPlayback, state,
    } = args
    if (sealedRef.current || !state?.sessionId) return
    sealedRef.current = true
    recorderRef.current?.cancel()
    recorderRef.current = null
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    recordTimerRef.current = null
    recordStartedAtRef.current = null
    setRecordSec(0)
    setDraft('')
    setVoice({ kind: 'idle' })
    stopPlayback()
    if (phaseRef.current === 'finishing') return
    requestReport()
  }
  sealRef.current = sealAtDeadline

  const timeUpScreen = timeUpStop && args.state?.sessionId ? (
    <InterviewTimeUp
      variant={timeUpStop}
      sessionId={args.state.sessionId}
      getAccess={() => ({ token: getTokenRef.current(), accessToken: args.state?.accessToken ?? null })}
      answersRecorded={args.answersRecorded}
      busy={reportBusy}
      onLeave={() => args.navigate('/interview-service')}
      onRestart={() => (args.onGoStage ? args.onGoStage('setup') : args.navigate('/interview/setup'))}
      onRetry={() => {
        if (reportBusy || timeUpStop === 'no-answers') return
        requestReport()
      }}
      onOpenTips={() => (args.onGoStage ? args.onGoStage('tips') : args.navigate('/interview/tips'))}
    />
  ) : null

  return {
    remainingSec,
    deadlineAtLocalMs: deadline.deadlineAtLocalMs,
    deadlineSource: deadline.deadlineSource,
    deadlineWarn: remainingSec >= 1 && remainingSec <= INTERVIEW_DEADLINE_WARN_SEC,
    sealedRef,
    sealAtDeadline,
    timeUpScreen,
  }
}
