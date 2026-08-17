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
  RefreshCwIcon,
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
  /** 语音不可用的常显原因（无设备 / 无权限 / 不支持）。可用时为 null。 */
  micBlockedReason: string | null
  onRecheckMic: () => void
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
    draft, voiceAvailable, micBlockedReason, onRecheckMic, onDraftChange, onReviewChange,
    onReviewSubmit, onRetryVoice, onStopRecording, onUseText, onUseVoice, onSkip,
    onSubmitText, onFinish,
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
        <div className="interview-session__mic-error" data-mic-error>
          {/* 文案来自按 error.name 归因的结果：没有设备就说没有设备，
              不再统一说成「请检查浏览器权限」。 */}
          <div><AlertCircleIcon aria-hidden="true" /><p><strong>{error ?? '麦克风调用失败'}</strong>{micBlockedReason && <span>{micBlockedReason}</span>}</p></div>
          <div>
            <Button size="lg" disabled={voiceLocked || busyTurn} onClick={onRetryVoice}><RotateCcwIcon aria-hidden="true" />重新尝试语音</Button>
            <Button size="lg" variant="secondary" disabled={voiceLocked || busyTurn} onClick={onRecheckMic}><RefreshCwIcon aria-hidden="true" />重新检测麦克风</Button>
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
            {/* 能力门禁：不隐藏入口（用户可能后插 USB 麦克风），用 aria-disabled
                置灰 + 下方常显原因。触屏没有 hover，禁止用 title 承载原因。 */}
            <Button
              size="lg"
              variant="secondary"
              disabled={busyTurn}
              aria-disabled={!voiceAvailable || undefined}
              data-mic-gated={!voiceAvailable || undefined}
              className={!voiceAvailable ? 'opacity-50' : undefined}
              onClick={onUseVoice}
            >
              <MicIcon aria-hidden="true" />改用语音回答
            </Button>
            <Button size="lg" variant="secondary" disabled={busyTurn} onClick={onSkip}><SkipForwardIcon aria-hidden="true" />跳过</Button>
            <Button size="lg" variant="secondary" className="is-danger" disabled={busyTurn} onClick={onFinish}><SquareIcon aria-hidden="true" />结束面试</Button>
          </div>
          {!voiceAvailable && micBlockedReason && (
            <p className="interview-session__mic-reason" data-mic-reason role="status">
              <AlertCircleIcon aria-hidden="true" />
              <span>{micBlockedReason}</span>
              <button type="button" className="interview-session__mic-recheck" onClick={onRecheckMic}>
                重新检测麦克风
              </button>
            </p>
          )}
        </div>
      )}
      <p className="interview-session__privacy-note"><ClockIcon aria-hidden="true" />模拟练习仅供本人参考，对话内容不会发送给任何企业</p>
    </footer>
  )
}
