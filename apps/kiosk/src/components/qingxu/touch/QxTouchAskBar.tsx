import type { CSSProperties } from 'react'
import { QxTouchChip } from './QxTouchChip'
import { QxTouchIcon } from './QxTouchIcon'

/** 问小青长条。语音开关决定「说一句 / 打一句」，没开语音不画麦克风。 */
export function QxTouchAskBar({
  voice,
  onClick,
  index = 0,
}: {
  voice: boolean
  onClick: () => void
  index?: number
}) {
  return (
    <button
      type="button"
      className="qxt-askbar qxt-rise"
      style={{ '--i': index } as CSSProperties}
      data-testid="home-primary"
      onClick={onClick}
    >
      <span className="qxt-orb" aria-hidden="true">
        <QxTouchIcon name={voice ? 'mic' : 'message'} size={46} strokeWidth={2.2} />
      </span>
      <span className="qxt-askbar-tx">
        <b>{voice ? '问小青：说一句你想办的事' : '问小青：打一句你想办的事'}</b>
        {voice ? <small>可打字；语音以本机检测为准</small> : null}
      </span>
      <QxTouchChip ai>AI 数字人</QxTouchChip>
    </button>
  )
}
