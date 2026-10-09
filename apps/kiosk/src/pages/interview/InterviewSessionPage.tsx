// 模拟面试作答页。文字是硬兜底；麦克风、播报、转写任何一步失败都不阻塞。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { InterviewSessionInvalid } from './session/InterviewSessionInvalid'
import { resolveInterviewSessionState } from './session/resolveInterviewSessionState'
import { fetchQuestionAudio, getVoiceCapability, transcribeAnswer } from '../../services/api/interview'
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
import { InterviewNetworkBar } from './session/InterviewNetworkError'
import { InterviewReportPending } from './session/InterviewReportPending'
import { InterviewSessionBar } from './session/InterviewSessionBar'
import { InterviewSessionPanels } from './session/InterviewSessionPanels'
import { speakInterview } from './session/speakInterview'
import { useInterviewLivePersist } from './session/useInterviewLivePersist'
import { InterviewShell } from './InterviewShell'
import type { InterviewMessage, InterviewSessionPhase, InterviewSessionRouteState, InterviewVoiceState } from './session/types'
import { INTERVIEW_AI_DOWN_HINT, INTERVIEW_STAGE_COPY, emphasizedTitle, type InterviewStage } from './interviewWorkbenchModel'
import { readInterviewWorkbenchSession } from './interviewWorkbenchSession'
import './interview-service-desk.css'
import './styles/interview-workbench-qx.css'
import './styles/interview-qx2.css'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { isAiOutage } from '../../ai/aiOutage'
import { aiDeclarationDeclineMessage } from '../../ai/aiDeclarationErrors'
import type { InterviewFinishRecovery } from './session/interviewAnswerRecovery'
import { finishInterview, submitInterviewAnswer } from './session/interviewTurnActions'

const advisorPortrait = '/assets/ai-advisor.png'

const INTERVIEWER_LABEL: Record<string, string> = {
  hr: 'HR 面试',
  manager: '业务主管',
  tech: '技术面试官',
  campus: '校招面试官',
  final: '终面负责人',
}

const MAX_RECORD_SEC = 58

export function InterviewSessionPage({ onGoStage }: { onGoStage?: (stage: InterviewStage) => void } = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const storedLive = readInterviewWorkbenchSession()?.live
  // 设置屏的选择在进场时定死。纯文字即使语音可用也不自动切过去。
  const entryInteractionMode = storedLive?.interactionMode === 'voice' ? 'voice' : 'text'
  const state = resolveInterviewSessionState(location.state as InterviewSessionRouteState | null)

  const [messages, setMessages] = useState<InterviewMessage[]>(() =>
    storedLive?.messages?.length
      ? storedLive.messages
      : state?.firstQuestion ? [{ role: 'interviewer', content: state.firstQuestion }] : [],
  )
  const [questionIndex, setQuestionIndex] = useState(storedLive?.questionIndex ?? 1)
  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState<InterviewSessionPhase>('answering')
  const [error, setError] = useState<string | null>(null)
  const [networkFailure, setNetworkFailure] = useState(false)
  const [omitPrintAnswers, setOmitPrintAnswers] = useState(storedLive?.omitPrintAnswers ?? false)
  // 只认本场亲眼成功过的非跳过回答。乐观写进对话的那条不算，刷新也不能把没成功的说成已保存。
  const [answersRecorded, setAnswersRecorded] = useState(
    Boolean(state?.sessionId && storedLive?.sessionId === state.sessionId && storedLive.answersRecorded),
  )
  const [finishRecovery, setFinishRecovery] = useState<InterviewFinishRecovery | null>(null)
  const [remainingSec, setRemainingSec] = useState(storedLive?.remainingSec ?? (state?.durationMin ?? 5) * 60)
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

  useInterviewLivePersist({
    state,
    messages,
    questionIndex,
    remainingSec,
    omitPrintAnswers,
    answersRecorded,
    interactionMode: entryInteractionMode,
  })

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
    // 自动切语音只发生在设置屏选了「语音回合」，并且服务端识别开着、麦克风可用。
    // 选纯文字时探测照旧做，状态胶囊仍说真话，但不改作答方式。
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
        runDetect(entryInteractionMode === 'voice')
      })
      .catch(() => { if (!cancelled) runDetect(false) })

    // 用户可能后插一个 USB 麦克风：热插拔后重新探测，语音入口自动恢复。
    const unsubscribe = subscribeMicDeviceChange(() => runDetect(false))
    return () => { cancelled = true; unsubscribe() }
  }, [entryInteractionMode])

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
          el.onerror = () => { setSpeaking(false); speakInterview(lastInterviewerMsg, setSpeaking) }
          void el.play().catch(() => speakInterview(lastInterviewerMsg, setSpeaking))
        })
        .catch(() => { if (!cancelled) speakInterview(lastInterviewerMsg, setSpeaking) })
    } else {
      speakInterview(lastInterviewerMsg, setSpeaking)
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
      <InterviewSessionInvalid
        onRestart={() => onGoStage ? onGoStage('setup') : navigate('/interview/setup')}
        onOpenReports={() => onGoStage ? onGoStage('reports') : navigate('/interview/reports')}
      />
    )
  }

  if (phase === 'finishing') {
    return (
      <InterviewReportPending
        onOpenTips={() => (onGoStage ? onGoStage('tips') : navigate('/interview/tips'))}
      />
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

  const submit = (args: { text: string; skip: boolean; voiceMeta?: { transcript: string; edited: boolean; durationSec: number } }) => {
    void submitInterviewAnswer({
      args, state, access, messages, draft, voiceKind: voice.kind, questionShownAtRef,
      setMessages, setDraft, setMode, setVoice, setPhase, setError, setMicError, setNetworkFailure,
      setFinishRecovery, setAnswersRecorded, setQuestionIndex,
    })
  }

  const finish = () => {
    void finishInterview({
      state, access, phase, voiceKind: voice.kind, messages, answersRecorded, omitPrintAnswers,
      onGoStage, navigate, stopPlayback, resetVoiceState,
      setPhase, setError, setMicError, setFinishRecovery,
    })
  }

  const interviewerLabel = INTERVIEWER_LABEL[state.interviewerType] ?? '面试官'
  const statusText =
    phase === 'thinking' ? '面试官正在分析你的回答…'
    : phase === 'done_suggest' ? '本场问题已问完，可以结束并生成报告'
    : voice.kind === 'requesting_permission' ? '正在请求麦克风权限…'
    : voice.kind === 'recording' ? '正在听你的回答…'
    : voice.kind === 'transcribing' ? '正在转写你的回答…'
    : voice.kind === 'review' ? '请确认转写结果'
    : speaking ? '正在提问…'
    : '等待你开始回答'

  const timeUp = remainingSec === 0
  const busyTurn = phase === 'thinking'
  const voiceLocked = voice.kind === 'requesting_permission' || voice.kind === 'transcribing'
  const ttsLabel = ttsOfficial ? '官方语音播报' : '本机语音播报'
  // 状态胶囊直述硬件事实：探测中不下结论，只有确实探到设备才敢说「可用」。
  const micStatusLabel = micCapability === null ? '正在检测麦克风…' : MIC_STATUS_LABEL[micCapability]
  const micStatusTone =
    micCapability === null ? 'blue' : micCapability === 'available' ? 'green' : 'red'
  // 语音入口是否放行 = 服务端 ASR 已启用 且 本机确实有可用麦克风。
  const voiceAvailable = asrEnabled && micCapability === 'available'
  const voiceEntryBlocked = entryInteractionMode === 'voice' && micCapability !== null && !voiceAvailable
  // 门禁置灰就必须有常显原因，一个都不能漏：硬件原因优先，其次是服务端未启用。
  const micBlockedReason =
    micCapability === null ? null
    : micCapability !== 'available' ? MIC_REASON[micCapability]
    : !asrEnabled ? '语音转写服务未启用，请用文字作答'
    : null

  const copy = INTERVIEW_STAGE_COPY.session
  const titleParts = emphasizedTitle(copy)

  return (
    <InterviewShell
      title={<>第 {questionIndex} 题，<em>{titleParts.em}</em>。</>}
      subtitle={copy.subtitle}
      status={{ tone: timeUp ? 'warn' : 'ok', label: timeUp ? '练习时间已到' : 'AI 模拟面试' }}
      live={voice.kind === 'recording'}
      ctabar={networkFailure ? (
        <InterviewNetworkBar
          voiceAvailable={voiceAvailable}
          voiceReason={micBlockedReason}
          onBackToText={() => setNetworkFailure(false)}
          onRetryVoice={() => {
            setNetworkFailure(false)
            setMode('voice')
            setMicError(false)
            setError(null)
          }}
        />
      ) : (
        <InterviewSessionBar
          mode={mode}
          phase={phase}
          voiceKind={voice.kind}
          voiceAvailable={voiceAvailable}
          busy={busyTurn || voiceLocked}
          onFinish={() => void finish()}
          onSubmit={() => void submit({ text: draft, skip: false })}
          onUseText={() => { resetVoiceState(); setMode('text'); setMicError(false) }}
          onStop={() => void stopRecording()}
          onConfirm={() => {
            if (voice.kind !== 'review') return
            void submit({ text: voice.edited, skip: false, voiceMeta: { transcript: voice.transcript, edited: voice.edited.trim() !== voice.transcript.trim(), durationSec: voice.durationSec } })
          }}
          onUseVoice={() => {
            if (!voiceAvailable) return
            setMode('voice'); setMicError(false); setError(null)
          }}
        />
      )}
    >
    <div data-kiosk-domain="interview" data-kiosk-screen="interview-session" data-qx-interview="" className="interview-flow interview-session" data-visual-theme="service-desk" data-ux-density="touch">
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
      >
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
        networkFailure={networkFailure}
        voiceEntryBlocked={voiceEntryBlocked}
        onBackToText={() => setNetworkFailure(false)}
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
        finishRecovery={finishRecovery}
        onContinueAnswering={() => {
          setFinishRecovery(null)
          setError(null)
          setPhase('answering')
        }}
        onLeaveInterview={() => navigate('/interview-service')}
        onOpenTips={() => (onGoStage ? onGoStage('tips') : navigate('/interview/tips'))}
        onRetryReport={() => void finish()}
        omitPrintAnswers={omitPrintAnswers}
        onOmitPrintAnswersChange={setOmitPrintAnswers}
      />
      </InterviewSessionPanels>
    </div>
    </InterviewShell>
  )
}
