import { AiDeclarationNote } from '../../../ai/AiDeclarationNote'
import { InterviewNote } from '../interviewQxParts'
import type { InterviewFinishRecovery } from './interviewAnswerRecovery'
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
  onRetryVoice: () => void
  onUseText: () => void
  onUseVoice: () => void
  onSkip: () => void
  onFinish: () => void
  finishRecovery: InterviewFinishRecovery | null
  onContinueAnswering: () => void
  onLeaveInterview: () => void
  onOpenTips: () => void
  onRetryReport: () => void
  omitPrintAnswers: boolean
  onOmitPrintAnswersChange: (value: boolean) => void
}

/**
 * 作答区（稿 iv-run 的「你的回答」与动作行）。主按钮（提交回答、开始回答、结束回答并转写、确认提交）在底栏，
 * 这里只放输入、状态说明和次要动作，页里不再有第二颗「提交回答」。
 */
export function InterviewAnswerDock(props: InterviewAnswerDockProps) {
  const {
    micError, error, voiceLocked, busyTurn, phase, mode, voice, recordSec, maxRecordSec,
    draft, voiceAvailable, micBlockedReason, onRecheckMic, onDraftChange, onReviewChange,
    onRetryVoice, onUseText, onUseVoice, onSkip,
    onFinish, finishRecovery, onContinueAnswering, onLeaveInterview,
    onOpenTips, onRetryReport, omitPrintAnswers, onOmitPrintAnswersChange,
  } = props
  const turnBusy = phase === 'thinking' || phase === 'finishing'
  const done = phase === 'done_suggest'

  return (
    <div className="interview-session__answer-dock">
      {micError && (
        <div className="qxt-iv-note is-bad" data-mic-error>
          {/* 文案来自按 error.name 归因的结果：没有设备就说没有设备，不再统一说成「请检查浏览器权限」。 */}
          <b>{error ?? '麦克风调用失败'}</b>
          {micBlockedReason && <span>{micBlockedReason}</span>}
          <div className="qxt-iv-acts">
            <button type="button" disabled={voiceLocked || busyTurn} onClick={onRetryVoice}>重新尝试语音</button>
            <button type="button" disabled={voiceLocked || busyTurn} onClick={onRecheckMic}>重新检测麦克风</button>
            <button type="button" disabled={voiceLocked || busyTurn} onClick={onUseText}>改用文字输入</button>
          </div>
        </div>
      )}
      {error && !micError && <p className="interview-session__error qxt-iv-err" role="alert">{error}</p>}
      {finishRecovery === 'no-answers' && !micError && (
        <div className="qxt-iv-acts" data-testid="interview-finish-recovery">
          <button type="button" className="is-go" disabled={busyTurn} onClick={onContinueAnswering}>继续答题</button>
          <button type="button" disabled={busyTurn} onClick={onLeaveInterview}>离开</button>
        </div>
      )}
      {finishRecovery === 'outage' && !micError && (
        <div className="qxt-iv-acts" data-testid="interview-finish-recovery">
          <button type="button" className="is-go" disabled={busyTurn} onClick={onOpenTips}>看面试要点</button>
          <button type="button" disabled={busyTurn} onClick={onRetryReport}>稍后再试生成报告</button>
        </div>
      )}

      {phase === 'thinking' ? (
        <InterviewNote lead="面试官正在分析你的回答…">
          <span>提交后才会进入下一题。这次没发出去时，页面会留下原因，你可以再试一次。</span>
        </InterviewNote>
      ) : phase === 'finishing' ? (
        <InterviewNote lead="正在生成练习报告…">
          <span>生成好之前，不跳到报告页。</span>
        </InterviewNote>
      ) : done ? null : mode === 'voice' && voice.kind === 'recording' ? (
        <InterviewNote lead={`正在录音，已录 ${formatInterviewClock(recordSec)}，最长 ${maxRecordSec} 秒`}>
          <span>点「结束回答并转写」就停。录满 {maxRecordSec} 秒也只停止录音并进入转写，不结束这场练习，也不自动出报告。</span>
        </InterviewNote>
      ) : mode === 'voice' && voice.kind === 'requesting_permission' ? (
        <InterviewNote lead="正在请求麦克风权限…">
          <span>请在浏览器的提示里选择允许，之后才开始录音。</span>
        </InterviewNote>
      ) : mode === 'voice' && voice.kind === 'transcribing' ? (
        <InterviewNote lead="正在转写你的回答…">
          <span>转写完成后请你确认，不会自动提交。</span>
        </InterviewNote>
      ) : mode === 'voice' && voice.kind === 'review' ? (
        <label className="qxt-iv-answer">
          <b>转写结果（可编辑，确认后提交）</b>
          <textarea value={voice.edited} onChange={(event) => onReviewChange(event.target.value)} rows={3} maxLength={2000} />
        </label>
      ) : mode === 'voice' ? (
        <InterviewNote lead="点下方「开始回答（语音）」">
          <span>语音模式会自动播一次当前题。不是按住说话。最长 {maxRecordSec} 秒。</span>
        </InterviewNote>
      ) : (
        <label className="qxt-iv-answer">
          <b>你的回答</b>
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            disabled={busyTurn}
            rows={3}
            maxLength={2000}
            aria-label="本题回答"
            placeholder="在这里输入你的回答，最多 2000 字"
          />
          <span>{draft.length} / 2000</span>
          <span>提交后才会进入下一题。这次没发出去时，页面会留下原因，你可以再试一次。</span>
        </label>
      )}

      {!turnBusy && (
        <div className="qxt-iv-acts">
          <label className="interview-session__omit-print qxt-iv-toggle">
            <input
              type="checkbox"
              checked={omitPrintAnswers}
              onChange={(event) => onOmitPrintAnswersChange(event.target.checked)}
            />
            <span>不打印我的回答（报告仍可在屏幕上回看问答摘录）</span>
          </label>
          {mode === 'voice' && voice.kind === 'review' ? (
            <button type="button" disabled={busyTurn} onClick={onRetryVoice}>重新录音</button>
          ) : null}
          {mode === 'voice' ? (
            <button type="button" disabled={busyTurn || voice.kind === 'recording' || voiceLocked} onClick={onUseText}>改用文字输入</button>
          ) : (
            // 能力门禁：不隐藏入口（用户可能后插 USB 麦克风），用 aria-disabled 置灰，
            // 原因常显在下方。触屏没有 hover，禁止用 title 承载原因。
            <button
              type="button"
              disabled={busyTurn}
              aria-disabled={!voiceAvailable || undefined}
              data-mic-gated={!voiceAvailable || undefined}
              onClick={onUseVoice}
            >
              改用语音回答
            </button>
          )}
          {done ? null : (
            <button type="button" disabled={busyTurn || (mode === 'voice' && voice.kind !== 'idle')} onClick={onSkip}>跳过此题</button>
          )}
          {done ? null : (
            <button type="button" disabled={busyTurn || voiceLocked} onClick={onFinish}>结束本场练习</button>
          )}
        </div>
      )}
      {mode === 'text' && !done && !voiceAvailable && micBlockedReason ? (
        <div className="qxt-iv-note is-bad" data-mic-reason role="status">
          <span>{micBlockedReason}</span>
          <button type="button" className="interview-session__mic-recheck" onClick={onRecheckMic}>
            重新检测麦克风
          </button>
        </div>
      ) : null}
      <AiDeclarationNote />
    </div>
  )
}
