// 第 7 包简历页的触屏壳。业务文案留在各页，这里只换青序流光触屏版的带、底栏和导航。
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { QxPageFrameProps } from '../../../components/qingxu/QxPageFrame'
import { QxTouchBand, type QxTouchRail, type QxTouchStatus } from '../../../components/qingxu/touch/QxTouchBand'
import { QxTouchNav } from '../../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../../components/qingxu/touch/QxTouchScreen'
import './resume-touch.css'

function toneOf(tone: 'ok' | 'warn' | 'bad' | 'unknown' | undefined): 'ok' | 'warn' | 'unknown' {
  if (tone === 'ok') return 'ok'
  if (tone === 'warn' || tone === 'bad') return 'warn'
  return 'unknown'
}

export function ResumeTouchFrame(props: QxPageFrameProps & {
  eyebrow?: string
  rail?: QxTouchRail
  stateId?: string
  overlay?: ReactNode
}) {
  const navigate = useNavigate()
  const title = typeof props.title === 'string' ? props.title : '简历'
  const sub = typeof props.subtitle === 'string' ? props.subtitle : undefined
  const place = typeof props.terminalLabel === 'string' ? props.terminalLabel : undefined
  const status: QxTouchStatus = {
    text: props.status?.label ?? '状态未知',
    tone: toneOf(props.status?.tone),
  }
  return (
    <QxTouchScreen
      stateId={props.stateId}
      bodyClassName="qxt-body-tight rtp"
      band={(
        <QxTouchBand
          kind="compact"
          eyebrow={props.eyebrow ?? '改简历'}
          title={title}
          sub={sub}
          place={place}
          seal={null}
          status={status}
          rail={props.rail}
          onBack={props.back?.onBack}
          back={Boolean(props.back)}
        />
      )}
      dock={props.ctabar ? <footer className="qxt-dock rtp-cta">{props.ctabar}</footer> : undefined}
      nav={(
        <QxTouchNav
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      )}
      overlay={props.overlay}
    >
      <div className="rtp-fill">{props.children}</div>
    </QxTouchScreen>
  )
}
