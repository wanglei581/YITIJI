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
import './me-pages.css'

export type { MeBandStatus }

/**
 * 我的与权益各屏的触屏壳。导航默认停在「我的」。
 * 活动列表与活动详情不挂底导航（稿 nav: false）。
 */
export function MeTouchShell({
  title,
  eyebrow,
  sub,
  titleId,
  status,
  showPrinter = false,
  back = true,
  backDisabled = false,
  backLabel = '返回',
  onBack,
  ask,
  primaryNode,
  nav = true,
  overlay,
  children,
  testId,
  stateId,
  bodyClassName = 'qxt-me-pad',
}: {
  title: string
  eyebrow?: string
  sub?: string
  titleId?: string
  status?: MeBandStatus | null
  showPrinter?: boolean
  back?: boolean
  /** 返回键还在但此刻不能点（换绑提交中、正在清场）。 */
  backDisabled?: boolean
  backLabel?: string
  onBack?: () => void
  ask?: QxTouchAsk
  primaryNode?: ReactNode
  nav?: boolean
  /** 弹层。盖在这一屏上，底下的内容变成不可点（QxTouchScreen 负责）。 */
  overlay?: ReactNode
  children: ReactNode
  testId?: string
  stateId?: string
  bodyClassName?: string
}) {
  const navigate = useNavigate()
  const device = useTerminalDeviceStatus()
  const bandStatus = showPrinter ? printerTouchStatus(device) : toTouchStatus(status)
  const place = getTerminalCode() || undefined
  // 返回、问小青、主按钮都没有时不挂底栏。交接屏靠这个只留两张答案卡。
  const showDock = back || Boolean(ask) || primaryNode != null
  return (
    <div data-qx-page="me" className="qxt-me-root">
      <QxTouchScreen
        testId={testId}
        stateId={stateId}
        bodyClassName={bodyClassName}
        overlay={overlay}
        band={(
          <QxTouchBand
            kind="compact"
            eyebrow={eyebrow}
            title={title}
            titleId={titleId}
            sub={sub}
            status={bandStatus}
            back={back}
            backDisabled={backDisabled}
            onBack={onBack}
            seal={null}
            place={place}
          />
        )}
        dock={showDock ? (
          <QxTouchDock
            back={back}
            backDisabled={backDisabled}
            backLabel={backLabel}
            onBack={onBack}
            ask={ask}
            primaryNode={primaryNode}
          />
        ) : undefined}
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
    </div>
  )
}
