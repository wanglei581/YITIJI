import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { rememberAssistantDraft } from '../../../services/assistantDraft'
import { QxTouchIcon } from './QxTouchIcon'

export type QxTouchButtonKind = 'pri' | 'sec' | 'ghost' | 'danger' | 'mint'
export type QxTouchAsk = string | { label: string; disabled: true } | false
export type QxTouchPrimary = {
  label: string
  onClick: () => void
  kind?: QxTouchButtonKind
  noArrow?: boolean
  disabled?: boolean
}

/**
 * 底栏三槽：返回、问小青、主按钮。问小青不可用时留在原位。
 * 可用时只把这一句草稿带到顾问页，不自动发送。
 */
export function QxTouchDock({
  onBack,
  back = true,
  backLabel = '返回',
  left,
  ask,
  mid,
  primary,
}: {
  onBack?: () => void
  back?: boolean
  backLabel?: string
  left?: ReactNode
  ask?: QxTouchAsk
  mid?: ReactNode
  primary?: QxTouchPrimary
}) {
  const navigate = useNavigate()
  const askNode = ask && typeof ask === 'object' ? (
    <button type="button" className="qxt-askq qxt-askoff" aria-disabled="true" disabled data-qxt-ask="off">
      <span className="qxt-mic"><QxTouchIcon name="mic" size={30} strokeWidth={2.2} /></span>
      <span>{ask.label}</span>
    </button>
  ) : typeof ask === 'string' ? (
    <button
      type="button"
      className="qxt-askq"
      data-qxt-ask="on"
      onClick={() => {
        rememberAssistantDraft(ask)
        navigate('/assistant')
      }}
    >
      <span className="qxt-mic"><QxTouchIcon name="mic" size={30} strokeWidth={2.2} /></span>
      <span>{ask}</span>
    </button>
  ) : null
  const middle = askNode ?? mid ?? null
  const wide = !middle && Boolean(primary)
  const leftNode = left ?? (back ? (
    <button type="button" className="qxt-btn qxt-btn-sec" onClick={onBack}>
      <QxTouchIcon name="chevL" size={30} strokeWidth={2.4} />
      {backLabel}
    </button>
  ) : null)

  return (
    <footer className="qxt-dock">
      {leftNode}
      {middle}
      {primary ? (
        <button
          type="button"
          className={`qxt-btn qxt-btn-${primary.kind ?? 'pri'}${wide ? ' qxt-wide' : ''}`}
          onClick={primary.onClick}
          disabled={primary.disabled}
        >
          {primary.label}
          {primary.noArrow ? null : <QxTouchIcon name="arrowR" size={30} strokeWidth={2.4} />}
        </button>
      ) : null}
    </footer>
  )
}
