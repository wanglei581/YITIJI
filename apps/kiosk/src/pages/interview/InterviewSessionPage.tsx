// ============================================================
// 模拟面试 — 对话进行页（2C + 2C+ 语音回合制）。
//
// 语音主路径：面试官数字人播报问题 → 用户显式开始/结束录音 →
// 服务端转写 → 转写文本可编辑确认 → 既有 /answer。
// 文字输入是硬兜底；麦克风、TTS、ASR 任何一步失败都不能阻塞主流程。
// ============================================================

import { useEffect, useMemo, useRef, useState, type ElementType } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  BotIcon,
  CheckCircle2Icon,
  ClockIcon,
  FileTextIcon,
  KeyboardIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  MicIcon,
  PencilLineIcon,
  RotateCcwIcon,
  SendIcon,
  ShieldCheckIcon,
  SkipForwardIcon,
  SquareIcon,
  TimerIcon,
  UserRoundIcon,
  Volume2Icon,
} from 'lucide-react'
import { answerInterview, endInterview, fetchQuestionAudio, getVoiceCapability, transcribeAnswer } from '../../services/api/interview'
import { startWavRecorder, type WavRecorder } from '../../utils/wavRecorder'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'

const advisorPortrait = '/assets/ai-advisor.png'

interface SessionState {
  sessionId: string
  accessToken?: string
  questionTarget: number
  durationMin: number
  interviewerType: string
  position: string
  firstQuestion?: string
  firstQType?: string
}

const INTERVIEWER_LABEL: Record<string, string> = {
  hr: 'HR 初筛',
  manager: '业务主管',
  tech: '技术面试官',
  campus: '校招面试官',
  final: '终面负责人',
}

const MAX_RECORD_SEC = 58

interface Msg {
  role: 'interviewer' | 'candidate'
  content: string
  skipped?: boolean
}

type VoiceState =
  | { kind: 'idle' }
  | { kind: 'requesting_permission' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'transcribing' }
  | { kind: 'review'; transcript: string; edited: string; durationSec: number }

function fmtClock(sec: number): string {
  const m = Math.floor(Math.max(sec, 0) / 60)
  const s = Math.max(sec, 0) % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

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

function StatusPill({ icon: Icon, label, tone = 'gray' }: { icon: ElementType; label: string; tone?: 'gray' | 'blue' | 'red' | 'green' }) {
  const toneClass = {
    gray: 'border-neutral-200 bg-neutral-50 text-neutral-600',
    blue: 'border-primary-100 bg-primary-50 text-primary-700',
    red: 'border-error/20 bg-error-bg text-error-fg',
    green: 'border-success-bg bg-success-bg text-success-fg',
  }[tone]
  return (
    <span className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${toneClass}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  )
}

export function InterviewSessionPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = location.state as SessionState | null

  const [messages, setMessages] = useState<Msg[]>(() =>
    state?.firstQuestion ? [{ role: 'interviewer', content: state.firstQuestion }] : [],
  )
  const [questionIndex, setQuestionIndex] = useState(1)
  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState<'answering' | 'thinking' | 'finishing' | 'done_suggest'>('answering')
  const [error, setError] = useState<string | null>(null)
  const [remainingSec, setRemainingSec] = useState((state?.durationMin ?? 5) * 60)
  const listRef = useRef<HTMLDivElement>(null)

  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const [ttsOfficial, setTtsOfficial] = useState(false)
  const [mode, setMode] = useState<'voice' | 'text'>('text')
  const [voice, setVoice] = useState<VoiceState>({ kind: 'idle' })
  const [speaking, setSpeaking] = useState(false)
  const [voiceHint, setVoiceHint] = useState<string | null>(null)
  const [micError, setMicError] = useState(false)
  const recorderRef = useRef<WavRecorder | null>(null)
  const recordTimerRef = useRef<number | null>(null)
  const recordStartedAtRef = useRef<number | null>(null)
  const [recordSec, setRecordSec] = useState(0)
  const questionShownAtRef = useRef(Date.now())

  useBusyLock(true)

  const access = useMemo(
    () => ({ token: getToken(), accessToken: state?.accessToken ?? null }),
    [getToken, state?.accessToken],
  )
  const accessRef = useRef(access)
  accessRef.current = access

  useEffect(() => {
    let cancelled = false
    getVoiceCapability()
      .then(({ asrEnabled, ttsEnabled }) => {
        if (cancelled) return
        setTtsOfficial(ttsEnabled === true)
        const micSupported = !!navigator.mediaDevices?.getUserMedia
        if (asrEnabled && micSupported) {
          setVoiceAvailable(true)
          setMode('voice')
        } else if (asrEnabled && !micSupported) {
          setVoiceHint('当前设备不支持麦克风，请使用文字输入完成练习')
        }
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

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
      <div className="flex h-full flex-col items-center justify-center gap-5 bg-[#f5f7fa] px-6">
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
      </div>
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
    } catch {
      resetVoiceState()
      setMicError(true)
      setError('无法访问麦克风，请检查浏览器权限或改用文字输入')
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
      const msg = err instanceof Error ? err.message : '语音转写失败'
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
      setError(err instanceof Error ? err.message : '提交失败，请重试')
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
      setError(err instanceof Error ? err.message : '报告生成失败，请重试')
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
  const micStatusLabel = micError || !voiceAvailable ? '麦克风不可用' : '语音回答可用'
  const micStatusTone = micError || !voiceAvailable ? 'red' : 'green'

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f5f7fa]">
      <div className="border-b border-neutral-100 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
            <BotIcon className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xl font-bold text-neutral-900">模拟面试</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-neutral-500">
              <span>{interviewerLabel}</span>
              <span className="text-neutral-300">/</span>
              <span className="max-w-[22rem] truncate">目标岗位：{state.position}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-right">
            <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-2">
              <p className={['font-mono text-2xl font-bold tabular-nums', timeUp ? 'text-warning-fg' : 'text-neutral-900'].join(' ')}>
                {fmtClock(remainingSec)}
              </p>
              <p className="text-xs text-neutral-400">剩余时间</p>
            </div>
            <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-4 py-2">
              <p className="text-2xl font-bold text-neutral-900">{questionIndex}<span className="text-sm text-neutral-400">/{state.questionTarget}</span></p>
              <p className="text-xs text-neutral-400">当前题目</p>
            </div>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusPill icon={TimerIcon} label={statusText} tone={voice.kind === 'requesting_permission' ? 'blue' : voice.kind === 'recording' ? 'red' : 'gray'} />
          <StatusPill icon={Volume2Icon} label={ttsLabel} tone={ttsOfficial ? 'green' : 'blue'} />
          <StatusPill icon={MicIcon} label={micStatusLabel} tone={micStatusTone} />
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col gap-4">
          <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col items-center text-center">
              <div className="relative">
                <img
                  src={advisorPortrait}
                  alt="AI 数字人面试官小青"
                  className={[
                    'h-40 w-40 rounded-2xl object-cover ring-4 transition-shadow',
                    speaking ? 'ring-primary-200 shadow-[0_0_0_8px_rgba(22,119,255,0.10)]' : 'ring-neutral-100',
                  ].join(' ')}
                />
                {voice.kind === 'recording' && (
                  <span className="absolute -bottom-2 -right-2 flex h-11 w-11 items-center justify-center rounded-full bg-error text-white motion-safe:animate-pulse">
                    <MicIcon className="h-5 w-5" aria-hidden="true" />
                  </span>
                )}
                {speaking && (
                  <span className="absolute -bottom-2 -right-2 flex h-11 w-11 items-center justify-center rounded-full bg-primary-600 text-white">
                    <Volume2Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                )}
              </div>
              <p className="mt-4 text-lg font-bold text-neutral-900">小青 · {interviewerLabel}</p>
              <p className="mt-1 text-sm text-neutral-500">{statusText}</p>
            </div>

            <div className="mt-5 space-y-3">
              <div className="rounded-lg border border-primary-100 bg-primary-50 px-4 py-3">
                <p className="text-xs font-semibold text-primary-700">当前问题</p>
                <p className="mt-1 line-clamp-4 text-sm leading-relaxed text-neutral-800">{lastInterviewerMsg || '等待面试官出题'}</p>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <div className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2 text-sm text-neutral-600">
                  <UserRoundIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
                  训练报告仅给本人查看，可按需打印
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-neutral-100 px-3 py-2 text-sm text-neutral-600">
                  <ShieldCheckIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
                  语音仅用于本次转写，不保存原始音频
                </div>
              </div>
            </div>
          </section>

          {(voiceHint || timeUp) && (
            <section className="rounded-xl border border-primary-100 bg-primary-50 p-4 text-sm text-primary-700">
              {voiceHint && <p>{voiceHint}</p>}
              {timeUp && phase !== 'finishing' && (
                <p className={voiceHint ? 'mt-2' : ''}>练习时长已到，建议回答完当前问题后点击「结束面试」。</p>
              )}
            </section>
          )}
        </aside>

        <section className="flex min-h-0 flex-col rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
            <div className="flex items-center gap-2">
              <MessageSquareTextIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
              <h2 className="text-base font-semibold text-neutral-900">对话记录</h2>
            </div>
            <p className="text-xs text-neutral-400">自动滚动到底部</p>
          </div>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto bg-[#f8fafc] px-5 py-4">
            <div className="flex flex-col gap-4">
              {messages.map((m, i) => {
                const isInterviewer = m.role === 'interviewer'
                const isCurrent = i === lastInterviewerMessageIndex && isInterviewer && phase === 'answering'
                return (
                  <div key={`${m.role}-${i}`} className={isInterviewer ? 'flex justify-start' : 'flex justify-end'}>
                    <div className={['max-w-[78%]', isInterviewer ? 'text-left' : 'text-right'].join(' ')}>
                      <p className="mb-1 px-1 text-xs text-neutral-400">{isInterviewer ? interviewerLabel : m.skipped ? '跳过记录' : '你的回答'}</p>
                      <div
                        className={[
                          'rounded-2xl px-4 py-3 text-base leading-relaxed shadow-sm',
                          isInterviewer
                            ? isCurrent
                              ? 'rounded-tl-sm border-2 border-primary-200 bg-white text-neutral-900'
                              : 'rounded-tl-sm border border-neutral-100 bg-white text-neutral-800'
                            : m.skipped
                              ? 'rounded-tr-sm border border-neutral-200 bg-neutral-100 text-neutral-500'
                              : 'rounded-tr-sm bg-primary-600 text-white',
                        ].join(' ')}
                      >
                        {m.content}
                      </div>
                    </div>
                  </div>
                )
              })}
              {(phase === 'thinking' || phase === 'finishing') && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-neutral-100 bg-white px-4 py-3 text-sm text-neutral-500 shadow-sm">
                    <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {phase === 'finishing' ? '正在生成练习报告…' : '面试官正在分析你的回答…'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="border-t border-neutral-100 bg-white px-5 py-4 shadow-[0_-4px_16px_rgba(15,23,42,0.04)]">
        {micError && (
          <div className="mb-3 flex flex-col gap-3 rounded-xl border border-error/30 bg-error-bg p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-error-fg" aria-hidden="true" />
              <div>
                <p className="font-semibold text-error-fg">无法访问麦克风，请检查浏览器权限或改用文字输入</p>
                <p className="mt-0.5 text-sm text-error-fg">确认浏览器已允许麦克风，并检查设备是否被其他程序占用。</p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="lg" className="h-14 px-5 text-base" disabled={voiceLocked || busyTurn} onClick={() => void startRecording()}>
                <RotateCcwIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                重新尝试语音
              </Button>
              <Button size="lg" variant="secondary" className="h-14 px-5 text-base" disabled={voiceLocked || busyTurn} onClick={() => { setMode('text'); setMicError(false) }}>
                <KeyboardIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                改用文字输入
              </Button>
            </div>
          </div>
        )}
        {error && !micError && <p className="mb-3 rounded-lg bg-error-bg px-4 py-3 text-sm font-medium text-error-fg">{error}</p>}

        {phase === 'done_suggest' ? (
          <Button size="lg" className="h-14 w-full text-base" disabled={voiceLocked} onClick={() => void finish()}>
            <FileTextIcon className="mr-2 h-5 w-5" aria-hidden="true" />
            结束并生成练习报告
          </Button>
        ) : mode === 'voice' && voice.kind === 'review' ? (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <label className="block">
              <span className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-neutral-600">
                <PencilLineIcon className="h-4 w-4" aria-hidden="true" />
                转写结果（可编辑，确认后提交）
              </span>
              <textarea
                value={voice.edited}
                onChange={(e) => setVoice({ ...voice, edited: e.target.value })}
                rows={3}
                maxLength={2000}
                className="w-full resize-none rounded-xl border border-primary-200 bg-primary-50/40 px-4 py-3 text-base leading-relaxed focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                size="lg"
                className="h-14 min-w-[150px] text-base"
                disabled={busyTurn}
                onClick={() => void submit({
                  text: voice.edited,
                  skip: false,
                  voiceMeta: { transcript: voice.transcript, edited: voice.edited.trim() !== voice.transcript.trim(), durationSec: voice.durationSec },
                })}
              >
                <CheckCircle2Icon className="mr-1.5 h-5 w-5" aria-hidden="true" />
                确认提交
              </Button>
              <Button size="lg" variant="secondary" className="h-14 min-w-[132px]" disabled={busyTurn} onClick={() => void startRecording()}>
                <MicIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                重新录音
              </Button>
              <Button size="lg" variant="secondary" className="h-14 min-w-[150px]" disabled={busyTurn} onClick={() => { setMode('text'); setVoice({ kind: 'idle' }) }}>
                <KeyboardIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                改用文字输入
              </Button>
            </div>
          </div>
        ) : mode === 'voice' ? (
          <>
            {voice.kind === 'requesting_permission' ? (
              <Button size="lg" className="h-16 w-full text-base" disabled>
                <Loader2Icon className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                正在请求麦克风权限…
              </Button>
            ) : voice.kind === 'recording' ? (
              <Button size="lg" className="h-16 w-full bg-error text-base hover:bg-error" onClick={() => void stopRecording()}>
                <SquareIcon className="mr-2 h-5 w-5" aria-hidden="true" />
                结束回答（已录 {fmtClock(recordSec)}，{fmtClock(MAX_RECORD_SEC - recordSec)} 后自动结束）
              </Button>
            ) : voice.kind === 'transcribing' ? (
              <Button size="lg" className="h-16 w-full text-base" disabled>
                <Loader2Icon className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
                正在转写你的回答…
              </Button>
            ) : (
              <Button size="lg" className="h-16 w-full text-base" disabled={busyTurn} onClick={() => void startRecording()}>
                <MicIcon className="mr-2 h-5 w-5" aria-hidden="true" />
                开始回答（语音）
              </Button>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="lg"
                variant="secondary"
                className="h-14 flex-1 text-base"
                disabled={busyTurn || voice.kind === 'recording' || voiceLocked}
                onClick={() => { resetVoiceState(); setMode('text'); setMicError(false) }}
              >
                <KeyboardIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                改用文字输入
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-14 min-w-[120px] text-base"
                disabled={busyTurn || voice.kind !== 'idle'}
                onClick={() => void submit({ text: '', skip: true })}
              >
                <SkipForwardIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                跳过
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-14 min-w-[132px] text-base text-error-fg"
                disabled={busyTurn || voiceLocked}
                onClick={() => void finish()}
              >
                <SquareIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                结束面试
              </Button>
            </div>
          </>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busyTurn}
              rows={3}
              maxLength={2000}
              placeholder="在这里输入你的回答…"
              className="w-full resize-none rounded-xl border border-neutral-200 px-4 py-3 text-base leading-relaxed focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="lg" className="h-14 min-w-[150px] text-base" disabled={busyTurn} onClick={() => void submit({ text: draft, skip: false })}>
                <SendIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                提交回答
              </Button>
              {voiceAvailable && (
                <Button size="lg" variant="secondary" className="h-14 min-w-[150px]" disabled={busyTurn} onClick={() => { setMode('voice'); setMicError(false); setError(null) }}>
                  <MicIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  改用语音回答
                </Button>
              )}
              <Button size="lg" variant="secondary" className="h-14 min-w-[110px]" disabled={busyTurn} onClick={() => void submit({ text: '', skip: true })}>
                <SkipForwardIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                跳过
              </Button>
              <Button size="lg" variant="secondary" className="h-14 min-w-[120px] text-error-fg" disabled={busyTurn} onClick={() => void finish()}>
                <SquareIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                结束面试
              </Button>
            </div>
          </div>
        )}
        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-neutral-400">
          <ClockIcon className="h-3.5 w-3.5" aria-hidden="true" />
          模拟练习仅供本人参考，对话内容不会发送给任何企业
        </div>
      </div>
    </div>
  )
}
