import { useLocation, useNavigate } from 'react-router-dom'
import { QxTouchIcon, type QxTouchIconName } from '../components/qingxu/touch/QxTouchIcon'
import { KioskStageFit } from '../components/kiosk-shell/KioskStageFit'
import { LICENSE_NO_NEW_TASK_REASON, licenseWindDownLine } from '../copy/unattendedCopy'
import { Hit } from '../pages/public-touch/PublicBlocks'
import { PublicTouchFrame } from '../pages/public-touch/PublicTouchFrame'
import { useKioskLicense } from './KioskLicenseContext'
import '../pages/placeholders/system-state-qx.css'
import '../pages/placeholders/offline-touch.css'

/** 收尾中仍可进的页。文案取自「我的」与机器状态页已有说法，不新开办理。 */
const EXITS: { title: string; sub: string; to: string; icon: QxTouchIconName }[] = [
  { title: '我的记录', sub: '简历、文档和打印订单', to: '/profile', icon: 'clipboard' },
  { title: '帮助与求助', sub: '常见问题与服务电话', to: '/help', icon: 'help' },
  { title: '回首页', sub: '不开始新的办理', to: '/', icon: 'home' },
]

export function WindDownBlockedScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const { endsAt } = useKioskLicense()
  const remaining = endsAt ? Date.parse(endsAt) - Date.now() : NaN
  const goBack = () => {
    if (window.history.length <= 1 || location.key === 'default') navigate('/', { replace: true })
    else navigate(-1)
  }
  return (
    <div className="fusion-w5 fusion-w5--system k9-system-state" data-kiosk-screen="license-wind-down-blocked" data-kiosk-viewport="kiosk">
      <KioskStageFit>
        <PublicTouchFrame
          page="offline"
          main
          title={LICENSE_NO_NEW_TASK_REASON}
          eyebrow="机器状态"
          status={{ tone: 'warn', label: '即将暂停' }}
          back={false}
          nav={false}
          dock={(
            <footer className="qxt-dock">
              <button type="button" className="qxt-btn qxt-btn-sec qxt-fill" onClick={goBack}>返回</button>
              <button type="button" className="qxt-btn qxt-btn-pri qxt-fill" onClick={() => navigate('/')}>回首页</button>
            </footer>
          )}
        >
          <div className="of-page">
            {Number.isFinite(remaining) && <p className="qxp-note of-truth">{licenseWindDownLine(Math.max(1, Math.ceil(remaining / 60_000)))}</p>}
            <h2 className="qxt-sec" id="wind-down-exits">现在可以做的<small>都不开始新的办理</small></h2>
            <ul className="of-list of-actions" aria-labelledby="wind-down-exits">
              {EXITS.map((item) => (
                <li key={item.to}>
                  <Hit
                    className="of-row"
                    icon={<QxTouchIcon name={item.icon} size={30} />}
                    title={item.title}
                    sub={item.sub}
                    chevron
                    onClick={() => navigate(item.to)}
                  />
                </li>
              ))}
            </ul>
          </div>
        </PublicTouchFrame>
      </KioskStageFit>
    </div>
  )
}
