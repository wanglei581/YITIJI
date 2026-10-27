import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { rememberAssistantDraft } from '../../../services/assistantDraft'
import { QxTouchIcon } from './QxTouchIcon'
import { useQxTouchBack } from './useQxTouchBack'

export type QxTouchButtonKind = 'pri' | 'sec' | 'ghost' | 'danger' | 'mint'
export type QxTouchAsk =
  | { label: string; draft: string; voice?: boolean; testId?: string }
  | { label: string; disabled: true; testId?: string }
  | false
export type QxTouchPrimary = {
  label: string
  onClick: () => void
  kind?: QxTouchButtonKind
  noArrow?: boolean
  disabled?: boolean
  /** 供用例定位主按钮。不传则不挂 data-testid，默认行为不变。 */
  testId?: string
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
  primary,
  className,
}: {
  onBack?: () => void
  back?: boolean
  backLabel?: string
  left?: ReactNode
  ask?: QxTouchAsk
  mid?: ReactNode
  primary?: QxTouchPrimary
  /** 附加在底栏上的类，供页面样式与用例定位。不传则不变。 */
  className?: string
}) {
  const navigate = useNavigate()
  const goBack = useQxTouchBack(onBack)
  const askNode = ask && typeof ask === 'object' ? (
    'disabled' in ask ? (
      <button type="button" className="qxt-askq qxt-askoff" aria-disabled="true" disabled data-qxt-ask="off" data-testid={ask.testId}>
        <span>{ask.label}</span>
      </button>
    ) : (
      <button
        type="button"
        className="qxt-askq"
        data-qxt-ask="on"
        data-testid={ask.testId}
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
    <button type="button" className="qxt-btn qxt-btn-sec" onClick={goBack}>
      <QxTouchIcon name="chevL" size={30} strokeWidth={2.4} />
      {backLabel}
    </button>
  ) : null)

  return (
    <footer className={['qxt-dock', className].filter(Boolean).join(' ')}>
      {leftNode}
      {middle}
      {primary ? (
        <button
          type="button"
          className={`qxt-btn qxt-btn-${primary.kind ?? 'pri'}${wide ? ' qxt-wide' : ''}`}
          onClick={primary.onClick}
          disabled={primary.disabled}
          data-testid={primary.testId}
        >
          {primary.label}
          {primary.noArrow ? null : <QxTouchIcon name="arrowR" size={30} strokeWidth={2.4} />}
        </button>
      ) : null}
    </footer>
  )
}
