import { useNavigate } from 'react-router-dom'
import { QxTouchDock } from '../../../components/qingxu/touch/QxTouchDock'
import type { InterviewSessionPhase, InterviewVoiceState } from './types'

/**
 * 作答屏底栏（稿 iv-run）：返回、问小青、主按钮。主按钮永远是这一刻要做的那件事：
 * 文字模式提交回答，语音模式开始回答 / 结束回答并转写 / 确认提交，问完了结束并生成报告。
 * 分析、转写、生成报告期间主按钮置灰并写明在做什么，不会再点出第二次。
 */
export function InterviewSessionBar({
  mode,
  phase,
  voiceKind,
  busy,
  onFinish,
  onSubmit,
  onStart,
  onStop,
  onConfirm,
}: {
  mode: 'voice' | 'text'
  phase: InterviewSessionPhase
  voiceKind: InterviewVoiceState['kind']
  busy: boolean
  onFinish: () => void
  onSubmit: () => void
  onStart: () => void
  onStop: () => void
  onConfirm: () => void
}) {
  const navigate = useNavigate()
  let label = '提交回答'
  let run: 'finish' | 'submit' | 'start' | 'stop' | 'confirm' = 'submit'
  let disabled = busy
  if (phase === 'finishing') {
    label = '正在生成练习报告…'
    disabled = true
  } else if (phase === 'thinking') {
    label = '正在分析你的回答…'
    disabled = true
  } else if (phase === 'done_suggest') {
    label = '结束并生成练习报告'
    run = 'finish'
  } else if (mode === 'voice' && voiceKind === 'recording') {
    label = '结束回答并转写'
    run = 'stop'
    disabled = false
  } else if (mode === 'voice' && voiceKind === 'requesting_permission') {
    label = '正在请求麦克风权限…'
    disabled = true
  } else if (mode === 'voice' && voiceKind === 'transcribing') {
    label = '正在转写你的回答…'
    disabled = true
  } else if (mode === 'voice' && voiceKind === 'review') {
    label = '确认提交'
    run = 'confirm'
  } else if (mode === 'voice') {
    label = '开始回答（语音）'
    run = 'start'
  }
  const go = () => {
    if (run === 'finish') onFinish()
    else if (run === 'submit') onSubmit()
    else if (run === 'start') onStart()
    else if (run === 'stop') onStop()
    else onConfirm()
  }
  return (
    <QxTouchDock
      onBack={() => navigate('/interview-service')}
      backLabel="返回"
      ask={{
        label: '问小青：这一题怎么答',
        draft: '我正在做模拟面试。请先问我这一题的原文，再帮我按真实经历组织回答，不要替我编造经历。',
      }}
      primary={{ label, onClick: go, disabled, testId: 'interview-primary' }}
    />
  )
}
