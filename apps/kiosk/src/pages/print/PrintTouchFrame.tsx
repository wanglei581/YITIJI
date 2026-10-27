// 打印流程触屏壳。组合第一包的 QxTouchScreen，不改 --qx-*。
// 底栏沿用各页已经算好的 ctabar（金额、禁用、多按钮），导航换成触屏三键。
// terminalLabel 继续接收但不展示，避免把「就业服务大厅」写死在顶栏。

import { type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { QxTouchBand, type QxTouchStatus } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import '../../styles/qingxu/index.css'
import './styles/print-touch.css'

export const PRINT_TOUCH_RAIL = ['选文件', '材料检查', '预览与参数', '核对价格'] as const

type FrameStatus = { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }

function toTouchStatus(status?: FrameStatus): QxTouchStatus | undefined {
  if (!status) return undefined
  const tone = status.tone === 'ok' ? 'ok' : status.tone === 'unknown' ? 'unknown' : 'warn'
  return { text: status.label, tone }
}

export function PrintTouchFrame({
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
}: {
  title: ReactNode
  subtitle?: ReactNode
  status?: FrameStatus
  terminalLabel?: ReactNode
  children: ReactNode
  ctabar?: ReactNode
  navbar?: ReactNode
  back?: { label: string; onBack: () => void }
  eyebrow?: string
  /** 四步轴当前位置。-1 表示还没开始；不传则不画步骤轴。 */
  railNow?: number
  bodyClassName?: string
  testId?: string
}) {
  const navigate = useNavigate()
  const bandTitle = typeof title === 'string' ? title : '打印'
  const bandSub = typeof subtitle === 'string' ? subtitle : undefined
  return (
    <QxTouchScreen
      buttonReset={false}
      motion="none"
      testId={testId}
      bodyClassName={['qxt-body-scroll', 'qxt-print-legacy', bodyClassName].filter(Boolean).join(' ')}
      band={
        <QxTouchBand
          kind="compact"
          eyebrow={eyebrow}
          title={bandTitle}
          sub={bandSub}
          status={toTouchStatus(status)}
          back={Boolean(back)}
          onBack={back?.onBack}
          rail={typeof railNow === 'number' ? { labels: PRINT_TOUCH_RAIL, now: railNow } : undefined}
        />
      }
      dock={ctabar ? <footer className="qxt-print-dock qx-ctabar">{ctabar}</footer> : undefined}
      nav={navbar ? (
        <QxTouchNav
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
