import { useCallback, useEffect, useRef, useState } from 'react'
import { KIcon } from '../../components/kiosk-icon'
import { transcribeAssistantVoice } from '../../services/api'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { advisorErrorMessage, advisorUserReason } from './advisorUserCopy'
import { useVisibleHelpLine } from '../public-touch/publicTouchHooks'
import { getVoiceCapability } from '../../services/api/interview'
import { startWavRecorder, type WavRecorder } from '../../utils/wavRecorder'
import {
  classifyMicError,
  detectMicCapability,
  subscribeMicDeviceChange,
  MIC_REASON,
  type MicCapabilityState,
} from '../../utils/micCapability'
import { isTerminalKiosk } from '../../services/api/screensaver'

const MAX_RECORD_SECONDS = 58

type HoldState = 'idle' | 'recording' | 'transcribing'

function asrReason(configured: boolean | null): string | null {
  if (configured === false) return '语音转文字暂不可用，请使用文字输入。'
  return null
}

/**
 * 「按住说话」旁边常显的麦克风原因。通用表 MIC_REASON 在面试页也用，这里不改它，只在本页换两句：
 * · 权限没开：通用句让人去找现场的人，现场没有人；这里只说语音暂时用不了、文字照常，
 *   求助交给调用方传进来的服务电话句（后台读不到号码就是 null，什么都不加）。
 * · 没有麦克风：通用句叫人点一颗「重新检测麦克风」，本页没有这颗按钮（插上麦克风会自动重测）。
 * 其余状态沿用通用句，仍过一遍 advisorUserReason 的工程词过滤。
 */
function micReason(mic: MicCapabilityState, helpLine: string | null): string | null {
  if (mic === 'available') return null
  if (mic === 'permission-denied') {
    const base = '麦克风没有打开，语音暂时用不了，可以直接用文字提问。'
    return helpLine ? `${base}${helpLine}` : base
  }
  if (mic === 'no-device') return '本机没有麦克风，语音暂时用不了，可以直接用文字提问。'
  return advisorUserReason(MIC_REASON[mic], '麦克风暂不可用，请使用文字输入。')
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
  const helpLine = useVisibleHelpLine()
  const [asrConfigured, setAsrConfigured] = useState<boolean | null>(null)
  const [holdState, setHoldState] = useState<HoldState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<WavRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const releasedRef = useRef(false)

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
    releasedRef.current = false
    setHoldState('idle')
    setSeconds(0)
  }

  const stopAndTranscribe = async () => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = null
    clearTimer()
    pointerIdRef.current = null
    releasedRef.current = false
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
        setError(advisorErrorMessage(err, '语音转文字暂不可用，请使用文字输入。'))
      } else {
        setError(advisorErrorMessage(err, '语音转写失败，请改用文字输入'))
      }
      setHoldState('idle')
    }
  }

  const blockedReason = unavailable
    ? (unavailableReason ?? '当前不能录音，请使用文字输入')
    : asrConfigured === null || mic === null
      ? '正在检查语音输入是否可用…'
      : asrReason(asrConfigured)
        ?? micReason(mic, helpLine)

  const blocked = Boolean(blockedReason) || mic === null || asrConfigured !== true
  const pressed = holdState === 'recording'

  const onPointerDown = async (event: React.PointerEvent<HTMLButtonElement>) => {
    if (blocked || holdState !== 'idle') return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerIdRef.current = event.pointerId
    releasedRef.current = false
    setError(null)
    setSeconds(0)
    try {
      const recorder = await startWavRecorder()
      if (releasedRef.current || pointerIdRef.current !== event.pointerId) {
        recorder.cancel()
        pointerIdRef.current = null
        return
      }
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
          ? isTerminalKiosk()
            ? '麦克风不可用，可以改用文字输入；语音暂时用不了'
            : '麦克风权限未开启，请在地址栏允许麦克风后重试，或改用文字输入'
          : '麦克风不可用，请改用文字输入',
      )
      refreshMic()
      cancelRecorder()
    }
  }

  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== event.pointerId) return
    releasedRef.current = true
    if (holdState === 'recording') void stopAndTranscribe()
  }

  const onPointerCancel = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (pointerIdRef.current !== event.pointerId) return
    releasedRef.current = true
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
    ? `正在听… ${seconds} 秒，松手结束`
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
        onLostPointerCapture={onPointerCancel}
        onContextMenu={(event) => event.preventDefault()}
      >
        <KIcon name="mic" />
        {label}
      </button>
      <label className="assistant-hold-talk-switch" data-checked={sendDirect || undefined} data-blocked={blocked || undefined}>
        {/* 原生复选框视觉隐藏，整块 label 作 48px 触控开关；焦点环画在 label 上。 */}
        <input
          type="checkbox"
          className="sr-only assistant-hold-talk-input"
          checked={sendDirect}
          onChange={(event) => onSendDirectChange(event.target.checked)}
          disabled={blocked}
        />
        语音直接发送
      </label>
      {(blockedReason || error) && (
        <p className="assistant-hold-talk-reason" role="status">{unavailable ? blockedReason : error ?? blockedReason}</p>
      )}
    </div>
  )
}
