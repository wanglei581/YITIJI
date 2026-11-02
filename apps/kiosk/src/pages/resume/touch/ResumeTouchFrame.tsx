// 第 7 包简历页的触屏壳。业务文案留在各页，这里只换青序流光触屏版的带、底栏和导航。
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand, type QxTouchRail, type QxTouchStatus } from '../../../components/qingxu/touch/QxTouchBand'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import { QxTouchNav } from '../../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../../components/qingxu/touch/QxTouchScreen'
import { rememberAssistantDraft } from '../../../services/assistantDraft'
import type { ResumeAsk } from './resumeAsks'
import './resume-touch.css'

function toneOf(tone: 'ok' | 'warn' | 'bad' | 'unknown' | undefined): 'ok' | 'warn' | 'unknown' {
  if (tone === 'ok') return 'ok'
  if (tone === 'warn' || tone === 'bad') return 'warn'
  return 'unknown'
}

export type ResumeTouchFrameProps = {
  /** 标题可以带节点（自我探索的问句里有强调）。 */
  title: ReactNode
  subtitle?: ReactNode
  /** 拿不到真实状态就传 unknown；不传时壳上仍写「状态未知」。 */
  status?: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  terminalLabel?: string
  children: ReactNode
  ctabar?: ReactNode
  back?: { label: string; onBack: () => void }
  eyebrow?: string
  rail?: QxTouchRail
  stateId?: string
  overlay?: ReactNode
  /** 传给底导航三个按钮的 testid。不传则导航按钮没有 testid。 */
  navTestIds?: { home?: string; advisor?: string; profile?: string }
  /**
   * 底栏的「问小青」：label 照稿、draft 预填到顾问页输入框（用户自己按发送才会发出）。
   * 单独占底栏最下面一整行：同一行里已经有两三个按钮，挤在中间放不下。不传或传 false 就不画（稿里 ask 为 false 的屏）。
   */
  ask?: ResumeAsk | false
}

/** 麦克风只在这台机器真的开了语音通话时才画，和首页、开发样板同一个判据。 */
const ASK_HAS_VOICE = import.meta.env.VITE_USE_TRTC_CALL === 'true'

export function ResumeTouchFrame(props: ResumeTouchFrameProps) {
  const navigate = useNavigate()
  const status: QxTouchStatus = {
    text: props.status?.label ?? '状态未知',
    tone: toneOf(props.status?.tone),
  }
  const ask = props.ask || null
  const askNode = ask ? (
    <button
      type="button"
      className="qxt-askq"
      data-qxt-ask="on"
      data-testid={ask.testId}
      onClick={() => {
        rememberAssistantDraft(ask.draft)
        navigate('/assistant')
      }}
    >
      {ASK_HAS_VOICE ? <span className="qxt-mic"><QxTouchIcon name="mic" size={30} strokeWidth={2.2} /></span> : null}
      <span>{ask.label}</span>
    </button>
  ) : null
  return (
    <QxTouchScreen
      stateId={props.stateId}
      bodyClassName="qxt-body-tight rtp"
      band={(
        <QxTouchBand
          kind="compact"
          eyebrow={props.eyebrow ?? '改简历'}
          title={props.title}
          sub={props.subtitle}
          place={props.terminalLabel}
          seal={null}
          status={status}
          rail={props.rail}
          onBack={props.back?.onBack}
          back={Boolean(props.back)}
          backLabel={props.back?.label}
        />
      )}
      dock={props.ctabar || askNode ? <footer className="qxt-dock rtp-cta">{props.ctabar}{askNode}</footer> : undefined}
      nav={(
        <QxTouchNav
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
          testIds={props.navTestIds}
        />
      )}
      overlay={props.overlay}
    >
      <div className="rtp-fill">{props.children}</div>
    </QxTouchScreen>
  )
}
