import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { transcribeAnswer, type InterviewAccess } from '../../../services/api/interview'
import { errorCodeOf, userMessageOf } from '../../../services/api/userErrorMessage'
import { startWavRecorder, type WavRecorder } from '../../../utils/wavRecorder'
import { classifyMicError, micFailureReasonLine, micReasonLine, type MicCapabilityState } from '../../../utils/micCapability'
import { aiDeclarationDeclineMessage } from '../../../ai/aiDeclarationErrors'
import { isAiOutage } from '../../../ai/aiOutage'
import { INTERVIEW_AI_DOWN_HINT } from '../interviewWorkbenchModel'
import type { InterviewSessionRouteState, InterviewVoiceState } from './types'

const MAX_RECORD_SEC = 58

type Setter<T> = Dispatch<SetStateAction<T>>
export function useInterviewRecording({ state, access, sealedRef, sealIfExpired, sealAtDeadline, micCapability,
  setMicCapability, setMicError, setVoiceHint, setError, setVoice, setMode, stopPlayback,
}: {
  state: InterviewSessionRouteState | null
  access: InterviewAccess
  sealedRef: MutableRefObject<boolean>
  sealIfExpired: () => boolean
  sealAtDeadline: () => void
  micCapability: MicCapabilityState | null
  setMicCapability: Setter<MicCapabilityState | null>
  setMicError: Setter<boolean>
  setVoiceHint: Setter<string | null>
  setError: Setter<string | null>
  setVoice: Setter<InterviewVoiceState>
  setMode: Setter<'voice' | 'text'>
  stopPlayback: () => void
}) {
  const recorderRef = useRef<WavRecorder | null>(null)
  const recordTimerRef = useRef<number | null>(null)
  const recordStartedAtRef = useRef<number | null>(null)
  const [recordSec, setRecordSec] = useState(0)
  useEffect(() => () => {
    recorderRef.current?.cancel()
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
  }, [])
  const resetVoiceState = () => {
    recorderRef.current?.cancel()
    recorderRef.current = null
    recordStartedAtRef.current = null
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    recordTimerRef.current = null
    setRecordSec(0)
    setVoice({ kind: 'idle' })
  }

  const fallbackToText = (reason: string) => {
    resetVoiceState()
    setMode('text')
    setVoiceHint(reason)
  }

  const startRecording = async () => {
    if (sealIfExpired() || !state) return
    // 能力门禁：去掉原生 disabled 后按钮真的可点，守卫必须在 handler 内部。
    if (micCapability !== null && micCapability !== 'available') {
      setMicError(true)
      setVoiceHint(micReasonLine(micCapability))
      setError(micFailureReasonLine(micCapability))
      return
    }
    setError(null)
    setMicError(false)
    setVoiceHint(null)
    stopPlayback()
    setVoice({ kind: 'requesting_permission' })
    try {
      const recorder = await startWavRecorder()
      if (sealIfExpired()) { recorder.cancel(); return }
      const startedAt = Date.now()
      recorderRef.current = recorder
      recordStartedAtRef.current = startedAt
      setRecordSec(0)
      setVoice({ kind: 'recording', startedAt })
      recordTimerRef.current = window.setInterval(() => {
        setRecordSec((s) => {
          if (s + 1 >= MAX_RECORD_SEC) void stopRecording()
          return s + 1
        })
      }, 1000)
    } catch (err) {
      if (sealedRef.current) return
      // 关键：按 error.name 归因。NotFoundError 是「没有设备」，
      // NotAllowedError 才是「权限问题」——旧代码把两者都说成权限问题，
      // 让没有麦克风的用户去翻浏览器设置，而那里什么都查不出来。
      const failure = classifyMicError(err)
      resetVoiceState()
      setMicError(true)
      setError(micFailureReasonLine(failure))
      // 归因为设备/权限/不支持时同步收紧能力门禁，语音入口随之置灰。
      if (failure === 'no-device' || failure === 'permission-denied' || failure === 'unsupported') {
        setMicCapability(failure)
        setVoiceHint(micReasonLine(failure))
      }
    }
  }

  const stopRecording = async () => {
    if (sealIfExpired() || !state) return
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = null
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    const startedAt = recordStartedAtRef.current ?? Date.now()
    const durationSec = Math.max(1, Math.min(MAX_RECORD_SEC, Math.round((Date.now() - startedAt) / 1000)))
    recordStartedAtRef.current = null
    setVoice({ kind: 'transcribing' })
    try {
      const wav = await recorder.stop()
      if (sealedRef.current) return
      const { text } = await transcribeAnswer(state.sessionId, wav, access)
      if (sealedRef.current) return
      setVoice({ kind: 'review', transcript: text, edited: text, durationSec })
    } catch (err) {
      if (errorCodeOf(err) === 'INTERVIEW_DEADLINE_REACHED') sealAtDeadline()
      if (sealedRef.current) return
      const declined = aiDeclarationDeclineMessage(err)
      const msg = declined ?? userMessageOf(err, '语音转写失败')
      if (declined) {
        setVoice({ kind: 'idle' })
        setError(declined)
      } else if (!isAiOutage(err) && (msg.includes('未启用') || msg.includes('未配置'))) {
        fallbackToText(`${msg}，请使用文字输入完成练习`)
      } else {
        setVoice({ kind: 'idle' })
        setError(isAiOutage(err) ? INTERVIEW_AI_DOWN_HINT : `${msg}，可重新录音或改用文字输入`)
      }
    }
  }

  return { recordSec, maxRecordSec: MAX_RECORD_SEC, resetVoiceState, startRecording, stopRecording }
}
