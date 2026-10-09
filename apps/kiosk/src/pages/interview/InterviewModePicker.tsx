// 设置屏「交互方式」一行。选中的方式和语音识别探测结果仍由设置页持有。

import { useEffect, type ReactNode } from 'react'
import { getVoiceCapability } from '../../services/api/interview'
import type { InterviewInteractionMode } from './interviewWorkbenchSession'

export type InterviewVoiceAsr = 'unknown' | 'on' | 'off'

export function OptionButton({
  active,
  onClick,
  children,
  className = '',
  disabled = false,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  className?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onClick() }}
      aria-pressed={disabled ? false : active}
      aria-disabled={disabled || undefined}
      className={[
        'interview-option min-h-[52px] rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors',
        active ? 'border-primary-500 bg-primary-50 text-primary-700 shadow-sm' : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  )
}

/** 停用整屏不挂选择器，这一层仍挂着，语音原因才跟得上。不渲染任何节点。 */
export function InterviewVoiceProbe({
  setVoiceAsr,
  setInteractionMode,
}: {
  setVoiceAsr: (value: InterviewVoiceAsr) => void
  setInteractionMode: (mode: InterviewInteractionMode) => void
}) {
  useEffect(() => {
    let cancelled = false
    getVoiceCapability()
      .then((cap) => {
        if (cancelled) return
        if (cap.asrEnabled === true) {
          setVoiceAsr('on')
          return
        }
        if (cap.asrEnabled === false) {
          setVoiceAsr('off')
          setInteractionMode('text')
          return
        }
        setVoiceAsr('unknown')
      })
      .catch(() => { if (!cancelled) setVoiceAsr('unknown') })
    return () => { cancelled = true }
  }, [setVoiceAsr, setInteractionMode])
  return null
}

export function InterviewModePicker({
  mode,
  voiceAsr,
  onModeChange,
}: {
  mode: InterviewInteractionMode
  voiceAsr: InterviewVoiceAsr
  onModeChange: (mode: InterviewInteractionMode) => void
}) {
  return (
    <div className="iv-choice" data-testid="interview-interaction-mode">
      <p>交互方式</p>
      <div className="iv-chips">
        <OptionButton active={mode === 'text'} onClick={() => onModeChange('text')}>纯文字</OptionButton>
        <OptionButton
          active={mode === 'voice'}
          disabled={voiceAsr === 'off'}
          onClick={() => onModeChange('voice')}
        >
          语音回合（文字兜底）
        </OptionButton>
      </div>
      {voiceAsr === 'off' && (
        <p className="iv-hint" role="status" data-testid="interview-mode-voice-reason">
          这台机器的语音识别暂时没开，这一场先用文字答。
        </p>
      )}
    </div>
  )
}
