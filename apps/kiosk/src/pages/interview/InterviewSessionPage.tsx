// ============================================================
// 模拟面试 — 对话进行页（2C + 2C+ 语音回合制）。
//
// 语音主路径（ASR 启用 + 麦克风可用时）：
//   面试官数字人播报问题（浏览器本地 TTS，播报文本已过服务端禁词扫描）→
//   「开始回答」→ 录音（16k WAV，显式开始/结束，不做按住说话）→「结束回答」→
//   服务端转写 → 转写文本可编辑确认 →「确认提交」走既有 /answer。
// 文字兜底（硬要求）：麦克风权限失败 / ASR 未配置或失败 → 自动切文字输入并提示；
//   任何时刻可手动「改用文字输入」。语音/TTS 能力绝不阻塞主流程。
// 隐私：音频只在内存（录音 → 转写后即弃），不落本地、不持久化；回答耗时随
//   /answer 提交用于报告"时间控制"维度（无音频特征分析，不评语速语调情绪）。
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  KeyboardIcon,
  Loader2Icon,
  MicIcon,
  PencilLineIcon,
  SendIcon,
  SkipForwardIcon,
  SquareIcon,
  Volume2Icon,
} from 'lucide-react'
import { answerInterview, endInterview, getVoiceCapability, transcribeAnswer } from '../../services/api/interview'
import { startWavRecorder, type WavRecorder } from '../../utils/wavRecorder'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
// 复用 /assistant 数字人「小青」照片资源(public 静态资源,与 AiAdvisorCall 同源)
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
  hr: 'HR 初筛', manager: '业务主管', tech: '技术面试官', campus: '校招面试官', final: '终面负责人',
}

const MAX_RECORD_SEC = 58 // 百度短语音识别上限 60s，留余量自动停止

interface Msg { role: 'interviewer' | 'candidate'; content: string; skipped?: boolean }

type VoiceState =
  | { kind: 'idle' }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'transcribing' }
  | { kind: 'review'; transcript: string; edited: string; durationSec: number }

function fmtClock(sec: number): string {
  const m = Math.floor(Math.max(sec, 0) / 60)
  const s = Math.max(sec, 0) % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 浏览器本地 TTS 播报（失败静默；播报文本来自服务端，已过禁词扫描）。 */
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
  } catch { /* TTS 不可用不阻塞 */ }
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

  // ── 2C+ 语音态 ──────────────────────────────────────────────
  const [voiceAvailable, setVoiceAvailable] = useState(false) // ASR 服务端可用
  const [mode, setMode] = useState<'voice' | 'text'>('text')
  const [voice, setVoice] = useState<VoiceState>({ kind: 'idle' })
  const [speaking, setSpeaking] = useState(false)
  const [voiceHint, setVoiceHint] = useState<string | null>(null)
  const recorderRef = useRef<WavRecorder | null>(null)
  const recordTimerRef = useRef<number | null>(null)
  const [recordSec, setRecordSec] = useState(0)
  const questionShownAtRef = useRef(Date.now())

  useBusyLock(true) // 面试中：屏保/idle 登出豁免

  // 语音能力探测：ASR 启用且浏览器支持 getUserMedia → 默认语音模式
  useEffect(() => {
    let cancelled = false
    getVoiceCapability()
      .then(({ asrEnabled }) => {
        if (cancelled) return
        const micSupported = !!navigator.mediaDevices?.getUserMedia
        if (asrEnabled && micSupported) {
          setVoiceAvailable(true)
          setMode('voice')
        } else if (asrEnabled && !micSupported) {
          setVoiceHint('当前设备不支持麦克风，已切换为文字输入')
        }
      })
      .catch(() => undefined) // 探测失败 → 保持文字模式
    return () => { cancelled = true }
  }, [])

  // TTS 播报最新面试官问题（仅语音模式）
  const lastInterviewerMsg = messages.filter((m) => m.role === 'interviewer').slice(-1)[0]?.content ?? ''
  useEffect(() => {
    if (mode === 'voice' && lastInterviewerMsg) speak(lastInterviewerMsg, setSpeaking)
    questionShownAtRef.current = Date.now()
    return () => { try { window.speechSynthesis?.cancel() } catch { /* noop */ } }
  }, [lastInterviewerMsg, mode])

  useEffect(() => {
    const t = setInterval(() => setRemainingSec((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, phase, voice.kind])

  // 卸载兜底：释放麦克风
  useEffect(() => () => { recorderRef.current?.cancel(); if (recordTimerRef.current) clearInterval(recordTimerRef.current) }, [])

  const access = useMemo(
    () => ({ token: getToken(), accessToken: state?.accessToken ?? null }),
    [getToken, state?.accessToken],
  )

  if (!state?.sessionId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <AlertCircleIcon className="h-10 w-10 text-gray-300" aria-hidden="true" />
        <p className="text-base text-gray-500">练习会话已失效（公共设备不保留会话状态）</p>
        <Button size="lg" onClick={() => navigate('/interview/setup')}>重新开始练习</Button>
      </div>
    )
  }

  const fallbackToText = (reason: string) => {
    recorderRef.current?.cancel()
    recorderRef.current = null
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    setVoice({ kind: 'idle' })
    setMode('text')
    setVoiceHint(reason)
  }

  // ── 语音回合 ────────────────────────────────────────────────
  const startRecording = async () => {
    setError(null)
    try { window.speechSynthesis?.cancel() } catch { /* noop */ }
    try {
      recorderRef.current = await startWavRecorder()
      setVoice({ kind: 'recording', startedAt: Date.now() })
      setRecordSec(0)
      recordTimerRef.current = window.setInterval(() => {
        setRecordSec((s) => {
          if (s + 1 >= MAX_RECORD_SEC) void stopRecording()
          return s + 1
        })
      }, 1000)
    } catch {
      fallbackToText('无法访问麦克风（未授权或被占用），已切换为文字输入')
    }
  }

  const stopRecording = async () => {
    const recorder = recorderRef.current
    if (!recorder) return
    recorderRef.current = null
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    const durationSec = recordSec
    setVoice({ kind: 'transcribing' })
    try {
      const wav = await recorder.stop()
      const { text } = await transcribeAnswer(state.sessionId, wav, access)
      setVoice({ kind: 'review', transcript: text, edited: text, durationSec })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '语音转写失败'
      if (msg.includes('未启用') || msg.includes('未配置')) {
        fallbackToText(`${msg}，已切换为文字输入`)
      } else {
        setVoice({ kind: 'idle' })
        setError(`${msg}，可重新录音或改用文字输入`)
      }
    }
  }

  const cancelRecording = () => {
    recorderRef.current?.cancel()
    recorderRef.current = null
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    setVoice({ kind: 'idle' })
  }

  // ── 提交（语音确认 / 文字 / 跳过共用）────────────────────────
  const submit = async (args: { text: string; skip: boolean; voiceMeta?: { transcript: string; edited: boolean; durationSec: number } }) => {
    const answer = args.text.trim()
    if (!args.skip && !answer) {
      setError('请输入回答内容，或选择跳过此题')
      return
    }
    setError(null)
    setMessages((prev) => [...prev, { role: 'candidate', content: args.skip ? '（跳过了这个问题）' : answer, skipped: args.skip }])
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
    try { window.speechSynthesis?.cancel() } catch { /* noop */ }
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
    phase === 'thinking' ? '正在分析你的回答…'
    : phase === 'finishing' ? '正在生成练习报告…'
    : phase === 'done_suggest' ? '本场问题已问完，可以结束并生成报告'
    : speaking ? '正在提问…'
    : voice.kind === 'recording' ? '正在听你的回答…'
    : voice.kind === 'transcribing' ? '正在转写你的回答…'
    : '等待你的回答'
  const timeUp = remainingSec === 0
  const busyTurn = phase === 'thinking' || phase === 'finishing'

  return (
    <div className="flex h-full flex-col">
      {/* 数字人面试官卡 */}
      <div className="border-b border-gray-100 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <img
              src={advisorPortrait}
              alt="AI 数字人面试官"
              className={[
                'h-16 w-16 rounded-2xl object-cover ring-2 transition-shadow',
                speaking ? 'ring-primary-400 shadow-[0_0_0_4px_rgba(22,119,255,0.15)]' : 'ring-gray-100',
              ].join(' ')}
            />
            {speaking && (
              <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-white">
                <Volume2Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            )}
            {voice.kind === 'recording' && (
              <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white motion-safe:animate-pulse">
                <MicIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-gray-900">{interviewerLabel} · 模拟练习</p>
            <p className="mt-0.5 truncate text-xs text-gray-500">目标岗位：{state.position} · {statusText}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className={['font-mono text-xl font-bold tabular-nums', timeUp ? 'text-orange-500' : 'text-gray-900'].join(' ')}>
              {fmtClock(remainingSec)}
            </p>
            <p className="text-xs text-gray-400">第 {questionIndex} / {state.questionTarget} 题</p>
          </div>
        </div>
        {voiceHint && (
          <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">{voiceHint}</p>
        )}
        {timeUp && phase !== 'finishing' && (
          <p className="mt-2 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-700">
            练习时长已到，建议回答完当前问题后点击「结束并生成报告」
          </p>
        )}
      </div>

      {/* 对话记录 */}
      <div ref={listRef} className="flex-1 overflow-y-auto bg-[#f5f7fa] px-5 py-4">
        <div className="flex flex-col gap-3">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'interviewer' ? 'flex justify-start' : 'flex justify-end'}>
              <div
                className={[
                  'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
                  m.role === 'interviewer'
                    ? 'rounded-tl-sm border border-gray-100 bg-white text-gray-800 shadow-sm'
                    : m.skipped
                      ? 'rounded-tr-sm bg-gray-200 text-gray-500'
                      : 'rounded-tr-sm bg-primary-600 text-white',
                ].join(' ')}
              >
                {m.content}
              </div>
            </div>
          ))}
          {(phase === 'thinking' || phase === 'finishing') && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-gray-100 bg-white px-4 py-3 text-sm text-gray-400 shadow-sm">
                <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
                {phase === 'finishing' ? '正在生成练习报告…' : '面试官正在思考…'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 输入与操作 */}
      <div className="border-t border-gray-100 bg-white px-5 py-4">
        {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>}

        {phase === 'done_suggest' ? (
          <Button size="lg" className="h-14 w-full text-base" onClick={() => void finish()}>
            结束并生成练习报告
          </Button>
        ) : mode === 'voice' && voice.kind === 'review' ? (
          /* 转写确认/编辑 */
          <>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-gray-500">
              <PencilLineIcon className="h-3.5 w-3.5" aria-hidden="true" />
              转写结果（可直接修改，确认后提交）
            </p>
            <textarea
              value={voice.edited}
              onChange={(e) => setVoice({ ...voice, edited: e.target.value })}
              rows={4}
              maxLength={2000}
              className="w-full resize-none rounded-xl border border-primary-200 bg-primary-50/40 px-4 py-3 text-base leading-relaxed focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100"
            />
            <div className="mt-2 flex gap-2">
              <Button
                size="lg"
                className="h-14 flex-1 text-base"
                disabled={busyTurn}
                onClick={() => void submit({
                  text: voice.edited,
                  skip: false,
                  voiceMeta: { transcript: voice.transcript, edited: voice.edited.trim() !== voice.transcript.trim(), durationSec: voice.durationSec },
                })}
              >
                <SendIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                确认提交
              </Button>
              <Button size="lg" variant="secondary" className="h-14 min-w-[130px]" disabled={busyTurn} onClick={() => void startRecording()}>
                <MicIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                重新录音
              </Button>
            </div>
          </>
        ) : mode === 'voice' ? (
          /* 语音回合主操作 */
          <>
            {voice.kind === 'recording' ? (
              <Button size="lg" className="h-16 w-full bg-red-500 text-base hover:bg-red-600" onClick={() => void stopRecording()}>
                <SquareIcon className="mr-2 h-5 w-5" aria-hidden="true" />
                结束回答（{fmtClock(MAX_RECORD_SEC - recordSec)} 后自动结束）
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
            <div className="mt-2 flex gap-2">
              <Button
                size="lg"
                variant="secondary"
                className="h-12 flex-1"
                disabled={busyTurn || voice.kind === 'recording' || voice.kind === 'transcribing'}
                onClick={() => { cancelRecording(); setMode('text') }}
              >
                <KeyboardIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                改用文字输入
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-12 min-w-[110px]"
                disabled={busyTurn || voice.kind !== 'idle'}
                onClick={() => void submit({ text: '', skip: true })}
              >
                <SkipForwardIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                跳过
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-12 min-w-[110px] text-red-600"
                disabled={busyTurn}
                onClick={() => { cancelRecording(); void finish() }}
              >
                <SquareIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                结束面试
              </Button>
            </div>
          </>
        ) : (
          /* 文字兜底 */
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={busyTurn}
              rows={3}
              maxLength={2000}
              placeholder="在这里输入你的回答…"
              className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-base leading-relaxed focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50"
            />
            <div className="mt-2 flex gap-2">
              <Button size="lg" className="h-14 flex-1 text-base" disabled={busyTurn} onClick={() => void submit({ text: draft, skip: false })}>
                <SendIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                提交回答
              </Button>
              {voiceAvailable && (
                <Button size="lg" variant="secondary" className="h-14 min-w-[130px]" disabled={busyTurn} onClick={() => setMode('voice')}>
                  <MicIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  改用语音回答
                </Button>
              )}
              <Button size="lg" variant="secondary" className="h-14 min-w-[110px]" disabled={busyTurn} onClick={() => void submit({ text: '', skip: true })}>
                <SkipForwardIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                跳过
              </Button>
              <Button size="lg" variant="secondary" className="h-14 min-w-[110px] text-red-600" disabled={busyTurn} onClick={() => void finish()}>
                <SquareIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                结束面试
              </Button>
            </div>
          </>
        )}
        <p className="mt-2 text-center text-[11px] text-gray-400">
          模拟练习仅供本人参考，对话内容不会发送给任何企业；语音仅用于本次转写，不保存原始音频
        </p>
      </div>
    </div>
  )
}
