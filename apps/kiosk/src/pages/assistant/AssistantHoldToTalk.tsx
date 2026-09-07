import { useCallback, useEffect, useRef, useState } from 'react'
import { KIcon } from '../../components/kiosk-icon'
import { transcribeAssistantVoice } from '../../services/api'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { getVoiceCapability } from '../../services/api/interview'
import { startWavRecorder, type WavRecorder } from '../../utils/wavRecorder'
import {
  classifyMicError,
  detectMicCapability,
  subscribeMicDeviceChange,
  MIC_REASON,
  type MicCapabilityState,
} from '../../utils/micCapability'

const MAX_RECORD_SECONDS = 58

type HoldState = 'idle' | 'recording' | 'transcribing'

function asrReason(configured: boolean | null): string | null {
  if (configured === false) return '语音转写未启用，请使用文字输入。恢复条件：管理员配置 ASR 服务后刷新本页。'
  return null
}

function errorCodeOf(error: unknown): string {
  if (error instanceof ApiHttpError) return error.code
  if (typeof error === 'object' && error && 'code' in error) return String((error as { code: unknown }).code)
  return ''
}

interface AssistantHoldToTalkProps {
  unavailable: boolean
  unavailableReason?: string
  sendDirect: boolean
  onSendDirectChange: (value: boolean) => void
  onTranscript: (text: string, sendDirect: boolean) => void
}

export function AssistantHoldToTalk({
  unavailable,
  unavailableReason,
  sendDirect,
  onSendDirectChange,
  onTranscript,
}: AssistantHoldToTalkProps) {
  const [mic, setMic] = useState<MicCapabilityState | null>(null)
  const [asrConfigured, setAsrConfigured] = useState<boolean | null>(null)
  const [holdState, setHoldState] = useState<HoldState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<WavRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)

  const refreshMic = useCallback(() => {
    void detectMicCapability().then(setMic)
  }, [])

  useEffect(() => {
    refreshMic()
    return subscribeMicDeviceChange(refreshMic)
  }, [refreshMic])

  useEffect(() => {
    let cancelled = false
    void getVoiceCapability()
      .then((cap) => { if (!cancelled) setAsrConfigured(cap.asrEnabled === true) })
      .catch(() => { if (!cancelled) setAsrConfigured(false) })
    return () => { cancelled = true }
  }, [])

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    startedAtRef.current = null
  }

  const cancelRecorder = () => {
    if (recorderRef.current) {
      recorderRef.current.cancel()
      recorderRef.current = null
    }
    clearTimer()
    pointerIdRef.current = null
    setHoldState('idle')
    setSeconds(0)
  }

  const stopAndTranscribe = async () => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = null
    clearTimer()
    pointerIdRef.current = null
    setHoldState('transcribing')
    setError(null)
    try {
      const audio = await recorder.stop()
      const result = await transcribeAssistantVoice(audio)
      const text = result.text.trim()
      if (!text) {
        setError('没有识别到有效文字，请重试或改用文字输入')
        setHoldState('idle')
        return
      }
      setHoldState('idle')
      onTranscript(text, sendDirect)
    } catch (err) {
      const code = errorCodeOf(err)
      if (code === 'ASR_NOT_CONFIGURED') {
        setAsrConfigured(false)
        setError('语音转写未启用，请使用文字输入。恢复条件：管理员配置 ASR 服务后刷新本页。')
      } else {
        setError(userMessageOf(err, '语音转写失败，请改用文字输入'))
      }
      setHoldState('idle')
    }
  }

  const blockedReason = unavailable
    ? (unavailableReason ?? '当前不能录音，请使用文字输入')
    : asrConfigured === null || mic === null
      ? '正在检测麦克风和语音转写是否可用…'
      : asrReason(asrConfigured)
        ?? (mic !== 'available' ? MIC_REASON[mic] : null)

  const blocked = Boolean(blockedReason) || mic === null || asrConfigured !== true
  const pressed = holdState === 'recording'

  const onPointerDown = async (event: React.PointerEvent<HTMLButtonElement>) => {
    if (blocked || holdState !== 'idle') return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerIdRef.current = event.pointerId
    setError(null)
    setSeconds(0)
    try {
      const recorder = await startWavRecorder()
      recorderRef.current = recorder
      startedAtRef.current = Date.now()
      setHoldState('recording')
      timerRef.current = window.setInterval(() => {
        if (!startedAtRef.current) return
        const elapsed = Math.floor((Date.now() - startedAtRef.current) / 1000)
        setSeconds(elapsed)
        if (elapsed >= MAX_RECORD_SECONDS) void stopAndTranscribe()
      }, 250)
    } catch (err) {
      const failure = classifyMicError(err)
      setError(
        failure === 'permission-denied'
          ? '麦克风权限未开启，请在地址栏允许麦克风后重试，或改用文字输入'
          : '麦克风不可用，请改用文字输入',
      )
      refreshMic()
      cancelRecorder()
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== event.pointerId) return
    if (holdState === 'recording') void stopAndTranscribe()
  }

  const onPointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== event.pointerId) return
    cancelRecorder()
  }

  useEffect(() => () => {
    if (recorderRef.current) {
      recorderRef.current.cancel()
      recorderRef.current = null
    }
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const label = holdState === 'recording'
    ? `正在听… ${seconds}s，松手结束`
    : holdState === 'transcribing'
      ? '正在转写…'
      : '按住说话'

  return (
    <div className="assistant-hold-talk">
      <button
        type="button"
        className="assistant-tool-button assistant-hold-talk-btn"
        aria-pressed={pressed}
        aria-disabled={blocked || holdState === 'transcribing' || undefined}
        onPointerDown={(event) => { if (blocked) return; void onPointerDown(event) }}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(event) => event.preventDefault()}
      >
        <KIcon name="mic" />
        {label}
      </button>
      <label className="assistant-hold-talk-switch">
        <input
          type="checkbox"
          checked={sendDirect}
          onChange={(event) => onSendDirectChange(event.target.checked)}
          disabled={blocked}
        />
        语音直接发送
      </label>
      {blockedReason && (
        <p className="assistant-hold-talk-reason" role="status">{blockedReason}</p>
      )}
      {error && !blockedReason && (
        <p className="assistant-hold-talk-reason" role="status">{error}</p>
      )}
    </div>
  )
}
