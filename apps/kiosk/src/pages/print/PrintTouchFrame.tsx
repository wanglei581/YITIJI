// 打印流程触屏壳。组合第一包的 QxTouchScreen，不改 --qx-*，不改 .qxt-* 默认。
// 底栏优先用触屏三槽；没传 ask / primary 时仍渲染各页已经算好的 ctabar。
// terminalLabel 继续接收但不展示，避免把场所名写死在顶栏。

import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand, type QxTouchSeal, type QxTouchStatus } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchAsk, type QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import '../../styles/qingxu/index.css'
import './styles/print-touch.css'

export const PRINT_TOUCH_RAIL = ['选文件', '材料检查', '预览与参数', '核对价格'] as const

/** 底栏「问小青」。按钮字用稿里的句子；带到顾问页的草稿不自动发送。麦克风跟首页同一开关（语音构建才画）。 */
export function printAsk(label: string, draft: string): QxTouchAsk {
  return { label, draft, voice: import.meta.env.VITE_USE_TRTC_CALL === 'true' }
}

type FrameStatus = { tone: 'ok' | 'warn' | 'bad' | 'unknown' | 'reading'; label: string }

function toTouchStatus(status?: FrameStatus): QxTouchStatus | undefined {
  if (!status) return undefined
  const tone = status.tone === 'ok' ? 'ok' : status.tone === 'unknown' ? 'unknown' : status.tone === 'reading' ? 'reading' : 'warn'
  return { text: status.label, tone }
}

export function PrintTouchFrame({
  page,
  title,
  subtitle,
  status,
  children,
  ctabar,
  navbar,
  back,
  eyebrow = '打印扫描服务',
  railNow,
  bodyClassName,
  testId,
  stateId,
  seal = 'idle',
  kind = 'std',
  ask,
  primary,
  primaryNode,
  dockLeft,
  nav,
  legacyBody = true,
  backLabel,
  statusClassName,
  titleRole,
  titleTag,
}: {
  page?: string
  title: ReactNode
  subtitle?: ReactNode
  status?: FrameStatus
  /** 保留入参，屏上不展示场所名。 */
  terminalLabel?: ReactNode
  children: ReactNode
  ctabar?: ReactNode
  /** 旧调用：只要传入就画触屏底导航，节点本身不再渲染。 */
  navbar?: ReactNode
  back?: { label: string; onBack: () => void }
  eyebrow?: string
  /** 四步轴当前位置。-1 表示还没开始；不传则不画步骤轴。 */
  railNow?: number
  bodyClassName?: string
  testId?: string
  stateId?: string
  seal?: QxTouchSeal | null
  kind?: 'std' | 'compact'
  ask?: QxTouchAsk
  primary?: QxTouchPrimary
  /** 页面自己画的主按钮。不传时仍用 primary。 */
  primaryNode?: ReactNode
  dockLeft?: ReactNode
  /** 为真时画触屏底导航。 */
  nav?: boolean
  /** 旧正文才挂拉伸和重复步骤轨隐藏。新正文传 false。 */
  legacyBody?: boolean
  backLabel?: string
  /** 额外挂到状态胶囊上。不传时类名不变。 */
  statusClassName?: string
  /** 问句标题的角色。不传时仍是标题。 */
  titleRole?: 'status'
  /** 问句标题的标签。不传时仍是 h1。空态门禁要可见的 h2 时才传。 */
  titleTag?: 'h1' | 'h2'
}) {
  const navigate = useNavigate()
  const bandTitle = typeof title === 'string' ? title : '打印'
  const bandSub = typeof subtitle === 'string' ? subtitle : undefined
  const useDock = ask !== undefined || primary !== undefined || primaryNode !== undefined || dockLeft !== undefined
  const showNav = Boolean(nav || navbar)
  return (
    <QxTouchScreen
      buttonReset={false}
      gallery={false}
      frame
      page={page}
      motion="none"
      testId={testId}
      stateId={stateId}
      bodyClassName={['qxt-body-scroll', legacyBody ? 'qxt-print-legacy' : '', bodyClassName].filter(Boolean).join(' ')}
      band={
        <QxTouchBand
          kind={kind}
          eyebrow={eyebrow}
          title={bandTitle}
          sub={bandSub}
          seal={seal}
          status={toTouchStatus(status)}
          statusClassName={statusClassName}
          titleRole={titleRole}
          titleTag={titleTag}
          back={Boolean(back)}
          onBack={back?.onBack}
          rail={typeof railNow === 'number' ? { labels: PRINT_TOUCH_RAIL, now: railNow } : undefined}
        />
      }
      dock={useDock ? (
        <QxTouchDock
          back={Boolean(back)}
          backLabel={backLabel ?? back?.label ?? '上一步'}
          onBack={back?.onBack}
          left={dockLeft}
          ask={ask}
          primary={primary}
          primaryNode={primaryNode}
        />
      ) : ctabar ? <footer className="qxt-print-dock qx-ctabar">{ctabar}</footer> : undefined}
      nav={showNav ? (
        <QxTouchNav
          current="home"
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      ) : undefined}
    >
      {children}
    </QxTouchScreen>
  )
}
