// AssistantCallPanel — 4188 风格语音咨询模态。
// 选择层只解释真实能力，不创建会话；用户明确点击「直接语音通话」后才启动 TRTC。
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { KIcon } from '../../components/kiosk-icon'
import { useAiAdvisorCallSession } from '../../hooks/useAiAdvisorCallSession'

const ADVISOR_IMG = '/assets/ai-advisor.png'

interface AssistantCallPanelProps {
  onClose: () => void
  onSwitchToText: () => void
}

export function AssistantCallPanel({ onClose, onSwitchToText }: AssistantCallPanelProps) {
  const call = useAiAdvisorCallSession()
  const [ending, setEnding] = useState(false)
  const endingRef = useRef(false)
  const dialogRef = useRef<HTMLElement>(null)
  const directCallRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const hangupRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const focusTimer = window.setTimeout(() => directCallRef.current?.focus(), 0)
    return () => window.clearTimeout(focusTimer)
  }, [])

  const runExit = useCallback(async (afterEnd: () => void) => {
    if (endingRef.current) return
    endingRef.current = true
    setEnding(true)
    try {
      await call.endCall()
    } finally {
      endingRef.current = false
      setEnding(false)
    }
    afterEnd()
  }, [call])

  const closeDialog = useCallback(() => {
    if (call.phase === 'gate') {
      onClose()
      return
    }
    void runExit(onClose)
  }, [call.phase, onClose, runExit])

  const returnToChoices = useCallback(() => {
    void runExit(() => {
      window.requestAnimationFrame(() => directCallRef.current?.focus())
    })
  }, [runExit])

  const switchToText = useCallback(() => {
    void runExit(onSwitchToText)
  }, [onSwitchToText, runExit])

  const retryCall = useCallback(async () => {
    if (endingRef.current) return
    endingRef.current = true
    setEnding(true)
    try {
      await call.endCall()
      await call.startCall()
    } finally {
      endingRef.current = false
      setEnding(false)
    }
  }, [call])

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (call.phase === 'gate') closeDialog()
      else (hangupRef.current ?? closeButtonRef.current)?.focus()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => element.getAttribute('aria-hidden') !== 'true')
    if (focusable.length === 0) return

    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const mm = String(Math.floor(call.elapsed / 60)).padStart(2, '0')
  const ss = String(call.elapsed % 60).padStart(2, '0')
  const statusText =
    call.phase === 'connecting'
      ? '正在连接小青'
      : call.aiState === 'listening'
        ? call.muted ? '麦克风已静音' : '小青正在听'
        : call.aiState === 'speaking'
          ? '小青正在说'
          : '通话已连接'
  const waveActive = call.phase === 'live' && !call.muted &&
    (call.aiState === 'speaking' || call.aiState === 'listening')

  return (
    <div className="assistant-voice-backdrop">
      <section
        id="assistant-voice-dialog"
        ref={dialogRef}
        className="assistant-voice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-voice-title"
        aria-busy={ending}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="assistant-voice-header">
          <div>
            <span>AI助手</span>
            <h2 id="assistant-voice-title">和小青语音咨询</h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="assistant-voice-close"
            aria-label="关闭语音咨询"
            disabled={ending}
            onClick={closeDialog}
          >
            <KIcon name="close" />
          </button>
        </header>

        {call.phase === 'gate' ? (
          <div className="assistant-voice-stage assistant-voice-gate">
            <div className="assistant-voice-intro">
              <div className="assistant-voice-avatar assistant-voice-avatar--gate">
                <img src={ADVISOR_IMG} alt="求职顾问小青" />
              </div>
              <div>
                <p className="assistant-voice-eyebrow">语音咨询</p>
                <h3>选择你习惯的沟通方式</h3>
                <p>直接与小青实时通话。开始后浏览器会申请麦克风权限，并同步显示通话字幕。</p>
              </div>
            </div>

            <div className="assistant-voice-choices" aria-label="语音咨询方式">
              <button
                ref={directCallRef}
                type="button"
                className="assistant-voice-choice assistant-voice-choice--primary"
                onClick={() => void call.startCall()}
              >
                <span className="assistant-voice-choice-icon" aria-hidden="true"><KIcon name="phone" /></span>
                <span className="assistant-voice-choice-copy">
                  <strong>直接语音通话</strong>
                  <small>实时连接小青，支持字幕与静音</small>
                </span>
                <KIcon name="arrow" />
              </button>
              <button type="button" className="assistant-voice-choice" disabled>
                <span className="assistant-voice-choice-icon" aria-hidden="true"><KIcon name="mic" /></span>
                <span className="assistant-voice-choice-copy">
                  <strong>按住说话</strong>
                  <small>尚未开放</small>
                </span>
              </button>
            </div>

            <p className="assistant-voice-privacy">
              通话内容不保存音频；挂断、关闭或离开本页时会自动结束会话，不持续计费。
            </p>
          </div>
        ) : call.phase === 'error' ? (
          <div className="assistant-voice-stage assistant-voice-error" role="alert">
            <div className="assistant-voice-avatar assistant-voice-avatar--static">
              <img src={ADVISOR_IMG} alt="求职顾问小青" />
            </div>
            <p className="assistant-voice-eyebrow">连接未完成</p>
            <h3>暂时无法接通小青</h3>
            <p className="assistant-voice-error-message">{call.errMsg}</p>
            <div className="assistant-voice-error-actions">
              <button type="button" disabled={ending} onClick={() => void retryCall()}>
                <KIcon name="phone" />
                重新连接
              </button>
              <button ref={hangupRef} type="button" disabled={ending} onClick={switchToText}>
                <KIcon name="chat" />
                改用文字咨询
              </button>
            </div>
            <p className="assistant-voice-privacy">语音暂不可用时，文字咨询不受影响。</p>
          </div>
        ) : (
          <div className="assistant-voice-stage assistant-voice-live">
            <div className="assistant-voice-live-status" role="status" aria-live="polite">
              <span className={call.phase === 'live' ? 'is-live' : ''} aria-hidden="true" />
              <strong>{statusText}</strong>
              <time>{call.phase === 'live' ? `${mm}:${ss}` : '00:00'}</time>
            </div>

            <div className="assistant-voice-avatar assistant-voice-avatar--live">
              <img src={ADVISOR_IMG} alt="正在通话的求职顾问小青" />
            </div>

            <div className={waveActive ? 'assistant-voice-wave' : 'assistant-voice-wave is-quiet'} aria-hidden="true">
              <i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
            </div>

            {call.needResume && call.phase === 'live' && (
              <button type="button" className="assistant-voice-resume" onClick={() => void call.resumePlay()}>
                <KIcon name="phone" />
                点击继续播放小青语音
              </button>
            )}

            <div className="assistant-voice-caption" aria-live="polite">
              <div>
                <strong>实时字幕</strong>
                <span>AI 内容仅供参考</span>
              </div>
              {call.micBlocked && (
                <p className="assistant-voice-mic-warning">
                  麦克风权限未开启，当前为只听模式。请在浏览器中允许麦克风后重新连接。
                </p>
              )}
              <p>
                {call.subtitle ||
                  (call.phase === 'connecting'
                    ? '正在接通，请稍候…'
                    : call.aiState === 'listening'
                      ? call.muted ? '麦克风已关闭' : '请讲，我在听…'
                      : '通话字幕将在这里显示')}
              </p>
            </div>

            <div className="assistant-voice-controls" aria-label="通话操作">
              <button
                type="button"
                className={call.muted ? 'assistant-voice-control is-active' : 'assistant-voice-control'}
                aria-pressed={call.muted}
                disabled={ending || call.phase !== 'live'}
                onClick={() => void call.toggleMute()}
              >
                <span><KIcon name={call.muted ? 'mic-off' : 'mic'} /></span>
                {call.muted ? '取消静音' : '静音'}
              </button>
              <button type="button" className="assistant-voice-control" disabled={ending} onClick={returnToChoices}>
                <span><KIcon name="swap" /></span>
                切换方式
              </button>
              <button type="button" className="assistant-voice-control" disabled={ending} onClick={switchToText}>
                <span><KIcon name="chat" /></span>
                文字咨询
              </button>
              <button
                ref={hangupRef}
                type="button"
                className="assistant-voice-control assistant-voice-control--hangup"
                disabled={ending}
                onClick={returnToChoices}
              >
                <span><KIcon name="phone" /></span>
                挂断
              </button>
            </div>

            <p className="assistant-voice-privacy">
              通话内容不保存音频；挂断、关闭或离开本页时会自动结束会话，不持续计费。
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
