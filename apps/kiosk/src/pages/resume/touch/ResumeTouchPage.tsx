import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand, type QxTouchStatus } from '../../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchAsk, type QxTouchPrimary } from '../../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../../components/qingxu/touch/QxTouchScreen'
import { FLOW_RAIL } from '../resume-report-model'
import './resume-touch.css'

type FrameStatus = { tone?: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }

function toStatus(status?: FrameStatus | QxTouchStatus): QxTouchStatus | undefined {
  if (status === false) return false
  if (!status) return undefined
  if ('text' in status) return status
  const tone = status.tone === 'bad' ? 'warn' : status.tone === 'ok' ? 'ok' : status.tone === 'warn' ? 'warn' : 'unknown'
  return { text: status.label, tone }
}

/**
 * 简历三条主路的触屏壳。底栏若传入 ctabar，就原样放进中槽，不再另画问小青，避免主按钮被挤掉。
 */
export function ResumeTouchPage({
  eyebrow,
  title,
  subtitle,
  status,
  railNow = 0,
  showRail = true,
  seal = 'idle',
  back,
  backLabel,
  onBack,
  ask,
  primary,
  ctabar,
  testId,
  stateId,
  navCurrent,
  navTestIds,
  bandKind = 'compact',
  bodyClassName,
  children,
  overlay,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  status?: FrameStatus | QxTouchStatus
  railNow?: number
  showRail?: boolean
  seal?: 'idle' | 'listen' | 'think' | null
  back?: { label: string; onBack: () => void }
  backLabel?: string
  onBack?: () => void
  ask?: QxTouchAsk
  primary?: QxTouchPrimary
  ctabar?: ReactNode
  navbar?: ReactNode
  terminalLabel?: string
  testId?: string
  stateId?: string
  navCurrent?: 'home' | 'advisor' | 'profile'
  /** 可选。不传时底导航不写 data-testid。 */
  navTestIds?: { home?: string; advisor?: string; profile?: string }
  bandKind?: 'std' | 'compact'
  bodyClassName?: string
  children: ReactNode
  overlay?: ReactNode
}) {
  const navigate = useNavigate()
  const goBack = back?.onBack ?? onBack
  const backName = back?.label ?? backLabel ?? '返回'
  return (
    <QxTouchScreen
      testId={testId}
      stateId={stateId}
      overlay={overlay}
      bodyClassName={bodyClassName ?? 'qxt-body-tight'}
      band={(
        <QxTouchBand
          kind={bandKind}
          eyebrow={eyebrow}
          title={title}
          sub={subtitle}
          place=" "
          seal={seal}
          status={toStatus(status)}
          statusClassName="qx-pill"
          rail={showRail ? { labels: FLOW_RAIL, now: railNow } : undefined}
          onBack={goBack}
          backLabel={backName}
        />
      )}
      dock={(
        <QxTouchDock
          onBack={goBack}
          backLabel={backName === '返回简历来源' ? '返回' : backName}
          ask={ctabar ? false : ask}
          mid={ctabar ? <div className="qx-ctabar">{ctabar}</div> : undefined}
          primary={ctabar ? undefined : primary}
        />
      )}
      nav={(
        <QxTouchNav
          current={navCurrent}
          testIds={navTestIds}
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      )}
    >
      {children}
    </QxTouchScreen>
  )
}
