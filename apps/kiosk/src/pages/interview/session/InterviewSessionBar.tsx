import { QxAiHelp } from '../../../components/qingxu/QxAiHelp'
import type { InterviewSessionPhase, InterviewVoiceState } from './types'

/**
 * 稿 29 作答屏底部：结束本场练习 + 主按钮。
 * 语音不可用时主按钮换成当前能做的那一项，不把「改用语音回答」做成唯一出口。
 */
export function InterviewSessionBar({
  mode,
  phase,
  voiceKind,
  voiceAvailable,
  busy,
  onFinish,
  onSubmit,
  onUseVoice,
  onUseText,
  onStop,
  onConfirm,
}: {
  mode: 'voice' | 'text'
  phase: InterviewSessionPhase
  voiceKind: InterviewVoiceState['kind']
  voiceAvailable: boolean
  busy: boolean
  onFinish: () => void
  onSubmit: () => void
  onUseVoice: () => void
  onUseText: () => void
  onStop: () => void
  onConfirm: () => void
}) {
  const finishing = phase === 'finishing'
  let label = '改用语音回答'
  let run: 'finish' | 'submit' | 'voice' | 'text' | 'stop' | 'confirm' = 'voice'
  let disabled = busy
  if (phase === 'done_suggest') {
    label = '结束并生成练习报告'
    run = 'finish'
  } else if (mode === 'voice' && voiceKind === 'recording') {
    label = '结束回答并转写'
    run = 'stop'
    disabled = false
  } else if (mode === 'voice' && voiceKind === 'review') {
    label = '确认并提交'
    run = 'confirm'
  } else if (mode === 'voice') {
    label = '改用文字输入'
    run = 'text'
  } else if (!voiceAvailable) {
    label = '提交回答'
    run = 'submit'
  }
  const go = () => {
    if (run === 'finish') onFinish()
    else if (run === 'submit') onSubmit()
    else if (run === 'voice') onUseVoice()
    else if (run === 'text') onUseText()
    else if (run === 'stop') onStop()
    else onConfirm()
  }
  return (
    <div className="interview-qx-cta">
      <QxAiHelp
        label="问小青：这一题怎么答"
        draft="我正在做模拟面试。请先问我这一题的原文，再帮我按真实经历组织回答，不要替我编造经历。"
      />
      <div className="iv-cta-row">
        <button type="button" className="qx-btn" data-variant="ghost" disabled={finishing || busy} onClick={onFinish}>
          结束本场练习
        </button>
        <button type="button" className="qx-btn" data-variant="primary" disabled={disabled || finishing} onClick={go}>
          {label}<em>→</em>
        </button>
      </div>
    </div>
  )
}
