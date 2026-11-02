import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand, type QxTouchBandKind, type QxTouchSeal, type QxTouchStatus } from '../../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchAsk, type QxTouchPrimary } from '../../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../../components/qingxu/touch/QxTouchScreen'
import { FLOW_RAIL } from '../resume-report-model'
import './frame.css'

/** 本机是否开了语音入口。和首页问小青条同一个开关：没开就不画麦克风。 */
export const RESUME_ASK_VOICE = import.meta.env.VITE_USE_TRTC_CALL === 'true'

/** 旧写法 { tone, label }（bad 记成告警色）与新写法 { text, tone } 都收。 */
type FrameStatus = { tone?: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }

function toStatus(status?: FrameStatus | QxTouchStatus): QxTouchStatus | undefined {
  if (status === false) return false
  if (!status) return undefined
  if ('text' in status) return status
  const tone = status.tone === 'ok' ? 'ok' : status.tone === 'warn' || status.tone === 'bad' ? 'warn' : 'unknown'
  return { text: status.label, tone }
}

/** 问小青按钮：没单独说明语音时，跟着本机的语音开关走。 */
function withVoice(ask?: QxTouchAsk): QxTouchAsk | undefined {
  if (!ask || 'disabled' in ask || ask.voice !== undefined) return ask
  return { ...ask, voice: RESUME_ASK_VOICE }
}

/**
 * 简历三条主路共用的触屏壳：意图带、选择区、底栏、底导航。
 * 步骤条 rail 默认画四步（上传与方向 / AI 解析 / 诊断报告 / 优化打印），railNow 是当前步；
 * showRail 为假时不画步骤条。底栏中槽可以放自己的内容（mid），此时不再画问小青。
 */
export function ResumeTouchPage({
  eyebrow,
  title,
  subtitle,
  status,
  railNow = 0,
  railMarks,
  showRail = true,
  seal = null,
  back,
  backLabel,
  dockBackLabel,
  onBack,
  ask,
  mid,
  primary,
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
  /** 步骤条上失败 / 结果未确认的那一步（步号从 0 起）。不传就按 railNow 画。 */
  railMarks?: Readonly<Record<number, 'bad' | 'wait'>>
  showRail?: boolean
  seal?: QxTouchSeal | null
  back?: { label: string; onBack: () => void }
  backLabel?: string
  /** 底栏返回键上写的字。不传就用 backLabel。顶栏返回键的读屏名始终是 back.label / backLabel。 */
  dockBackLabel?: string
  onBack?: () => void
  ask?: QxTouchAsk
  mid?: ReactNode
  primary?: QxTouchPrimary
  testId?: string
  stateId?: string
  navCurrent?: 'home' | 'advisor' | 'profile'
  /** 可选。不传时底导航不写 data-testid。 */
  navTestIds?: { home?: string; advisor?: string; profile?: string }
  bandKind?: QxTouchBandKind
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
          rail={showRail ? { labels: FLOW_RAIL, now: railNow, marks: railMarks } : undefined}
          onBack={goBack}
          backLabel={backName}
        />
      )}
      dock={(
        <QxTouchDock
          onBack={goBack}
          backLabel={dockBackLabel ?? backLabel ?? '返回'}
          ask={mid ? false : withVoice(ask)}
          mid={mid}
          primary={primary}
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
