import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { rememberAssistantDraft } from '../../../services/assistantDraft'
import { QxTouchIcon } from './QxTouchIcon'
import { useQxTouchBack } from './useQxTouchBack'

export type QxTouchButtonKind = 'pri' | 'sec' | 'ghost' | 'danger' | 'mint'
export type QxTouchAsk =
  | {
      label: string
      draft: string
      voice?: boolean
      testId?: string
      /**
       * 点下问小青、还没记草稿之前先跑。返回 false 就到此为止，由页面自己离开
       * （例如扫描流程要先撤销会话再去顾问页）；返回其它值照常记草稿去顾问页。
       */
      beforeAsk?: () => boolean | void
    }
  | { label: string; disabled: true; testId?: string }
  | false
export type QxTouchPrimary = {
  label: string
  onClick: () => void
  kind?: QxTouchButtonKind
  noArrow?: boolean
  disabled?: boolean
  /**
   * 为真时只写 aria-disabled、不写原生 disabled：按钮仍能点，点了照常调 onClick，
   * 由页面说明为什么不能继续，或者在 onClick 里自己什么都不做。
   */
  ariaDisabled?: boolean
  /** 不传时不写 data-testid。 */
  testId?: string
  /** 追加到主按钮上的类名。 */
  className?: string
}

/**
 * 底栏三槽：返回、问小青、主按钮。问小青不可用时留在原位。
 * 按钮写 label，带到顾问页的是 draft，不自动发送。麦克风只在 voice 时画。
 * 返回为真却没传 onBack 时，有站内历史就回退，否则回首页。
 * 可选参数是各页面包要的，10/28 并成一套；都不传时底栏和第一包一样。
 */
export function QxTouchDock({
  onBack,
  back = true,
  backDisabled = false,
  backLabel = '返回',
  left,
  ask,
  mid,
  secondary,
  primary,
  primaryNode,
  alert,
  className,
}: {
  onBack?: () => void
  back?: boolean
  /** 返回键还在、但此刻不能点（提交中、正在清场）。 */
  backDisabled?: boolean
  backLabel?: string
  left?: ReactNode
  ask?: QxTouchAsk
  /** 中间槽。和 ask 同时传时只画 ask；两个都要时把另一个放进 secondary。 */
  mid?: ReactNode
  /** 中间槽和主按钮之间的次操作。 */
  secondary?: ReactNode
  primary?: QxTouchPrimary
  /** 页面自己画的主操作。传了就不再按 primary 生成主按钮。 */
  primaryNode?: ReactNode
  /** 底栏里排在最前面的告警。 */
  alert?: ReactNode
  /** 追加到底栏上的类名。 */
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
          if (ask.beforeAsk && ask.beforeAsk() === false) return
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
    <button type="button" className="qxt-btn qxt-btn-sec" disabled={backDisabled} onClick={goBack}>
      <QxTouchIcon name="chevL" size={30} strokeWidth={2.4} />
      {backLabel}
    </button>
  ) : null)

  const primaryButton = primary ? (
    <button
      type="button"
      className={['qxt-btn', `qxt-btn-${primary.kind ?? 'pri'}`, wide ? 'qxt-wide' : '', primary.className].filter(Boolean).join(' ')}
      onClick={primary.onClick}
      disabled={primary.ariaDisabled ? undefined : primary.disabled}
      aria-disabled={primary.ariaDisabled ? true : undefined}
      data-testid={primary.testId}
    >
      {primary.label}
      {primary.noArrow ? null : <QxTouchIcon name="arrowR" size={30} strokeWidth={2.4} />}
    </button>
  ) : null

  return (
    <footer className={['qxt-dock', className].filter(Boolean).join(' ')}>
      {alert}
      {leftNode}
      {middle}
      {secondary}
      {primaryNode ?? primaryButton}
    </footer>
  )
}
