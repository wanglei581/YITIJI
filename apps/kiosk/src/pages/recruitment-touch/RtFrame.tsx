import type { ReactNode } from 'react'
import { QxTouchBand, type QxTouchStatus } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchAsk, type QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import './recruit-touch.css'

/**
 * 本包页面壳：意图带 + 可滚动正文 + 底栏。不画底导航（稿上 nav 为空）。
 * 顶栏状态不报打印机；没给 tone 时是灰点，不假装就绪。
 */
export function RtFrame({
  eyebrow,
  title,
  sub,
  status,
  back = true,
  backLabel = '返回',
  onBack,
  ask,
  primary,
  dockExtra,
  overlay,
  testId,
  stateId,
  bodyClassName = 'qxt-body-scroll',
  children,
}: {
  eyebrow?: string
  title: ReactNode
  sub?: ReactNode
  status?: QxTouchStatus
  back?: boolean
  backLabel?: string
  onBack?: () => void
  ask?: QxTouchAsk
  primary?: QxTouchPrimary
  dockExtra?: ReactNode
  overlay?: ReactNode
  testId?: string
  stateId?: string
  bodyClassName?: string
  children: ReactNode
}) {
  return (
    <QxTouchScreen
      testId={testId}
      stateId={stateId}
      bodyClassName={bodyClassName}
      overlay={overlay}
      band={
        <QxTouchBand
          kind="compact"
          eyebrow={eyebrow}
          title={title}
          sub={sub}
          seal={null}
          status={status}
          back={back}
          onBack={onBack}
        />
      }
      dock={
        <div className="rt-fair-dock">
          {dockExtra}
          <QxTouchDock back={back} backLabel={backLabel} onBack={onBack} ask={ask} primary={primary} />
        </div>
      }
    >
      {children}
    </QxTouchScreen>
  )
}
