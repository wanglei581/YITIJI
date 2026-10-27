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
}

/**
 * 底栏三槽：返回、问小青、主按钮。问小青不可用时留在原位。
 * 按钮写 label，带到顾问页的是 draft，不自动发送。麦克风只在 voice 时画。
 * 返回为真却没传 onBack 时，有站内历史就回退，否则回首页。
 */
export function QxTouchDock({
  onBack,
  back = true,
  backDisabled = false,
  backLabel = '返回',
  left,
  ask,
  mid,
  primary,
  primaryNode,
}: {
  onBack?: () => void
  back?: boolean
  /** 返回键还在、但此刻不能点（提交中、正在清场）。不传时和以前一样。 */
  backDisabled?: boolean
  backLabel?: string
  left?: ReactNode
  ask?: QxTouchAsk
  mid?: ReactNode
  primary?: QxTouchPrimary
  /** 页面自己画的主操作。不传时底栏与以前一样。和 primary 同时传时只留 primary。 */
  primaryNode?: ReactNode
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
  const wide = !middle && Boolean(primary)
  const leftNode = left ?? (back ? (
    <button type="button" className="qxt-btn qxt-btn-sec" disabled={backDisabled} onClick={goBack}>
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
      ) : primaryNode}
    </footer>
  )
}
