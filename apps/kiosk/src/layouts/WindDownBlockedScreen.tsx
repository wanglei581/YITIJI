import { useNavigate } from 'react-router-dom'
import { KioskStageFit } from '../components/kiosk-shell/KioskStageFit'
import { LICENSE_NO_NEW_TASK_REASON, licenseWindDownLine } from '../copy/unattendedCopy'
import { PublicTouchFrame } from '../pages/public-touch/PublicTouchFrame'
import { useKioskLicense } from './KioskLicenseContext'
import '../pages/placeholders/system-state-qx.css'
import '../pages/placeholders/offline-touch.css'

export function WindDownBlockedScreen() {
  const navigate = useNavigate()
  const { endsAt } = useKioskLicense()
  const remaining = endsAt ? Date.parse(endsAt) - Date.now() : NaN
  return (
    <div className="fusion-w5 fusion-w5--system k9-system-state" data-kiosk-screen="license-wind-down-blocked" data-kiosk-viewport="kiosk">
      <KioskStageFit>
        <PublicTouchFrame page="offline" main title={LICENSE_NO_NEW_TASK_REASON} back={false} nav={false}>
          <div className="of-page">
            {Number.isFinite(remaining) && <p className="qxp-note of-truth">{licenseWindDownLine(Math.max(1, Math.ceil(remaining / 60_000)))}</p>}
            <button type="button" className="qxt-btn qxt-btn-sec" style={{ minHeight: 56 }} onClick={() => navigate(-1)}>返回</button>
            <button type="button" className="qxt-btn qxt-btn-pri" style={{ minHeight: 56 }} onClick={() => navigate('/')}>回首页</button>
          </div>
        </PublicTouchFrame>
      </KioskStageFit>
    </div>
  )
}
