import type { CSSProperties } from 'react'
import { QxTouchChip } from './QxTouchChip'
import { QxTouchIcon } from './QxTouchIcon'

const SPOKEN = '问小青：说一句你想办的事'
const TYPED = '问小青：打一句你想办的事'
const VOICE_HINT = '可打字；语音以本机检测为准'
const DEFAULT_MARK = 'AI 数字人'

/** 问小青长条。不传文案时保持原来的首页句；语音开关只决定图标。 */
export function QxTouchAskBar({
  voice,
  onClick,
  index = 0,
  testId = 'home-primary',
  prompt,
  hint,
  mark = DEFAULT_MARK,
}: {
  voice: boolean
  onClick: () => void
  index?: number
  testId?: string
  prompt?: string
  hint?: string
  mark?: string
}) {
  const line = prompt ?? (voice ? SPOKEN : TYPED)
  const aside = hint ?? (voice ? VOICE_HINT : undefined)
  return (
    <button
      type="button"
      className="qxt-askbar qxt-rise"
      style={{ '--i': index } as CSSProperties}
      data-testid={testId}
      onClick={onClick}
    >
      <span className="qxt-orb" aria-hidden="true">
        <QxTouchIcon name={voice ? 'mic' : 'message'} size={46} strokeWidth={2.2} />
      </span>
      <span className="qxt-askbar-tx">
        <b>{line}</b>
        {aside ? <small>{aside}</small> : null}
      </span>
      <QxTouchChip ai>{mark}</QxTouchChip>
    </button>
  )
}
