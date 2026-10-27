import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchAsk } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import { rememberAssistantDraft } from '../../services/assistantDraft'
import './styles/tool-touch.css'
import './styles/tool-fs.css'

/**
 * 扫描复印与打印工具共用的触屏壳。
 * 问小青只记住草稿再离开；这些页没有扫描会话要撤。
 */
export function TouchToolScreen({
  eyebrow,
  title,
  sub,
  status,
  onBack,
  backLabel = '返回打印扫描',
  askLabel,
  dock,
  place,
  children,
}: {
  eyebrow?: string
  title: string
  sub?: string
  status?: { text: string; tone?: 'ok' | 'warn' | 'unknown' }
  onBack: () => void
  backLabel?: string
  askLabel: string
  dock?: ReactNode
  place?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  const ask: QxTouchAsk = { label: askLabel, draft: askLabel }
  return (
    <QxTouchScreen
      className="qx-stage"
      legacyFrame
      bodyClassName="qxt-body-tight"
      band={
        <QxTouchBand
          kind="compact"
          className="qx-topbar"
          backClassName="qx-topbar-back"
          backLabel={backLabel}
          onBack={onBack}
          eyebrow={eyebrow}
          title={title}
          sub={sub}
          seal={null}
          place={place ?? ' '}
          status={status === undefined ? undefined : { text: status.text, tone: status.tone ?? 'unknown' }}
        />
      }
      dock={
        <QxTouchDock
          className="qx-ctabar"
          back={false}
          ask={ask}
          onAsk={() => {
            rememberAssistantDraft(askLabel)
            navigate('/assistant')
          }}
          mid={dock}
        />
      }
      nav={
        <QxTouchNav
          className="qx-navbar"
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
