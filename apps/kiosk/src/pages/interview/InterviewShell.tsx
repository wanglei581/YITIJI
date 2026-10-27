import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand, type QxTouchRail } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import './styles/interview-touch.css'

/**
 * 练面试触屏壳。返回默认去面试服务台，避免五页各自漏传。
 * 底栏仍用 qx-ctabar，打印失败和设置校验的告警选择器继续找得到。
 */
export function InterviewShell({
  title,
  subtitle,
  eyebrow,
  status,
  ctabar,
  navbar = true,
  live = false,
  onBack,
  rail,
  path,
  pathLabel,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  eyebrow?: string
  status?: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  ctabar?: ReactNode
  navbar?: boolean
  /** 正在录音时，意图带按听的状态，不自动开麦。 */
  live?: boolean
  onBack?: () => void
  rail?: QxTouchRail
  path?: readonly string[]
  pathLabel?: string
  children: ReactNode
}) {
  const navigate = useNavigate()
  const pill = status ?? { tone: 'ok' as const, label: 'AI 模拟面试' }
  return (
    <QxTouchScreen
      gallery={false}
      motion="none"
      bodyClassName="qxt-body-iv"
      band={
        <QxTouchBand
          kind="compact"
          eyebrow={eyebrow}
          title={title}
          sub={typeof subtitle === 'string' ? subtitle : undefined}
          seal={live ? 'listen' : null}
          live={live}
          status={{ text: pill.label, tone: pill.tone }}
          rail={rail}
          path={path}
          pathLabel={pathLabel}
          onBack={onBack ?? (() => navigate('/interview-service'))}
          place=" "
        />
      }
      dock={ctabar ? <div className="qx-ctabar qxt-iv-dock">{ctabar}</div> : undefined}
      nav={
        navbar ? (
          <QxTouchNav
            onHome={() => navigate('/')}
            onAdvisor={() => navigate('/assistant')}
            onProfile={() => navigate('/profile')}
          />
        ) : undefined
      }
    >
      {typeof subtitle === 'string' ? null : subtitle ? <p className="qxt-iv-sub">{subtitle}</p> : null}
      {children}
    </QxTouchScreen>
  )
}
