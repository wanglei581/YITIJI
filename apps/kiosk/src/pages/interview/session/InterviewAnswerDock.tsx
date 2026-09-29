import { AlertCircleIcon, ClockIcon, PencilLineIcon } from 'lucide-react'
import { AiDeclarationNote } from '../../../ai/AiDeclarationNote'
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
  omitPrintAnswers: boolean
  onOmitPrintAnswersChange: (value: boolean) => void
}

export function InterviewAnswerDock(props: InterviewAnswerDockProps) {
  const {
    micError, error, voiceLocked, busyTurn, phase, mode, voice, recordSec, maxRecordSec,
    draft, voiceAvailable, micBlockedReason, onRecheckMic, onDraftChange, onReviewChange,
    onReviewSubmit, onRetryVoice, onStopRecording, onUseText, onUseVoice, onSkip,
    onSubmitText, onFinish, omitPrintAnswers, onOmitPrintAnswersChange,
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
          <div className="iv-tbar">
            <button type="button" className="qx-btn" data-variant="teal" disabled={voiceLocked || busyTurn} onClick={onRetryVoice}>重新尝试语音</button>
            <button type="button" className="qx-btn" disabled={voiceLocked || busyTurn} onClick={onRecheckMic}>重新检测麦克风</button>
            <button type="button" className="qx-btn" disabled={voiceLocked || busyTurn} onClick={onUseText}>改用文字输入</button>
          </div>
        </div>
      )}
      {error && !micError && <p className="interview-session__error" role="alert">{error}</p>}

      <label className="interview-session__omit-print">
        <input
          type="checkbox"
          checked={omitPrintAnswers}
          onChange={(event) => onOmitPrintAnswersChange(event.target.checked)}
        />
        <span>不打印我的回答（报告仍可在屏幕上回看问答摘录）</span>
      </label>
      {phase === 'done_suggest' ? (
        <button type="button" className="qx-btn" data-variant="primary" disabled={voiceLocked} onClick={onFinish}>
          结束并生成练习报告
        </button>
      ) : mode === 'voice' && voice.kind === 'review' ? (
        <div className="interview-session__review-grid">
          <label>
            <span><PencilLineIcon aria-hidden="true" />转写结果（可编辑，确认后提交）</span>
            <textarea value={voice.edited} onChange={(event) => onReviewChange(event.target.value)} rows={3} maxLength={2000} />
          </label>
          <div className="iv-tbar">
            <button type="button" className="qx-btn" data-variant="teal" disabled={busyTurn} onClick={onReviewSubmit}>确认提交</button>
            <button type="button" className="qx-btn" disabled={busyTurn} onClick={onRetryVoice}>重新录音</button>
            <button type="button" className="qx-btn" disabled={busyTurn} onClick={onUseText}>改用文字输入</button>
          </div>
        </div>
      ) : mode === 'voice' ? (
        <>
          {voice.kind === 'requesting_permission' ? (
            <button type="button" className="qx-btn" data-variant="primary" disabled>正在请求麦克风权限…</button>
          ) : voice.kind === 'recording' ? (
            <button type="button" className="qx-btn" data-variant="primary" onClick={onStopRecording}>结束回答（已录 {formatInterviewClock(recordSec)}，{formatInterviewClock(maxRecordSec - recordSec)} 后自动结束）</button>
          ) : voice.kind === 'transcribing' ? (
            <button type="button" className="qx-btn" data-variant="primary" disabled>正在转写你的回答…</button>
          ) : (
            <button type="button" className="qx-btn" data-variant="primary" disabled={busyTurn} onClick={onRetryVoice}>开始回答（语音）</button>
          )}
          <div className="iv-tbar">
            <button type="button" className="qx-btn" disabled={busyTurn || voice.kind === 'recording' || voiceLocked} onClick={onUseText}>改用文字输入</button>
            <button type="button" className="qx-btn" disabled={busyTurn || voice.kind !== 'idle'} onClick={onSkip}>跳过此题</button>
            <button type="button" className="qx-btn" disabled={busyTurn || voiceLocked} onClick={onFinish}>结束本场</button>
          </div>
        </>
      ) : (
        <div className="interview-session__text-grid">
          <textarea value={draft} onChange={(event) => onDraftChange(event.target.value)} disabled={busyTurn} rows={3} maxLength={2000} aria-label="本题回答" placeholder="在这里输入你的回答，最多 2000 字" />
          <div className="iv-tbar">
            <button type="button" className="qx-btn" data-variant="teal" disabled={busyTurn} onClick={onSubmitText}>提交回答</button>
            {/* 能力门禁：不隐藏入口（用户可能后插 USB 麦克风），用 aria-disabled
                置灰 + 下方常显原因。触屏没有 hover，禁止用 title 承载原因。 */}
            <button
              type="button"
              className="qx-btn"
              disabled={busyTurn}
              aria-disabled={!voiceAvailable || undefined}
              data-mic-gated={!voiceAvailable || undefined}
              onClick={onUseVoice}
            >
              改用语音回答
            </button>
            <button type="button" className="qx-btn" disabled={busyTurn} onClick={onSkip}>跳过此题</button>
            <button type="button" className="qx-btn" disabled={busyTurn} onClick={onFinish}>结束本场</button>
            <span className="cnt">{draft.length} / 2000</span>
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
      <AiDeclarationNote />
      <p className="interview-session__privacy-note"><ClockIcon aria-hidden="true" />模拟练习仅供本人参考，对话内容不会发送给任何企业</p>
    </footer>
  )
}
