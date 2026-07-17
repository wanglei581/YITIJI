import { Button } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ClockIcon,
  FileTextIcon,
  KeyboardIcon,
  Loader2Icon,
  MicIcon,
  PencilLineIcon,
  RotateCcwIcon,
  SendIcon,
  SkipForwardIcon,
  SquareIcon,
} from 'lucide-react'
import type { InterviewSessionPhase, InterviewVoiceState } from './types'
import { formatInterviewClock } from './types'

interface InterviewAnswerDockProps {
  micError: boolean
  error: string | null
  voiceLocked: boolean
  busyTurn: boolean
  phase: InterviewSessionPhase
  mode: 'voice' | 'text'
  voice: InterviewVoiceState
  recordSec: number
  maxRecordSec: number
  draft: string
  voiceAvailable: boolean
  onDraftChange: (value: string) => void
  onReviewChange: (value: string) => void
  onReviewSubmit: () => void
  onRetryVoice: () => void
  onStopRecording: () => void
  onUseText: () => void
  onUseVoice: () => void
  onSkip: () => void
  onSubmitText: () => void
  onFinish: () => void
}

export function InterviewAnswerDock(props: InterviewAnswerDockProps) {
  const {
    micError, error, voiceLocked, busyTurn, phase, mode, voice, recordSec, maxRecordSec,
    draft, voiceAvailable, onDraftChange, onReviewChange, onReviewSubmit, onRetryVoice,
    onStopRecording, onUseText, onUseVoice, onSkip, onSubmitText, onFinish,
  } = props
  const answerStatus =
    phase === 'done_suggest' ? '本场已完成'
    : mode === 'voice' && voice.kind === 'recording' ? '作答中 · 语音录制'
    : mode === 'voice' && voice.kind === 'review' ? '作答中 · 转写确认'
    : mode === 'voice' ? '作答中 · 语音回答'
    : '作答中 · 文字输入'

  return (
    <footer className="interview-session__answer-dock">
      <div className="interview-session__answer-head">
        <span className="interview-session__card-icon"><PencilLineIcon aria-hidden="true" /></span>
        <div>
          <h2>我的回答</h2>
          <p>文字输入，或用麦克风语音作答</p>
        </div>
        <span>{answerStatus}</span>
      </div>
      {micError && (
        <div className="interview-session__mic-error">
          <div><AlertCircleIcon aria-hidden="true" /><p><strong>无法访问麦克风，请检查浏览器权限或改用文字输入</strong><span>确认浏览器已允许麦克风，并检查设备是否被其他程序占用。</span></p></div>
          <div>
            <Button size="lg" disabled={voiceLocked || busyTurn} onClick={onRetryVoice}><RotateCcwIcon aria-hidden="true" />重新尝试语音</Button>
            <Button size="lg" variant="secondary" disabled={voiceLocked || busyTurn} onClick={onUseText}><KeyboardIcon aria-hidden="true" />改用文字输入</Button>
          </div>
        </div>
      )}
      {error && !micError && <p className="interview-session__error" role="alert">{error}</p>}

      {phase === 'done_suggest' ? (
        <Button size="lg" className="interview-session__primary-action" disabled={voiceLocked} onClick={onFinish}>
          <FileTextIcon aria-hidden="true" />结束并生成练习报告
        </Button>
      ) : mode === 'voice' && voice.kind === 'review' ? (
        <div className="interview-session__review-grid">
          <label>
            <span><PencilLineIcon aria-hidden="true" />转写结果（可编辑，确认后提交）</span>
            <textarea value={voice.edited} onChange={(event) => onReviewChange(event.target.value)} rows={3} maxLength={2000} />
          </label>
          <div>
            <Button size="lg" disabled={busyTurn} onClick={onReviewSubmit}><CheckCircle2Icon aria-hidden="true" />确认提交</Button>
            <Button size="lg" variant="secondary" disabled={busyTurn} onClick={onRetryVoice}><MicIcon aria-hidden="true" />重新录音</Button>
            <Button size="lg" variant="secondary" disabled={busyTurn} onClick={onUseText}><KeyboardIcon aria-hidden="true" />改用文字输入</Button>
          </div>
        </div>
      ) : mode === 'voice' ? (
        <>
          {voice.kind === 'requesting_permission' ? (
            <Button size="lg" className="interview-session__primary-action" disabled><Loader2Icon className="animate-spin" aria-hidden="true" />正在请求麦克风权限…</Button>
          ) : voice.kind === 'recording' ? (
            <Button size="lg" className="interview-session__primary-action is-recording" onClick={onStopRecording}><SquareIcon aria-hidden="true" />结束回答（已录 {formatInterviewClock(recordSec)}，{formatInterviewClock(maxRecordSec - recordSec)} 后自动结束）</Button>
          ) : voice.kind === 'transcribing' ? (
            <Button size="lg" className="interview-session__primary-action" disabled><Loader2Icon className="animate-spin" aria-hidden="true" />正在转写你的回答…</Button>
          ) : (
            <Button size="lg" className="interview-session__primary-action" disabled={busyTurn} onClick={onRetryVoice}><MicIcon aria-hidden="true" />开始回答（语音）</Button>
          )}
          <div className="interview-session__secondary-actions">
            <Button size="lg" variant="secondary" disabled={busyTurn || voice.kind === 'recording' || voiceLocked} onClick={onUseText}><KeyboardIcon aria-hidden="true" />改用文字输入</Button>
            <Button size="lg" variant="secondary" disabled={busyTurn || voice.kind !== 'idle'} onClick={onSkip}><SkipForwardIcon aria-hidden="true" />跳过</Button>
            <Button size="lg" variant="secondary" className="is-danger" disabled={busyTurn || voiceLocked} onClick={onFinish}><SquareIcon aria-hidden="true" />结束面试</Button>
          </div>
        </>
      ) : (
        <div className="interview-session__text-grid">
          <textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} disabled={busyTurn} rows={3} maxLength={2000} placeholder="在这里输入你的回答…" />
          <div>
            <Button size="lg" disabled={busyTurn} onClick={onSubmitText}><SendIcon aria-hidden="true" />提交回答</Button>
            {voiceAvailable && <Button size="lg" variant="secondary" disabled={busyTurn} onClick={onUseVoice}><MicIcon aria-hidden="true" />改用语音回答</Button>}
            <Button size="lg" variant="secondary" disabled={busyTurn} onClick={onSkip}><SkipForwardIcon aria-hidden="true" />跳过</Button>
            <Button size="lg" variant="secondary" className="is-danger" disabled={busyTurn} onClick={onFinish}><SquareIcon aria-hidden="true" />结束面试</Button>
          </div>
        </div>
      )}
      <p className="interview-session__privacy-note"><ClockIcon aria-hidden="true" />模拟练习仅供本人参考，对话内容不会发送给任何企业</p>
    </footer>
  )
}
