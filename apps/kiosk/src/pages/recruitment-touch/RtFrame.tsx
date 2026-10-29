import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand, type QxTouchStatus } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchAsk, type QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { RtRibbon } from './RtRibbon'
import './recruit-touch.css'

/**
 * 本包页面壳：私有化版标识条、意图带、正文、一条底栏、三项底导航。
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
  secondary,
  primary,
  boundary,
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
  secondary?: ReactNode
  primary?: QxTouchPrimary
  boundary?: ReactNode
  overlay?: ReactNode
  testId?: string
  stateId?: string
  bodyClassName?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <QxTouchScreen
      page="recruit"
      testId={testId}
      stateId={stateId}
      bodyClassName={bodyClassName}
      overlay={overlay}
      band={
        <>
          <RtRibbon />
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
        </>
      }
      dock={
        <div className="rt-fair-dock">
          {boundary ? <div className="rt-boundary">{boundary}</div> : null}
          <QxTouchDock
            back={back}
            backLabel={backLabel}
            onBack={onBack}
            ask={ask}
            secondary={secondary}
            primary={primary}
          />
        </div>
      }
      nav={
        <QxTouchNav
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      }
    >
      {children}
    </QxTouchScreen>
  )
}
