import type { ElementType, RefObject } from 'react'
import {
  BotIcon,
  Loader2Icon,
  MessageSquareTextIcon,
  MicIcon,
  ShieldCheckIcon,
  TimerIcon,
  UserRoundIcon,
  Volume2Icon,
} from 'lucide-react'
import type { InterviewMessage, InterviewSessionPhase, InterviewVoiceState } from './types'
import { formatInterviewClock } from './types'

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
  return (
    <>
      <header className="interview-session__header">
        <div className="interview-session__identity">
          <div className="interview-session__mark"><BotIcon aria-hidden="true" /></div>
          <div className="min-w-0 flex-1">
            <p className="interview-session__eyebrow">青序 · 模拟面试</p>
            <h1>和小青完成这轮岗位练习</h1>
            <p>{interviewerLabel} · <span>目标岗位：{position}</span></p>
          </div>
        </div>
        <div className="interview-session__metrics">
          <div>
            <strong className={timeUp ? 'is-warning' : ''}>{formatInterviewClock(remainingSec)}</strong>
            <span>剩余时间</span>
          </div>
          <div>
            <strong>{questionIndex}<small>/{questionTarget}</small></strong>
            <span>当前题目</span>
          </div>
        </div>
        <div className="interview-session__status-row">
          <StatusPill icon={TimerIcon} label={statusText} tone={voiceKind === 'requesting_permission' ? 'blue' : voiceKind === 'recording' ? 'red' : 'gray'} />
          <StatusPill icon={Volume2Icon} label={ttsLabel} tone={ttsOfficial ? 'green' : 'blue'} />
          <StatusPill icon={MicIcon} label={micStatusLabel} tone={micStatusTone} />
        </div>
      </header>

      <div className="interview-session__workspace">
        <aside className="interview-session__advisor-column">
          <section className="interview-session__advisor-card">
            <div className="interview-session__portrait-wrap">
              <img src={advisorPortrait} alt="AI 数字人面试官小青" className={speaking ? 'is-speaking' : ''} />
              {voiceKind === 'recording' && <span className="interview-session__portrait-state is-recording"><MicIcon aria-hidden="true" /></span>}
              {speaking && <span className="interview-session__portrait-state"><Volume2Icon aria-hidden="true" /></span>}
            </div>
            <h2>小青 · {interviewerLabel}</h2>
            <p>{statusText}</p>
            <div className="interview-session__current-question">
              <span>当前问题</span>
              <p>{lastInterviewerMsg || '等待面试官出题'}</p>
            </div>
            <div className="interview-session__privacy-list">
              <p><UserRoundIcon aria-hidden="true" />训练报告仅给本人查看，可按需打印</p>
              <p><ShieldCheckIcon aria-hidden="true" />语音仅用于本次转写，不保存原始音频</p>
            </div>
          </section>
          {(voiceHint || timeUp) && (
            <section className="interview-session__notice" role="status">
              {voiceHint && <p>{voiceHint}</p>}
              {timeUp && phase !== 'finishing' && <p>练习时长已到，建议回答完当前问题后点击「结束面试」。</p>}
            </section>
          )}
        </aside>

        <section className="interview-session__conversation">
          <div className="interview-session__conversation-title">
            <div><MessageSquareTextIcon aria-hidden="true" /><h2>对话记录</h2></div>
            <p>自动滚动到底部</p>
          </div>
          <div ref={listRef} className="interview-session__messages" role="log" aria-live="polite" aria-relevant="additions text">
            {messages.map((message, index) => {
              const isInterviewer = message.role === 'interviewer'
              const isCurrent = index === lastInterviewerMessageIndex && isInterviewer && phase === 'answering'
              return (
                <div key={`${message.role}-${index}`} className={`interview-session__message ${isInterviewer ? 'is-interviewer' : 'is-candidate'}`}>
                  <div>
                    <p>{isInterviewer ? interviewerLabel : message.skipped ? '跳过记录' : '你的回答'}</p>
                    <article className={[isCurrent ? 'is-current' : '', message.skipped ? 'is-skipped' : ''].filter(Boolean).join(' ')}>{message.content}</article>
                  </div>
                </div>
              )
            })}
            {(phase === 'thinking' || phase === 'finishing') && (
              <div className="interview-session__thinking">
                <Loader2Icon className="animate-spin" aria-hidden="true" />
                {phase === 'finishing' ? '正在生成练习报告…' : '面试官正在分析你的回答…'}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  )
}
