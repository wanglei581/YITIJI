import { machineUnusableLine } from '../copy/unattendedCopy'
import { useSupportContactSnapshot } from '../hooks/useSupportContact'
import { KioskStageFit } from './kiosk-shell/KioskStageFit'
import { PublicTouchFrame } from '../pages/public-touch/PublicTouchFrame'
import '../pages/placeholders/system-state-qx.css'
import '../pages/placeholders/offline-touch.css'

/**
 * 暂停就是不能开始新的办理，所以副标题不看授权提示（notice）：进暂停时的结束使用清场会整页重载，
 * 重载后凭证可能已过期，读回来的机器资料是「没验过」、没有提示，按提示决定会让副标题从屏上消失。
 */
export function KioskPausedScreen() {
  const contact = useSupportContactSnapshot()
  return (
    <div className="fusion-w5 fusion-w5--system k9-system-state" data-kiosk-screen="license-paused" data-kiosk-viewport="kiosk">
      <KioskStageFit>
        <PublicTouchFrame page="offline" main title="暂停服务" eyebrow="机器状态" sub="现在不能开始新的办理" status={{ tone: 'warn', label: '暂停服务' }} back={false} nav={false}>
          <div className="of-page">
            <p className="qxp-note of-truth">{machineUnusableLine(contact)}</p>
          </div>
        </PublicTouchFrame>
      </KioskStageFit>
    </div>
  )
}
