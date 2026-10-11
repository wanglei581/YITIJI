// 模拟面试作答页。文字是硬兜底；麦克风、播报、转写任何一步失败都不阻塞。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { InterviewSessionInvalid } from './session/InterviewSessionInvalid'
import { resolveInterviewSessionState } from './session/resolveInterviewSessionState'
import { fetchQuestionAudio, getVoiceCapability } from '../../services/api/interview'
import {
  detectMicCapability,
  subscribeMicDeviceChange,
  MIC_STATUS_LABEL,
  micReasonLine,
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
import { useInterviewSessionDeadline } from './session/useInterviewDeadline'
import { InterviewTimeUp } from './session/InterviewTimeUp'
import { useInterviewClosure } from './session/useInterviewClosure'
import { useInterviewRecording } from './session/useInterviewRecording'
import { useInterviewLivePersist } from './session/useInterviewLivePersist'
import { InterviewShell } from './InterviewShell'
import type { InterviewMessage, InterviewSessionPhase, InterviewSessionRouteState, InterviewVoiceState } from './session/types'
import { INTERVIEW_STAGE_COPY, emphasizedTitle, type InterviewStage } from './interviewWorkbenchModel'
import { readInterviewWorkbenchSession } from './interviewWorkbenchSession'
import './interview-service-desk.css'
import './styles/interview-workbench-qx.css'
import './styles/interview-qx2.css'
import { errorCodeOf } from '../../services/api/userErrorMessage'
import type { InterviewFinishRecovery } from './session/interviewAnswerRecovery'
import { submitInterviewAnswer } from './session/interviewTurnActions'

const advisorPortrait = '/assets/ai-advisor.png'

const INTERVIEWER_LABEL: Record<string, string> = {
  hr: 'HR 面试',
  manager: '业务主管',
  tech: '技术面试官',
  campus: '校招面试官',
  final: '终面负责人',
}



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
  const [phase, setPhaseState] = useState<InterviewSessionPhase>('answering')
  const [error, setError] = useState<string | null>(null)
  const [networkFailure, setNetworkFailure] = useState(false)
  const [omitPrintAnswers, setOmitPrintAnswers] = useState(storedLive?.omitPrintAnswers ?? false)
  // 只认本场亲眼成功过的非跳过回答。乐观写进对话的那条不算，刷新也不能把没成功的说成已保存。
  const [answersRecorded, setAnswersRecorded] = useState(
    Boolean(state?.sessionId && storedLive?.sessionId === state.sessionId && storedLive.answersRecorded),
  )
  const [finishRecovery, setFinishRecovery] = useState<InterviewFinishRecovery | null>(null)
  const sealedRef = useRef(false)
  const sealCallbackRef = useRef<() => void>(() => undefined)
  const { remainingSec, deadlineAtLocalMs, deadlineSource, markDeadlineReached } = useInterviewSessionDeadline(state, storedLive, getToken, () => sealCallbackRef.current())
  const deadlineRef = useRef(deadlineAtLocalMs)
  deadlineRef.current = deadlineAtLocalMs
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
    deadlineAtLocalMs,
    deadlineSource,
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
          setVoiceHint(micReasonLine(capability))
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
      setVoiceHint(micReasonLine(capability))
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

  // 定时器被浏览器延后时，入口仍按绝对截止时刻封场。
  const sealIfExpired = () => {
    if (!sealedRef.current && Date.now() >= deadlineRef.current) sealCallbackRef.current()
    return sealedRef.current
  }
  const { recordSec, maxRecordSec, resetVoiceState, startRecording, stopRecording } = useInterviewRecording({
    state, access, sealedRef, sealIfExpired, sealAtDeadline: () => sealCallbackRef.current(), micCapability,
    setMicCapability, setMicError, setVoiceHint, setError, setVoice, setMode, stopPlayback,
  })
  const { sealed, timeUpVariant, pendingAnswerRef, setPhase, sealAtDeadline, finish, retryReport } = useInterviewClosure({
    state, access, phase, sealedRef, onSealed: markDeadlineReached, voiceKind: voice.kind, messages, answersRecorded, omitPrintAnswers,
    onGoStage, navigate, stopPlayback, resetVoiceState,
    setPhase: setPhaseState, setError, setMicError, setFinishRecovery,
  })
  sealCallbackRef.current = sealAtDeadline

  useEffect(() => {
    questionShownAtRef.current = Date.now()
    if (sealedRef.current || mode !== 'voice' || !lastInterviewerMsg || !state?.sessionId) return
    let cancelled = false
    if (ttsOfficial) {
      fetchQuestionAudio(state.sessionId, lastInterviewerTurnIdx, accessRef.current)
        .then(({ audio }) => {
          if (cancelled || sealedRef.current) return
          const el = new Audio(`data:audio/mpeg;base64,${audio}`)
          audioRef.current = el
          el.onplay = () => { if (!sealedRef.current) setSpeaking(true) }
          el.onended = () => { if (!sealedRef.current) setSpeaking(false) }
          el.onerror = () => { if (!sealedRef.current) { setSpeaking(false); speakInterview(lastInterviewerMsg, setSpeaking) } }
          void el.play().catch(() => { if (!sealedRef.current) speakInterview(lastInterviewerMsg, setSpeaking) })
        })
        .catch((err) => {
          if (errorCodeOf(err) === 'INTERVIEW_DEADLINE_REACHED') sealCallbackRef.current()
          if (!cancelled && !sealedRef.current) speakInterview(lastInterviewerMsg, setSpeaking)
        })
    } else {
      speakInterview(lastInterviewerMsg, setSpeaking)
    }
    return () => { cancelled = true; stopPlayback() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastInterviewerMsg, mode, ttsOfficial])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, phase, voice.kind])

  useEffect(() => () => {
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

  if (phase === 'closed') {
    return <InterviewTimeUp variant={timeUpVariant} answersRecorded={answersRecorded}
      onLeave={() => navigate('/interview-service')}
      onRestart={() => onGoStage ? onGoStage('setup') : navigate('/interview/setup')}
      onRetry={retryReport}
      onOpenTips={() => (onGoStage ? onGoStage('tips') : navigate('/interview/tips'))} />
  }

  if (phase === 'finishing' || remainingSec === 0) {
    return (
      <InterviewReportPending
        endedAtDeadline={sealed || remainingSec === 0}
        onOpenTips={() => (onGoStage ? onGoStage('tips') : navigate('/interview/tips'))}
      />
    )
  }

  const submit = (args: { text: string; skip: boolean; voiceMeta?: { transcript: string; edited: boolean; durationSec: number } }) => {
    if (sealIfExpired()) return
    const pending = submitInterviewAnswer({
      args, state, access, messages, draft, sealedRef, sealAtDeadline, voiceKind: voice.kind, questionShownAtRef,
      setMessages, setDraft, setMode, setVoice, setPhase, setError, setMicError, setNetworkFailure,
      setFinishRecovery, setAnswersRecorded, setQuestionIndex,
    })
    pendingAnswerRef.current = pending
    void pending.finally(() => { if (pendingAnswerRef.current === pending) pendingAnswerRef.current = null })
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
    : micCapability !== 'available' ? micReasonLine(micCapability)
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
        maxRecordSec={maxRecordSec}
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
              setVoiceHint(micReasonLine(micCapability))
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
