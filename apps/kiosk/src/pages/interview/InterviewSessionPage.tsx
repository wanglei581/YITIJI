// ============================================================
// 模拟面试 — 对话进行页（2C + 2C+ 语音回合制）。
//
// 语音主路径：面试官数字人播报问题 → 用户显式开始/结束录音 →
// 服务端转写 → 转写文本可编辑确认 → 既有 /answer。
// 文字输入是硬兜底；麦克风、TTS、ASR 任何一步失败都不能阻塞主流程。
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import { AlertCircleIcon } from 'lucide-react'
import { answerInterview, endInterview, fetchQuestionAudio, getVoiceCapability, transcribeAnswer } from '../../services/api/interview'
import { startWavRecorder, type WavRecorder } from '../../utils/wavRecorder'
import {
  classifyMicError,
  detectMicCapability,
  subscribeMicDeviceChange,
  MIC_FAILURE_REASON,
  MIC_REASON,
  MIC_STATUS_LABEL,
  type MicCapabilityState,
} from '../../utils/micCapability'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { InterviewAnswerDock } from './session/InterviewAnswerDock'
import { InterviewSessionPanels } from './session/InterviewSessionPanels'
import { InterviewShell } from './InterviewShell'
import type { InterviewMessage, InterviewSessionPhase, InterviewSessionRouteState, InterviewVoiceState } from './session/types'
import './interview-service-desk.css'
import { userMessageOf } from '../../services/api/userErrorMessage'

const advisorPortrait = '/assets/ai-advisor.png'

const INTERVIEWER_LABEL: Record<string, string> = {
  hr: 'HR 初筛',
  manager: '业务主管',
  tech: '技术面试官',
  campus: '校招面试官',
  final: '终面负责人',
}

const MAX_RECORD_SEC = 58

function speak(text: string, onState?: (speaking: boolean) => void): void {
  try {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    u.rate = 1
    u.onstart = () => onState?.(true)
    u.onend = () => onState?.(false)
    u.onerror = () => onState?.(false)
    window.speechSynthesis.speak(u)
  } catch {
    // TTS 不可用不阻塞面试主流程。
  }
}

export function InterviewSessionPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = location.state as InterviewSessionRouteState | null

  const [messages, setMessages] = useState<InterviewMessage[]>(() =>
    state?.firstQuestion ? [{ role: 'interviewer', content: state.firstQuestion }] : [],
  )
  const [questionIndex, setQuestionIndex] = useState(1)
  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState<InterviewSessionPhase>('answering')
  const [error, setError] = useState<string | null>(null)
  const [remainingSec, setRemainingSec] = useState((state?.durationMin ?? 5) * 60)
  const listRef = useRef<HTMLDivElement>(null)

  const [asrEnabled, setAsrEnabled] = useState(false)
  // null = 尚未探测完成。不预设 available，避免「语音回答可用」在探测出
  // 本机没有麦克风之前先闪一下。
  const [micCapability, setMicCapability] = useState<MicCapabilityState | null>(null)
  const [ttsOfficial, setTtsOfficial] = useState(false)
  const [mode, setMode] = useState<'voice' | 'text'>('text')
  const [voice, setVoice] = useState<InterviewVoiceState>({ kind: 'idle' })
  const [speaking, setSpeaking] = useState(false)
  const [voiceHint, setVoiceHint] = useState<string | null>(null)
  const [micError, setMicError] = useState(false)
  const recorderRef = useRef<WavRecorder | null>(null)
  const recordTimerRef = useRef<number | null>(null)
  const recordStartedAtRef = useRef<number | null>(null)
  const [recordSec, setRecordSec] = useState(0)
  const questionShownAtRef = useRef(Date.now())

  useBusyLock(
    phase === 'thinking' ||
    phase === 'finishing' ||
    voice.kind === 'requesting_permission' ||
    voice.kind === 'recording' ||
    voice.kind === 'transcribing',
  )

  const access = useMemo(
    () => ({ token: getToken(), accessToken: state?.accessToken ?? null }),
    [getToken, state?.accessToken],
  )
  const accessRef = useRef(access)
  accessRef.current = access

  useEffect(() => {
    let cancelled = false
    let asrOn = false

    // 探测的是「机器上有没有音频输入设备」，不是「浏览器有没有这个 API」。
    // 只在服务端 ASR 已启用时才自动切语音模式；能力探测本身始终执行，
    // 这样状态胶囊与常显原因永远反映真实硬件情况。
    const runDetect = (autoSwitch: boolean) => {
      void detectMicCapability().then((capability) => {
        if (cancelled) return
        setMicCapability(capability)
        if (asrOn && capability === 'available') {
          if (autoSwitch) setMode('voice')
        } else if (asrOn) {
          setVoiceHint(MIC_REASON[capability])
        }
      })
    }

    getVoiceCapability()
      .then(({ asrEnabled: asr, ttsEnabled }) => {
        if (cancelled) return
        asrOn = asr === true
        setAsrEnabled(asrOn)
        setTtsOfficial(ttsEnabled === true)
        runDetect(true)
      })
      .catch(() => { if (!cancelled) runDetect(false) })

    // 用户可能后插一个 USB 麦克风：热插拔后重新探测，语音入口自动恢复。
    const unsubscribe = subscribeMicDeviceChange(() => runDetect(false))
    return () => { cancelled = true; unsubscribe() }
  }, [])

  /** 手动重探（改权限后 / 插上麦克风后）。 */
  const recheckMic = () => {
    setMicCapability(null)
    setMicError(false)
    setError(null)
    void detectMicCapability().then((capability) => {
      setMicCapability(capability)
      setVoiceHint(MIC_REASON[capability])
      if (capability === 'available' && asrEnabled) setVoiceHint(null)
    })
  }

  const interviewerMsgs = messages.filter((m) => m.role === 'interviewer')
  const lastInterviewerMsg = interviewerMsgs.slice(-1)[0]?.content ?? ''
  const lastInterviewerTurnIdx = (interviewerMsgs.length - 1) * 2
  const lastInterviewerMessageIndex = messages.map((m) => m.role).lastIndexOf('interviewer')
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stopPlayback = () => {
    try { audioRef.current?.pause() } catch { /* noop */ }
    audioRef.current = null
    try { window.speechSynthesis?.cancel() } catch { /* noop */ }
    setSpeaking(false)
  }

  useEffect(() => {
    questionShownAtRef.current = Date.now()
    if (mode !== 'voice' || !lastInterviewerMsg || !state?.sessionId) return
    let cancelled = false
    if (ttsOfficial) {
      fetchQuestionAudio(state.sessionId, lastInterviewerTurnIdx, accessRef.current)
        .then(({ audio }) => {
          if (cancelled) return
          const el = new Audio(`data:audio/mpeg;base64,${audio}`)
          audioRef.current = el
          el.onplay = () => setSpeaking(true)
          el.onended = () => setSpeaking(false)
          el.onerror = () => { setSpeaking(false); speak(lastInterviewerMsg, setSpeaking) }
          void el.play().catch(() => speak(lastInterviewerMsg, setSpeaking))
        })
        .catch(() => { if (!cancelled) speak(lastInterviewerMsg, setSpeaking) })
    } else {
      speak(lastInterviewerMsg, setSpeaking)
    }
    return () => { cancelled = true; stopPlayback() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastInterviewerMsg, mode, ttsOfficial])

  useEffect(() => {
    const t = setInterval(() => setRemainingSec((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, phase, voice.kind])

  useEffect(() => () => {
    recorderRef.current?.cancel()
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    stopPlayback()
  }, [])

  if (!state?.sessionId) {
    return (
      <InterviewShell>
      <main data-kiosk-domain="interview" data-kiosk-screen="interview-session" className="interview-flow interview-session-invalid" data-visual-theme="service-desk" data-ux-density="touch">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-error-bg text-error-fg">
          <AlertCircleIcon className="h-9 w-9" aria-hidden="true" />
        </div>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-neutral-900">会话已失效，请重新开始</h1>
          <p className="mt-2 text-base text-neutral-500">公共设备不会保留面试会话状态，刷新或直接访问后需要重新创建练习。</p>
        </div>
        <Button size="lg" className="h-14 px-10 text-base" onClick={() => navigate('/interview/setup')}>
          重新开始练习
        </Button>
      </main>
      </InterviewShell>
    )
  }

  const resetVoiceState = () => {
    recorderRef.current?.cancel()
    recorderRef.current = null
    recordStartedAtRef.current = null
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    setRecordSec(0)
    setVoice({ kind: 'idle' })
  }

  const fallbackToText = (reason: string) => {
    resetVoiceState()
    setMode('text')
    setVoiceHint(reason)
  }

  const startRecording = async () => {
    // 能力门禁：去掉原生 disabled 后按钮真的可点，守卫必须在 handler 内部。
    if (micCapability !== null && micCapability !== 'available') {
      setMicError(true)
      setVoiceHint(MIC_REASON[micCapability])
      setError(MIC_FAILURE_REASON[micCapability])
      return
    }
    setError(null)
    setMicError(false)
    setVoiceHint(null)
    stopPlayback()
    setVoice({ kind: 'requesting_permission' })
    try {
      const recorder = await startWavRecorder()
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
      // 关键：按 error.name 归因。NotFoundError 是「没有设备」，
      // NotAllowedError 才是「权限问题」——旧代码把两者都说成权限问题，
      // 让没有麦克风的用户去翻浏览器设置，而那里什么都查不出来。
      const failure = classifyMicError(err)
      resetVoiceState()
      setMicError(true)
      setError(MIC_FAILURE_REASON[failure])
      // 归因为设备/权限/不支持时同步收紧能力门禁，语音入口随之置灰。
      if (failure === 'no-device' || failure === 'permission-denied' || failure === 'unsupported') {
        setMicCapability(failure)
        setVoiceHint(MIC_REASON[failure])
      }
    }
  }

  const stopRecording = async () => {
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
      const { text } = await transcribeAnswer(state.sessionId, wav, access)
      setVoice({ kind: 'review', transcript: text, edited: text, durationSec })
    } catch (err) {
      const msg = userMessageOf(err, '语音转写失败')
      if (msg.includes('未启用') || msg.includes('未配置')) {
        fallbackToText(`${msg}，请使用文字输入完成练习`)
      } else {
        setVoice({ kind: 'idle' })
        setError(`${msg}，可重新录音或改用文字输入`)
      }
    }
  }

  const submit = async (args: { text: string; skip: boolean; voiceMeta?: { transcript: string; edited: boolean; durationSec: number } }) => {
    if (voice.kind === 'requesting_permission' || voice.kind === 'transcribing') return
    const answer = args.text.trim()
    if (!args.skip && !answer) {
      setError('请输入回答内容，或选择跳过此题')
      return
    }
    setError(null)
    setMicError(false)
    setMessages((prev) => [...prev, { role: 'candidate', content: args.skip ? '跳过了这个问题' : answer, skipped: args.skip }])
    setDraft('')
    setVoice({ kind: 'idle' })
    setPhase('thinking')
    try {
      const textDuration = Math.min(600, Math.round((Date.now() - questionShownAtRef.current) / 1000))
      const res = await answerInterview(
        state.sessionId,
        args.skip
          ? { skip: true }
          : {
              answer,
              inputMode: args.voiceMeta ? 'voice' : 'text',
              ...(args.voiceMeta
                ? { transcriptText: args.voiceMeta.transcript, transcriptEdited: args.voiceMeta.edited, answerDurationSec: args.voiceMeta.durationSec }
                : { answerDurationSec: textDuration }),
            },
        access,
      )
      if (res.done) {
        setPhase('done_suggest')
        return
      }
      setMessages((prev) => [...prev, { role: 'interviewer', content: res.question ?? '' }])
      setQuestionIndex(res.questionIndex)
      setPhase('answering')
    } catch (err) {
      setError(userMessageOf(err, '提交失败，请重试'))
      setPhase('answering')
    }
  }

  const finish = async () => {
    if (voice.kind === 'requesting_permission' || voice.kind === 'transcribing' || phase === 'finishing') return
    stopPlayback()
    resetVoiceState()
    setPhase('finishing')
    setError(null)
    try {
      const report = await endInterview(state.sessionId, access)
      navigate('/interview/report', { state: { sessionId: state.sessionId, accessToken: state.accessToken, report } })
    } catch (err) {
      setError(userMessageOf(err, '报告生成失败，请重试'))
      setPhase(messages.some((m) => m.role === 'candidate' && !m.skipped) ? 'done_suggest' : 'answering')
    }
  }

  const interviewerLabel = INTERVIEWER_LABEL[state.interviewerType] ?? '面试官'
  const statusText =
    phase === 'thinking' ? '面试官正在分析你的回答…'
    : phase === 'finishing' ? '正在生成练习报告…'
    : phase === 'done_suggest' ? '本场问题已问完，可以结束并生成报告'
    : voice.kind === 'requesting_permission' ? '正在请求麦克风权限…'
    : voice.kind === 'recording' ? '正在听你的回答…'
    : voice.kind === 'transcribing' ? '正在转写你的回答…'
    : voice.kind === 'review' ? '请确认转写结果'
    : speaking ? '正在提问…'
    : '等待你开始回答'

  const timeUp = remainingSec === 0
  const busyTurn = phase === 'thinking' || phase === 'finishing'
  const voiceLocked = voice.kind === 'requesting_permission' || voice.kind === 'transcribing'
  const ttsLabel = ttsOfficial ? '官方语音播报' : '浏览器语音兜底'
  // 状态胶囊直述硬件事实：探测中不下结论，只有确实探到设备才敢说「可用」。
  const micStatusLabel = micCapability === null ? '正在检测麦克风…' : MIC_STATUS_LABEL[micCapability]
  const micStatusTone =
    micCapability === null ? 'blue' : micCapability === 'available' ? 'green' : 'red'
  // 语音入口是否放行 = 服务端 ASR 已启用 且 本机确实有可用麦克风。
  const voiceAvailable = asrEnabled && micCapability === 'available'
  // 门禁置灰就必须有常显原因，一个都不能漏：硬件原因优先，其次是服务端未启用。
  const micBlockedReason =
    micCapability === null ? null
    : micCapability !== 'available' ? MIC_REASON[micCapability]
    : !asrEnabled ? '语音转写服务未启用，请用文字作答'
    : null

  return (
    <InterviewShell>
    <main data-kiosk-domain="interview" data-kiosk-screen="interview-session" className="interview-flow interview-session" data-visual-theme="service-desk" data-ux-density="touch">
      <InterviewSessionPanels
        advisorPortrait={advisorPortrait}
        interviewerLabel={interviewerLabel}
        position={state.position}
        remainingSec={remainingSec}
        questionIndex={questionIndex}
        questionTarget={state.questionTarget}
        statusText={statusText}
        timeUp={timeUp}
        voiceKind={voice.kind}
        ttsLabel={ttsLabel}
        ttsOfficial={ttsOfficial}
        micStatusLabel={micStatusLabel}
        micStatusTone={micStatusTone}
        speaking={speaking}
        lastInterviewerMsg={lastInterviewerMsg}
        voiceHint={voiceHint}
        messages={messages}
        lastInterviewerMessageIndex={lastInterviewerMessageIndex}
        phase={phase}
        listRef={listRef}
      />

      <InterviewAnswerDock
        micError={micError}
        error={error}
        voiceLocked={voiceLocked}
        busyTurn={busyTurn}
        phase={phase}
        mode={mode}
        voice={voice}
        recordSec={recordSec}
        maxRecordSec={MAX_RECORD_SEC}
        draft={draft}
        voiceAvailable={voiceAvailable}
        micBlockedReason={micBlockedReason}
        onRecheckMic={recheckMic}
        onDraftChange={setDraft}
        onReviewChange={(edited) => setVoice((current) => current.kind === 'review' ? { ...current, edited } : current)}
        onReviewSubmit={() => {
          if (voice.kind !== 'review') return
          void submit({
            text: voice.edited,
            skip: false,
            voiceMeta: { transcript: voice.transcript, edited: voice.edited.trim() !== voice.transcript.trim(), durationSec: voice.durationSec },
          })
        }}
        onRetryVoice={() => void startRecording()}
        onStopRecording={() => void stopRecording()}
        onUseText={() => {
          // 麦克风失败、转写确认和语音空闲态共用幂等清场，再回到文字输入。
          resetVoiceState()
          setMode('text')
          setMicError(false)
        }}
        onUseVoice={() => {
          // 能力门禁用 aria-disabled（触屏无 hover，原因常显在按钮下方），
          // 因此按钮仍可点击，短路守卫必须放在 handler 内部。
          if (!voiceAvailable) {
            if (micCapability !== null && micCapability !== 'available') {
              setVoiceHint(MIC_REASON[micCapability])
            }
            return
          }
          setMode('voice'); setMicError(false); setError(null)
        }}
        onSkip={() => void submit({ text: '', skip: true })}
        onSubmitText={() => void submit({ text: draft, skip: false })}
        onFinish={() => void finish()}
      />
    </main>
    </InterviewShell>
  )
}
