import type { ElementType, RefObject } from 'react'
import {
  BotIcon,
  Loader2Icon,
  MicIcon,
  ShieldCheckIcon,
  TimerIcon,
  Volume2Icon,
} from 'lucide-react'
import type { InterviewMessage, InterviewSessionPhase, InterviewVoiceState } from './types'
import { formatInterviewClock } from './types'
import { InterviewTopbar } from '../InterviewTopbar'

type PillTone = 'gray' | 'blue' | 'red' | 'green'

function StatusPill({ icon: Icon, label, tone = 'gray' }: { icon: ElementType; label: string; tone?: PillTone }) {
  return (
    <span className={`interview-session__status-pill is-${tone}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  )
}

interface InterviewSessionPanelsProps {
  advisorPortrait: string
  interviewerLabel: string
  position: string
  remainingSec: number
  questionIndex: number
  questionTarget: number
  statusText: string
  timeUp: boolean
  voiceKind: InterviewVoiceState['kind']
  ttsLabel: string
  ttsOfficial: boolean
  micStatusLabel: string
  micStatusTone: PillTone
  speaking: boolean
  lastInterviewerMsg: string
  voiceHint: string | null
  messages: InterviewMessage[]
  lastInterviewerMessageIndex: number
  phase: InterviewSessionPhase
  listRef: RefObject<HTMLDivElement>
}

export function InterviewSessionPanels({
  advisorPortrait,
  interviewerLabel,
  position,
  remainingSec,
  questionIndex,
  questionTarget,
  statusText,
  timeUp,
  voiceKind,
  ttsLabel,
  ttsOfficial,
  micStatusLabel,
  micStatusTone,
  speaking,
  lastInterviewerMsg,
  voiceHint,
  messages,
  lastInterviewerMessageIndex,
  phase,
  listRef,
}: InterviewSessionPanelsProps) {
  const progress = Math.min(100, Math.round((questionIndex / Math.max(1, questionTarget)) * 100))
  const previousQuestion = messages
    .filter((message) => message.role === 'interviewer')
    .slice(-2, -1)[0]?.content

  return (
    <>
      <InterviewTopbar />

      <div className="interview-session__pagehead">
        <div className="interview-session__identity">
          <div className="interview-session__mark"><BotIcon aria-hidden="true" /></div>
          <div className="min-w-0 flex-1">
            <h1>模拟面试 · {position}</h1>
            <p>模拟练习，仅供参考 · 按自己的真实经历作答即可</p>
          </div>
        </div>
        <div className="interview-session__status-row">
          <StatusPill icon={MicIcon} label={micStatusLabel} tone={micStatusTone} />
          <StatusPill icon={Volume2Icon} label={ttsLabel} tone={ttsOfficial ? 'green' : 'blue'} />
        </div>
      </div>

      <div className="interview-session__content">
        <section className="interview-session__progress-card">
          <span className="interview-session__question-count">第 {questionIndex} 题<small>/ 目标 {questionTarget} 题</small></span>
          <div className="interview-session__progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
          <span className={`interview-session__timer ${timeUp ? 'is-warning' : ''}`}>
            <TimerIcon aria-hidden="true" />
            本场剩余 {formatInterviewClock(remainingSec)}
          </span>
        </section>

        <section className="interview-session__question-card">
          <div className="interview-session__card-head">
            <span className="interview-session__card-icon">
              <img src={advisorPortrait} alt="" className={speaking ? 'is-speaking' : ''} />
            </span>
            <div>
              <h2>{interviewerLabel} · AI 面试官</h2>
              <p>{voiceKind === 'recording' ? '正在记录你的回答' : '经历类问题 · 建议用 STAR 法则作答'}</p>
            </div>
            <span className="interview-session__voice-status">
              {speaking && <span className="interview-session__wave"><i /><i /><i /><i /><i /></span>}
              <span>{statusText}</span>
            </span>
          </div>
          <p className="interview-session__question-text">「{lastInterviewerMsg || '等待面试官出题'}」</p>
          {previousQuestion && <p className="interview-session__previous-question"><b>上一题</b>{previousQuestion}</p>}
        </section>

        {(voiceHint || timeUp) && (
          <section className="interview-session__notice" role="status">
            <ShieldCheckIcon aria-hidden="true" />
            <div>
              {voiceHint && <p>{voiceHint}</p>}
              {timeUp && phase !== 'finishing' && <p>练习时长已到，建议回答完当前问题后点击「结束面试」。</p>}
            </div>
          </section>
        )}

        <div ref={listRef} className="interview-session__history" role="log" aria-live="polite" aria-relevant="additions text">
          <div className="interview-session__history-title">最近对话</div>
          {messages.map((message, index) => (
            <article
              key={`${message.role}-${index}`}
              className={[
                'interview-session__history-item',
                message.role === 'interviewer' ? 'is-interviewer' : 'is-candidate',
                index === lastInterviewerMessageIndex && message.role === 'interviewer' && phase === 'answering' ? 'is-current' : '',
                message.skipped ? 'is-skipped' : '',
              ].filter(Boolean).join(' ')}
            >
              <b>{message.role === 'interviewer' ? interviewerLabel : message.skipped ? '跳过记录' : '你的回答'}</b>
              <span>{message.content}</span>
            </article>
          ))}
          {(phase === 'thinking' || phase === 'finishing') && (
            <div className="interview-session__thinking">
              <Loader2Icon className="animate-spin" aria-hidden="true" />
              {phase === 'finishing' ? '正在生成练习报告…' : '面试官正在分析你的回答…'}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
