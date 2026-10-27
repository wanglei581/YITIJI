import type { CSSProperties } from 'react'
import { QxTouchChip } from './QxTouchChip'
import { QxTouchIcon } from './QxTouchIcon'

/** 问小青长条。文案和 testid 由调用方传入；语音开关只决定图标。 */
export function QxTouchAskBar({
  voice,
  onClick,
  index = 0,
  testId,
  prompt,
  hint,
  mark,
}: {
  voice: boolean
  onClick: () => void
  index?: number
  testId: string
  prompt: string
  hint?: string
  mark: string
}) {
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
        <b>{prompt}</b>
        {hint ? <small>{hint}</small> : null}
      </span>
      <QxTouchChip ai>{mark}</QxTouchChip>
    </button>
  )
}
