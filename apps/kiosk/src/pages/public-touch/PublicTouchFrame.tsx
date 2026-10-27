import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand, type QxTouchStatus } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { useSupportContact } from '../../hooks/useSupportContact'
import { helpNeededLine, machineCannotPrintLine } from '../../copy/unattendedCopy'
import './public-touch.css'

export type PublicStatus =
  | { label: string; tone?: 'ok' | 'warn' | 'bad' | 'unknown' | 'reading' }
  | false

function toStatus(status: PublicStatus | undefined): QxTouchStatus | undefined {
  if (status === undefined) return undefined
  if (status === false) return false
  const tone = status.tone === 'ok'
    ? 'ok'
    : status.tone === 'warn' || status.tone === 'bad'
      ? 'warn'
      : status.tone === 'reading'
        ? 'reading'
        : 'unknown'
  return { text: status.label, tone }
}

export function usePublicNav() {
  const navigate = useNavigate()
  return {
    onHome: () => navigate('/'),
    onAdvisor: () => navigate('/assistant'),
    onProfile: () => navigate('/profile'),
  }
}

/** 有号码才返回求助句。读不到号码时不显示，也不改写成隐私政策提示。 */
export function useVisibleHelpLine(fault = false): string | null {
  const contact = useSupportContact()
  if (!contact.servicePhone) return null
  return fault ? machineCannotPrintLine(contact) : helpNeededLine(contact)
}

export function PublicTouchFrame({
  title,
  sub,
  eyebrow,
  status,
  back,
  dock,
  nav = true,
  navCurrent,
  testId,
  stateId,
  screen,
  page,
  className,
  bodyClassName = 'qxt-body-tight',
  band = true,
  children,
}: {
  title: string
  sub?: string
  eyebrow?: string
  status?: PublicStatus
  back?: { label: string; onBack: () => void } | false
  dock?: ReactNode
  nav?: boolean
  navCurrent?: 'home' | 'advisor' | 'profile'
  testId?: string
  stateId?: string
  screen?: string
  /** 挂到 `[data-qx-page]`，供本页样式使用。不传时用 screen。 */
  page?: string
  className?: string
  bodyClassName?: string
  band?: boolean
  children: ReactNode
}) {
  const navHandlers = usePublicNav()
  const showBack = back !== false
  const pageId = page ?? screen
  return (
    <QxTouchScreen
      gallery={false}
      page={pageId}
      frameMarker
      className={['qxp-app', className].filter(Boolean).join(' ')}
      testId={testId}
      stateId={stateId}
      motion="none"
      bodyClassName={bodyClassName}
      band={band ? (
        <QxTouchBand
          kind="compact"
          eyebrow={eyebrow}
          title={title}
          sub={sub}
          seal={null}
          status={toStatus(status)}
          back={showBack}
          backLabel={showBack ? back?.label : undefined}
          onBack={showBack ? back?.onBack : undefined}
        />
      ) : null}
      dock={dock}
      nav={nav ? <QxTouchNav current={navCurrent} {...navHandlers} /> : undefined}
    >
      <main className="qxp-fill" data-kiosk-screen={screen}>{children}</main>
    </QxTouchScreen>
  )
}
