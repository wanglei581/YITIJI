// AssistantCallPanel — 助手页内嵌语音通话面板（墨青纸感 call-panel）
//
// 2026-07-03 用户确认：取消独立全屏通话页（AiAdvisorCall.tsx 已删除），
// 通话以页内面板呈现，页面上下文（对话/快捷入口）全程保留。
// TRTC 会话逻辑在 hooks/useAiAdvisorCallSession.ts（由原 AiAdvisorCall
// 逐行搬移，零逻辑改动；main 侧对原组件的改动仅为 className 换色，已核对）。
//
// 生命周期：面板由「语音通话」按钮的点击手势触发挂载 → 挂载即 startCall
//（满足浏览器自动播放策略）；挂断/改用文字 → onEnd() 卸载面板，hook 的
// 卸载 effect 负责 exitRoom + 通知后端 stop（不持续计费）。
import { useEffect } from 'react'
import { KIcon } from '../../components/kiosk-icon'
import { useAiAdvisorCallSession } from '../../hooks/useAiAdvisorCallSession'
import './assistant-call-panel.css'

const ADVISOR_IMG = '/assets/ai-advisor.png'

export function AssistantCallPanel({ onEnd }: { onEnd: () => void }) {
  const call = useAiAdvisorCallSession()

  // 面板挂载 = 用户刚点了「语音通话」（用户手势上下文），立即接通
  useEffect(() => {
    void call.startCall()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mm = String(Math.floor(call.elapsed / 60)).padStart(2, '0')
  const ss = String(call.elapsed % 60).padStart(2, '0')

  // ── 错误态：面板内提示，不整页接管 ──
  if (call.phase === 'error') {
    return (
      <section className="acp" aria-live="polite">
        <div className="acp-ava static">
          <img src={ADVISOR_IMG} alt="小青" />
        </div>
        <div className="acp-meta err">连接失败</div>
        <p className="acp-errmsg">{call.errMsg}</p>
        <div className="acp-controls">
          <button type="button" className="acp-btn hangup" onClick={onEnd}>
            <KIcon name="chat" />
            改用文字咨询
          </button>
        </div>
        <p className="acp-note">语音暂不可用；文字对话不受影响，可直接在下方输入。</p>
      </section>
    )
  }

  const statusText =
    call.phase === 'connecting'
      ? '正在接通顾问…'
      : call.aiState === 'listening'
        ? '通话中 · 小青正在听'
        : call.aiState === 'speaking'
          ? '通话中 · 小青正在说'
          : '通话中'

  const waveActive = call.phase === 'live' && (call.aiState === 'speaking' || call.aiState === 'listening')

  return (
    <section className="acp" aria-live="polite">
      <div className="acp-ava">
        <img src={ADVISOR_IMG} alt="小青" />
      </div>
      <div className="acp-meta">{statusText}</div>
      <div className="acp-timer">{call.phase === 'live' ? `${mm}:${ss}` : '00:00'}</div>

      {/* 声纹：随说话/聆听起伏，静音或安静时暂停 */}
      <div className={waveActive && !call.muted ? 'acp-wave' : 'acp-wave quiet'} aria-hidden="true">
        <i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
      </div>

      {/* 自动播放被拦截：一次点击恢复 */}
      {call.needResume && call.phase === 'live' && (
        <button type="button" className="acp-resume" onClick={() => void call.resumePlay()}>
          点击播放顾问语音
        </button>
      )}

      <div className="acp-caption">
        <b>实时字幕</b>
        {call.micBlocked && (
          <span className="mic-warn">麦克风权限未开启，当前为只听模式。请在浏览器允许麦克风后刷新。</span>
        )}
        <span>
          {call.subtitle ||
            (call.phase === 'connecting'
              ? '正在接通，请稍候…'
              : call.aiState === 'listening'
                ? call.muted
                  ? '麦克风已关闭'
                  : '请讲，我在听…'
                : '你好，我是小青，直接说说你今天想办的事就可以。')}
        </span>
        <span className="ref">AI 回复内容仅供参考</span>
      </div>

      <div className="acp-controls">
        <button
          type="button"
          className={call.muted ? 'acp-btn muted' : 'acp-btn'}
          aria-pressed={call.muted}
          aria-label={call.muted ? '取消静音' : '静音'}
          onClick={() => void call.toggleMute()}
        >
          <KIcon name={call.muted ? 'mic-off' : 'mic'} />
        </button>
        <button type="button" className="acp-btn hangup" onClick={onEnd} aria-label="挂断">
          <KIcon name="phone" />
          挂断
        </button>
      </div>

      <p className="acp-note">通话内容不保存音频；离开本页或点挂断自动结束，不持续计费。</p>
    </section>
  )
}
