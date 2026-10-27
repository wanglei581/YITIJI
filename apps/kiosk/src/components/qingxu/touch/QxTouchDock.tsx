import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { rememberAssistantDraft } from '../../../services/assistantDraft'
import { QxTouchIcon } from './QxTouchIcon'
import { useQxTouchBack } from './useQxTouchBack'

export type QxTouchButtonKind = 'pri' | 'sec' | 'ghost' | 'danger' | 'mint'
export type QxTouchAsk =
  | { label: string; draft: string; voice?: boolean }
  | { label: string; disabled: true }
  | false
export type QxTouchPrimary = {
  label: string
  onClick: () => void
  kind?: QxTouchButtonKind
  noArrow?: boolean
  disabled?: boolean
  /** 为真时用 aria-disabled，不写原生 disabled。不传时仍走 disabled。 */
  ariaDisabled?: boolean
}

/**
 * 底栏三槽：返回、问小青、主按钮。问小青不可用时留在原位。
 * 按钮写 label，带到顾问页的是 draft，不自动发送。麦克风只在 voice 时画。
 * 返回为真却没传 onBack 时，有站内历史就回退，否则回首页。
 */
export function QxTouchDock({
  onBack,
  back = true,
  backLabel = '返回',
  left,
  ask,
  mid,
  secondary,
  primary,
}: {
  onBack?: () => void
  back?: boolean
  backLabel?: string
  left?: ReactNode
  ask?: QxTouchAsk
  mid?: ReactNode
  /** 问小青和主按钮之间的次操作。不传时底栏子节点与原来一致。 */
  secondary?: ReactNode
  primary?: QxTouchPrimary
}) {
  const navigate = useNavigate()
  const goBack = useQxTouchBack(onBack)
  const askNode = ask && typeof ask === 'object' ? (
    'disabled' in ask ? (
      <button type="button" className="qxt-askq qxt-askoff" aria-disabled="true" disabled data-qxt-ask="off">
        <span>{ask.label}</span>
      </button>
    ) : (
      <button
        type="button"
        className="qxt-askq"
        data-qxt-ask="on"
        onClick={() => {
          rememberAssistantDraft(ask.draft)
          navigate('/assistant')
        }}
      >
        {ask.voice ? (
          <span className="qxt-mic"><QxTouchIcon name="mic" size={30} strokeWidth={2.2} /></span>
        ) : null}
        <span>{ask.label}</span>
      </button>
    )
  ) : null
  const middle = askNode ?? mid ?? null
  const wide = !middle && !secondary && Boolean(primary)
  const leftNode = left ?? (back ? (
    <button type="button" className="qxt-btn qxt-btn-sec" onClick={goBack}>
      <QxTouchIcon name="chevL" size={30} strokeWidth={2.4} />
      {backLabel}
    </button>
  ) : null)

  return (
    <footer className="qxt-dock">
      {leftNode}
      {middle}
      {secondary}
      {primary ? (
        <button
          type="button"
          className={`qxt-btn qxt-btn-${primary.kind ?? 'pri'}${wide ? ' qxt-wide' : ''}`}
          onClick={() => {
            if (primary.ariaDisabled) return
            primary.onClick()
          }}
          disabled={primary.ariaDisabled ? undefined : primary.disabled}
          aria-disabled={primary.ariaDisabled ? true : undefined}
        >
          {primary.label}
          {primary.noArrow ? null : <QxTouchIcon name="arrowR" size={30} strokeWidth={2.4} />}
        </button>
      ) : null}
    </footer>
  )
}
