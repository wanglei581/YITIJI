// ============================================================
// 模拟面试 — 对话进行页（2C）。
//
// 竖屏一体机布局：顶部面试官卡（类型/状态/剩余时间/进度）→ 对话记录 →
// 底部回答输入 + 提交/跳过/结束。文字对话为主路径（MVP），不依赖语音/摄像头。
// 计时为客户端引导（到点提示收尾），题量由服务端硬控制；busy 锁防 idle 误登出。
// 公共设备：会话状态只在路由 state（内存），离开即丢。
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import { AlertCircleIcon, Loader2Icon, SendIcon, SkipForwardIcon, SquareIcon, UserRoundIcon } from 'lucide-react'
import { answerInterview, endInterview } from '../../services/api/interview'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'

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

interface Msg { role: 'interviewer' | 'candidate'; content: string; skipped?: boolean }

function fmtClock(sec: number): string {
  const m = Math.floor(Math.max(sec, 0) / 60)
  const s = Math.max(sec, 0) % 60
  return `${m}:${String(s).padStart(2, '0')}`
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

  useBusyLock(true) // 面试中：屏保/idle 登出豁免

  // 倒计时（引导性质：到点提示尽快收尾，不强制中断作答中的回合）
  useEffect(() => {
    const t = setInterval(() => setRemainingSec((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, phase])

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

  const submit = async (skip: boolean) => {
    const answer = draft.trim()
    if (!skip && !answer) {
      setError('请输入回答内容，或选择跳过此题')
      return
    }
    setError(null)
    setMessages((prev) => [...prev, { role: 'candidate', content: skip ? '（跳过了这个问题）' : answer, skipped: skip }])
    setDraft('')
    setPhase('thinking')
    try {
      const res = await answerInterview(state.sessionId, skip ? { skip: true } : { answer }, access)
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
    : '等待你的回答'
  const timeUp = remainingSec === 0

  return (
    <div className="flex h-full flex-col">
      {/* 面试官卡 */}
      <div className="border-b border-gray-100 bg-white px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary-50">
            <UserRoundIcon className="h-7 w-7 text-primary-600" aria-hidden="true" />
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
        ) : (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={phase !== 'answering'}
              rows={3}
              maxLength={2000}
              placeholder="在这里输入你的回答…"
              className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-base leading-relaxed focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50"
            />
            <div className="mt-2 flex gap-2">
              <Button
                size="lg"
                className="h-14 flex-1 text-base"
                disabled={phase !== 'answering'}
                onClick={() => void submit(false)}
              >
                <SendIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                提交回答
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-14 min-w-[120px]"
                disabled={phase !== 'answering'}
                onClick={() => void submit(true)}
              >
                <SkipForwardIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                跳过
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-14 min-w-[120px] text-red-600"
                disabled={phase === 'thinking' || phase === 'finishing'}
                onClick={() => void finish()}
              >
                <SquareIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
                结束面试
              </Button>
            </div>
          </>
        )}
        <p className="mt-2 text-center text-[11px] text-gray-400">
          模拟练习仅供本人参考，对话内容不会发送给任何企业
        </p>
      </div>
    </div>
  )
}
