// AssistantCallPanel — 稿 05-ai-cockpit 的五个语音态（voice-gate / connecting / live / mic-denied / error）。
// 选择层只解释真实能力，不创建会话；用户明确点击「直接语音通话」后才启动 TRTC。
// 仍是模态对话框（背后的工作台 inert）：一体机舞台上它只盖住舱面以下的主体与输入坞，
// 舱面标题与读数由 onStateChange 上报的真实相位驱动。
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { AI_LABEL_COPY } from '@ai-job-print/shared'
import { KIcon } from '../../components/kiosk-icon'
import { useAiAdvisorCallSession } from '../../hooks/useAiAdvisorCallSession'
import { AdvisorManualEntries } from './AdvisorConversation'
import { COCKPIT_COPY, type CockpitVoiceState } from './advisorScenes'

const ADVISOR_IMG = '/assets/ai-advisor.png'

interface AssistantCallPanelProps {
  onClose: () => void
  onSwitchToText: () => void
  /** 把 TRTC 的真实相位上报给舱面（标题 · 胶囊 · 语音通道读数）。 */
  onStateChange?: (state: CockpitVoiceState) => void
}

function MiniList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="assistant-voice-mini">
      <b>{title}</b>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  )
}

export function AssistantCallPanel({ onClose, onSwitchToText, onStateChange }: AssistantCallPanelProps) {
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

  // 麦克风被拒时 TRTC 降级为只听：通话仍在，稿里对应 mic-denied 态。
  const voiceState: CockpitVoiceState = call.phase === 'gate'
    ? 'voice-gate'
    : call.phase === 'connecting'
      ? 'voice-connecting'
      : call.phase === 'error'
        ? 'voice-error'
        : call.micBlocked ? 'mic-denied' : 'voice-live'

  useEffect(() => {
    onStateChange?.(voiceState)
  }, [onStateChange, voiceState])

  useEffect(() => {
    if (call.phase !== 'connecting' && call.phase !== 'live') return
    const focusTimer = window.setTimeout(() => hangupRef.current?.focus(), 0)
    return () => window.clearTimeout(focusTimer)
  }, [call.phase])

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
  // 声波只跟真实音量事件走：没有信号就静止，避免看起来像正在听。
  const waveActive = call.phase === 'live' && !call.muted &&
    (call.aiState === 'speaking' || call.aiState === 'listening')
  const [sectionTitle, sectionHint] = COCKPIT_COPY[voiceState].section

  return (
    <div className="assistant-voice-backdrop" data-voice-state={voiceState}>
      <section
        id="assistant-voice-dialog"
        data-kiosk-screen="assistant-call"
        data-state={voiceState}
        ref={dialogRef}
        className="assistant-voice-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistant-voice-title"
        aria-describedby="assistant-voice-sub assistant-voice-ai-disclosure"
        aria-busy={ending}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="assistant-voice-header">
          <div>
            <span>{sectionTitle}</span>
            <h2 id="assistant-voice-title">和小青语音咨询</h2>
            <p id="assistant-voice-sub">{sectionHint}</p>
            {/*
              数字人披露（compliance-boundary §1.2 A「数字人形象与声音」，feature-scope §七 #19）：
              放在页头而不是某一态的正文里 —— 开麦确认、连接中、通话中、只听、失败五态都看得到。
            */}
            <p id="assistant-voice-ai-disclosure" className="assistant-voice-ai-disclosure">{AI_LABEL_COPY.DIGITAL_HUMAN}</p>
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
            <div className="assistant-voice-panel">
              <div className="assistant-voice-center">
                <span className="assistant-voice-orb" aria-hidden="true"><KIcon name="mic" /></span>
                <h3>先由你决定要不要用麦克风</h3>
                <p>在你按下「直接语音通话」之前，本页不会请求麦克风权限，也不采集任何声音。</p>
              </div>
              <div className="assistant-voice-twocol">
                <MiniList title="按下开启后会发生" items={['浏览器弹出麦克风授权询问', '向服务端申请一次语音会话', '能不能接通由真实服务返回确认']} />
                <MiniList title="现在不会发生" items={['不采集声音、不进通话房间', '不显示转写、时长或识别结果', '不把未接通说成已接通']} />
              </div>
            </div>
            <div className="assistant-voice-dock" aria-label="语音咨询方式">
              <button
                ref={directCallRef}
                type="button"
                className="assistant-voice-choice assistant-voice-choice--primary"
                onClick={() => void call.startCall()}
              >
                <KIcon name="phone" />
                <span className="assistant-voice-choice-copy">
                  <strong>直接语音通话</strong>
                  <small>我同意开启麦克风</small>
                </span>
              </button>
              <button type="button" className="assistant-voice-choice" disabled>
                <KIcon name="mic" />
                <span className="assistant-voice-choice-copy">
                  <strong>按住说话</strong>
                  <small>尚未开放</small>
                </span>
              </button>
              <button type="button" className="assistant-voice-choice" onClick={onSwitchToText}>
                <KIcon name="chat" />
                <span className="assistant-voice-choice-copy">
                  <strong>继续用文字</strong>
                  <small>回到输入框</small>
                </span>
              </button>
            </div>
            <p className="assistant-voice-privacy">
              通话内容不保存音频；挂断、关闭或离开本页时会自动结束会话，不持续计费。
            </p>
          </div>
        ) : call.phase === 'error' ? (
          <div className="assistant-voice-stage assistant-voice-error" role="alert">
            <div className="assistant-voice-card" data-kind="error">
              <h3><KIcon name="close" />这次没连上语音服务</h3>
              <p>连接失败，页面不推测原因，也不展示任何模拟对话。文字咨询和四个非 AI 入口都不受影响。</p>
              {call.errMsg ? <p className="assistant-voice-error-message">服务返回：{call.errMsg}</p> : null}
            </div>
            <div className="assistant-voice-twocol">
              <MiniList title="现在可做什么" items={['「重新连接」会重新走一次真实申请', '「改用文字咨询」回到输入框', '连续失败请找现场工作人员']} />
              <MiniList title="这次没有发生" items={['没有进入通话房间', '没有采集或上传声音', '没有生成任何对话记录']} />
            </div>
            {/* 稿 05：语音没建立不影响这四项。点进去会卸载本面板，会话清理由 useAiAdvisorCallSession 负责。 */}
            <AdvisorManualEntries variant="rail" />
            <div className="assistant-voice-dock assistant-voice-error-actions">
              <button type="button" className="assistant-voice-control assistant-voice-control--primary" disabled={ending} onClick={() => void retryCall()}>
                <KIcon name="phone" />
                重新连接
              </button>
              <button ref={hangupRef} type="button" className="assistant-voice-control" disabled={ending} onClick={switchToText}>
                <KIcon name="chat" />
                改用文字咨询
              </button>
            </div>
            <p className="assistant-voice-privacy">语音暂不可用时，文字咨询不受影响。</p>
          </div>
        ) : (
          <div className={`assistant-voice-stage assistant-voice-live${call.phase === 'connecting' ? ' is-connecting' : ''}`}>
            <div className="assistant-voice-panel">
            <div className="assistant-voice-live-status" role="status" aria-live="polite">
              {call.phase === 'live'
                ? <span className="is-live" aria-hidden="true" />
                : <span className="assistant-voice-dots" aria-hidden="true"><i /><i /><i /></span>}
              <strong>{call.phase === 'connecting' ? '请求已发出，等真实服务结果' : statusText}</strong>
              {/* 只有真的进了房间才计时；连接中不显示任何时长。 */}
              {call.phase === 'live' ? <time>{`${mm}:${ss}`}</time> : null}
            </div>

            {call.phase === 'connecting' ? (
              <div className="assistant-voice-twocol">
                <MiniList title="这一步在等什么" items={['服务端下发进房凭证', '通话模块加载完成', '本地麦克风开启结果']} />
                <MiniList title="失败会怎样" items={['直接说没建立，不猜原因', '文字咨询照常可用', '四个非 AI 入口不受影响']} />
              </div>
            ) : (
              <>
                <div className="assistant-voice-avatar assistant-voice-avatar--live">
                  <img src={ADVISOR_IMG} alt="正在通话的 AI 数字人小青" />
                </div>
                <div className={waveActive ? 'assistant-voice-wave' : 'assistant-voice-wave is-quiet'} aria-hidden="true">
                  <i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
                </div>
              </>
            )}

            {call.needResume && call.phase === 'live' && (
              <button type="button" className="assistant-voice-resume" onClick={() => void call.resumePlay()}>
                <KIcon name="phone" />
                点击继续播放小青语音
              </button>
            )}

            {call.phase === 'live' && (
              <div className="assistant-voice-caption" aria-live="polite">
                <div>
                  <strong>实时字幕</strong>
                  <span>来自服务端 · {AI_LABEL_COPY.BASE}</span>
                </div>
                <p>
                  {call.subtitle ||
                    (call.aiState === 'listening'
                      ? call.muted ? '麦克风已关闭' : '请讲，我在听…'
                      : '通话字幕将在这里显示')}
                </p>
              </div>
            )}
            </div>

            {call.phase === 'connecting' && <AdvisorManualEntries variant="rail" />}

            {call.micBlocked && (
              <div className="assistant-voice-card assistant-voice-mic-warning" data-kind="warn" role="status">
                <h3><KIcon name="mic-off" />浏览器没有授予麦克风权限</h3>
                <p>当前为只听模式：小青能说，你这边的声音传不过去。可以在浏览器里允许麦克风后「重新尝试授权」，也可以直接改用文字。</p>
              </div>
            )}

            <div className="assistant-voice-controls" aria-label="通话操作">
              {call.phase === 'live' && !call.micBlocked && (
                <button
                  type="button"
                  className={call.muted ? 'assistant-voice-control is-active' : 'assistant-voice-control'}
                  aria-pressed={call.muted}
                  disabled={ending}
                  onClick={() => void call.toggleMute()}
                >
                  <KIcon name={call.muted ? 'mic-off' : 'mic'} />
                  {call.muted ? '取消静音' : '静音'}
                </button>
              )}
              {call.micBlocked && (
                <button type="button" className="assistant-voice-control" disabled={ending} onClick={() => void retryCall()}>
                  <KIcon name="mic" />
                  重新尝试授权
                </button>
              )}
              {call.phase === 'live' && (
                <button type="button" className="assistant-voice-control" disabled={ending} onClick={returnToChoices}>
                  <KIcon name="swap" />
                  切换方式
                </button>
              )}
              <button type="button" className="assistant-voice-control" disabled={ending} onClick={switchToText}>
                <KIcon name="chat" />
                {call.micBlocked ? '改用文字咨询' : call.phase === 'connecting' ? '回到文字' : '文字咨询'}
              </button>
              <button
                ref={hangupRef}
                type="button"
                className="assistant-voice-control assistant-voice-control--hangup"
                disabled={ending}
                onClick={returnToChoices}
              >
                <KIcon name="phone" />
                {call.phase === 'connecting' ? '取消尝试' : '挂断'}
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
