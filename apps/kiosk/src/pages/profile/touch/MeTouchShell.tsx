import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchAsk } from '../../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../../components/qingxu/touch/QxTouchScreen'
import { useTerminalDeviceStatus } from '../../../hooks/useTerminalDeviceStatus'
import { getTerminalCode } from '../../../services/api/terminalConfig'
import { printerTouchStatus, toTouchStatus, type MeBandStatus } from './meTouchStatus'
import './me-touch.css'

export type { MeBandStatus }

/**
 * 我的与权益各屏的触屏壳。导航默认停在「我的」。
 * 活动列表与活动详情不挂底导航（稿 nav: false）。
 */
export function MeTouchShell({
  title,
  sub,
  status,
  showPrinter = false,
  back = true,
  backLabel = '返回',
  onBack,
  ask,
  primaryNode,
  nav = true,
  children,
  testId,
  stateId,
  bodyClassName = 'qxt-body-scroll qxt-me-pad',
}: {
  title: string
  sub?: string
  status?: MeBandStatus | null
  showPrinter?: boolean
  back?: boolean
  backLabel?: string
  onBack?: () => void
  ask?: QxTouchAsk
  primaryNode?: ReactNode
  nav?: boolean
  children: ReactNode
  testId?: string
  stateId?: string
  bodyClassName?: string
}) {
  const navigate = useNavigate()
  const device = useTerminalDeviceStatus()
  const bandStatus = showPrinter ? printerTouchStatus(device) : toTouchStatus(status)
  const place = getTerminalCode() || undefined
  return (
    <QxTouchScreen
      testId={testId}
      stateId={stateId}
      bodyClassName={bodyClassName}
      band={(
        <QxTouchBand
          kind="compact"
          title={title}
          sub={sub}
          status={bandStatus}
          back={back}
          onBack={onBack}
          seal="idle"
          place={place}
        />
      )}
      dock={(
        <QxTouchDock
          back={back}
          backLabel={backLabel}
          onBack={onBack}
          ask={ask}
          primaryNode={primaryNode}
        />
      )}
      nav={nav ? (
        <QxTouchNav
          current="profile"
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      ) : undefined}
    >
      {children}
    </QxTouchScreen>
  )
}
