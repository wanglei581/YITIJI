import type { ReactNode } from 'react'
import { QxTouchBand, type QxTouchStatus } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { usePublicNav } from './publicTouchHooks'
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
  overlay,
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
  /** 盖在整屏上的弹层。交给 QxTouchScreen 处理底下的 inert，不要把弹层写进正文里。 */
  overlay?: ReactNode
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
      overlay={overlay}
    >
      {/* main 地标交给 KioskLayout，页面不再自画一个（否则 /assistant、/help 会有两个，独立路由会多出一个） */}
      <div className="qxp-fill" data-kiosk-screen={screen}>{children}</div>
    </QxTouchScreen>
  )
}
