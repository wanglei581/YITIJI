import type { ReactNode, RefObject } from 'react'
import { AI_LABEL_COPY } from '@ai-job-print/shared'
import { InterviewCardHead, InterviewNotice, InterviewRail, InterviewStatus, InterviewSteps } from '../interviewQxParts'
import {
  Loader2Icon,
  ShieldCheckIcon,
} from 'lucide-react'
import type { InterviewMessage, InterviewSessionPhase, InterviewVoiceState } from './types'
import { formatInterviewClock } from './types'

type PillTone = 'gray' | 'blue' | 'red' | 'green'

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
  children?: ReactNode
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
  children,
}: InterviewSessionPanelsProps) {
  const previousQuestion = messages
    .filter((message) => message.role === 'interviewer')
    .slice(-2, -1)[0]?.content

  const micTone = micStatusTone === 'green' ? 'ok' : micStatusTone === 'red' ? 'off' : undefined

  return (
    <>
      <div className="interview-session__content">
        <InterviewStatus
          label="本场作答状态"
          items={[
            { k: '麦克风', v: micStatusLabel, tone: micTone },
            { k: '语音播报', v: ttsLabel, tone: ttsOfficial ? 'ok' : undefined },
            { k: '剩余时间', v: formatInterviewClock(remainingSec), tone: timeUp ? 'off' : 'ok' },
          ]}
        />
        <section className="interview-session__question-card">
          <div className="interview-session__card-head">
            <span className="interview-session__card-icon">
              <img src={advisorPortrait} alt="" className={speaking ? 'is-speaking' : ''} />
            </span>
            <div>
              <h2>模拟面试 · {position}</h2>
              <p>{interviewerLabel} · 第 {questionIndex} 题 / 目标 {questionTarget} 题</p>
            </div>
            <span className="interview-session__voice-status">
              {speaking && <span className="interview-session__wave"><i /><i /><i /><i /><i /></span>}
              <span>{statusText}</span>
            </span>
          </div>
          <p className="interview-session__question-text">
            <small>AI 面试官提问 · {AI_LABEL_COPY.INTERVIEW_SESSION}</small>
            {lastInterviewerMsg || '等待面试官出题'}
          </p>
          {previousQuestion && <p className="interview-session__previous-question"><b>上一题</b>{previousQuestion}</p>}
        </section>
        {children}
        <section className="iv-card">
          <InterviewCardHead title="回答时可以这样组织" hint="只作本题提示" />
          <InterviewSteps rows={[
            ['背景', '先交代问题', '说明当时要解决什么。'],
            ['行动', '说你做了什么', '突出你本人的关键工作。'],
            ['结果', '只说能核实的', '数字和成果由你自己核对。'],
          ]} />
        </section>
        <InterviewNotice>
          提交后才会进入下一题。这次没发出去时，页面会留下原因，你可以再试一次。
        </InterviewNotice>
        {(voiceHint || timeUp) && (
          <section className="interview-session__notice" role="status">
            <ShieldCheckIcon aria-hidden="true" />
            <div>
              {voiceHint && <p>{voiceHint}</p>}
              {timeUp && phase !== 'finishing' && <p>练习时长已到，回答完当前问题后点「结束本场练习」。</p>}
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
        <InterviewRail />
      </div>
    </>
  )
}
