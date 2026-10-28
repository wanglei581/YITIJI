import { useNavigate } from 'react-router-dom'
import { QxTouchBand } from '../../components/qingxu/touch/QxTouchBand'
import { QxTouchDock, type QxTouchAsk, type QxTouchPrimary } from '../../components/qingxu/touch/QxTouchDock'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { QxTouchNav } from '../../components/qingxu/touch/QxTouchNav'
import { QxTouchScreen } from '../../components/qingxu/touch/QxTouchScreen'
import type { ReactNode } from 'react'
import { AiDownNote } from './AiDownNote'
import './styles/tool-touch.css'
import './styles/tool-fs.css'

/**
 * 扫描复印与打印工具共用的触屏壳。
 * 底栏三槽照稿：左边「返回」（文字和顶栏返回键同名）、中间问小青、右边主按钮。
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
  left,
  primary,
  place,
  overlay,
  children,
}: {
  eyebrow?: string
  title: string
  sub?: ReactNode
  status?: { text: string; tone?: 'ok' | 'warn' | 'unknown' }
  onBack: () => void
  backLabel?: string
  askLabel: string
  /** 底栏左键。不传就是「返回打印扫描」（同顶栏返回键）；签名页的出口名随状态变，所以可以换。 */
  left?: { label: string; onClick: () => void; testId?: string }
  /** 右边主按钮。不传就只有返回和问小青。 */
  primary?: QxTouchPrimary
  place?: string
  /** 盖在这一屏上的层（二维码层等）。传了，底下的整片屏幕就是 inert。 */
  overlay?: ReactNode
  children: ReactNode
}) {
  const navigate = useNavigate()
  const ask: QxTouchAsk = { label: askLabel, draft: askLabel, voice: true }
  return (
    <QxTouchScreen
      className="scan-touch"
      legacyFrame
      bodyClassName="qxt-body-tight"
      overlay={overlay}
      band={
        <QxTouchBand
          kind="compact"
          backLabel={backLabel}
          onBack={onBack}
          eyebrow={eyebrow}
          title={title}
          sub={sub}
          seal={null}
          place={place}
          status={status === undefined ? undefined : { text: status.text, tone: status.tone ?? 'unknown' }}
        />
      }
      dock={
        <QxTouchDock
          back={false}
          left={(
            <button
              type="button"
              className="qxt-btn qxt-btn-sec"
              data-testid={left?.testId}
              onClick={left?.onClick ?? onBack}
            >
              <QxTouchIcon name="chevL" size={30} strokeWidth={2.4} />
              {left?.label ?? backLabel}
            </button>
          )}
          ask={ask}
          primary={primary}
        />
      }
      nav={
        <QxTouchNav
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      }
    >
      <AiDownNote />
      {children}
    </QxTouchScreen>
  )
}
