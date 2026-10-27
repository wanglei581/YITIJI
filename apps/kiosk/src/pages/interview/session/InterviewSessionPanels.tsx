import type { ReactNode, RefObject } from 'react'
import { AI_LABEL_COPY } from '@ai-job-print/shared'
import { InterviewArtMark } from '../InterviewArt'
import { InterviewNote, InterviewStatus } from '../interviewQxParts'
import type { InterviewMessage, InterviewSessionPhase, InterviewVoiceState } from './types'
import { formatInterviewClock } from './types'

type PillTone = 'gray' | 'blue' | 'red' | 'green'

interface InterviewSessionPanelsProps {
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
  phase: InterviewSessionPhase
  listRef: RefObject<HTMLDivElement>
  children?: ReactNode
}

/** 近两轮对话就够：更早的在这场练习的报告里。 */
const RECENT_MESSAGES = 4

/**
 * 作答页正文（稿 iv-run）：题目、三格状态、到点与问完的提示、回答时的组织提示，
 * 中间放作答区（children），最后是最近对话。整页只有 .interview-session__content 一个滚动容器。
 */
export function InterviewSessionPanels({
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
  phase,
  listRef,
  children,
}: InterviewSessionPanelsProps) {
  const previousQuestion = messages
    .filter((message) => message.role === 'interviewer')
    .slice(-2, -1)[0]?.content

  const micTone = micStatusTone === 'green' ? 'ok' : micStatusTone === 'red' ? 'off' : undefined
  const lastInterviewerIndex = messages.map((m) => m.role).lastIndexOf('interviewer')

  return (
    <div className="interview-session__content">
      <section className="qxt-iv-q interview-session__question-card">
        <span className="qxt-iv-qstat">
          {speaking ? <span className="interview-session__wave" aria-hidden="true"><i /><i /><i /><i /><i /></span> : null}
          {statusText}
        </span>
        <small>{interviewerLabel} · {position} · 第 {questionIndex} 题 / 目标 {questionTarget} 题 · {AI_LABEL_COPY.INTERVIEW_SESSION}</small>
        <p className="interview-session__question-text">{lastInterviewerMsg || '等待面试官出题'}</p>
        {previousQuestion ? <small className="interview-session__previous-question">上一题：{previousQuestion}</small> : null}
        <div className="qxt-iv-qart"><InterviewArtMark className="qxt-iv-qart-mark" align="left" /></div>
      </section>
      <InterviewStatus
        label="本场作答状态"
        items={[
          { k: '麦克风', v: micStatusLabel, tone: micTone },
          { k: '语音播报', v: ttsLabel, tone: ttsOfficial ? 'ok' : undefined },
          { k: '剩余时间', v: formatInterviewClock(remainingSec), tone: timeUp ? 'off' : 'ok' },
        ]}
      />
      {timeUp && phase !== 'finishing' ? (
        <p className="qxt-iv-sec" role="status">练习时长已到，回答完当前问题后点「结束本场练习」。</p>
      ) : null}
      {voiceHint ? <p className="qxt-iv-sec" role="status">{voiceHint}</p> : null}
      {phase === 'done_suggest' ? <p className="qxt-iv-sec">本场问题已问完，可以结束并生成报告</p> : null}
      <InterviewNote lead="回答时可以这样组织">
        <span>背景：先交代问题，说明当时要解决什么。</span>
        <span>行动：说你做了什么，突出你本人的关键工作。</span>
        <span>结果：只说能核实的，数字和成果由你自己核对。</span>
      </InterviewNote>
      {children}
      <div ref={listRef} className="interview-session__history qxt-iv-note" role="log" aria-live="polite" aria-relevant="additions text">
        <b>最近对话</b>
        {messages.slice(-RECENT_MESSAGES).map((message, index, shown) => (
          <span
            key={`${message.role}-${messages.length - shown.length + index}`}
            className={message.skipped ? 'is-skipped' : undefined}
            data-current={messages.length - shown.length + index === lastInterviewerIndex && message.role === 'interviewer' && phase === 'answering' ? 'true' : undefined}
          >
            <b>{message.role === 'interviewer' ? interviewerLabel : message.skipped ? '跳过记录' : '你的回答'}</b> {message.content}
          </span>
        ))}
        <span>模拟练习仅供本人参考，对话内容不会发送给任何企业。转写不落库、音频不落盘。转完即删。</span>
      </div>
    </div>
  )
}
