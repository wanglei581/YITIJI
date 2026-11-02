import { machineUnusableLine } from '../copy/unattendedCopy'
import { useSupportContactSnapshot } from '../hooks/useSupportContact'
import { KioskStageFit } from './kiosk-shell/KioskStageFit'
import { PublicTouchFrame } from '../pages/public-touch/PublicTouchFrame'
import '../pages/placeholders/system-state-qx.css'
import '../pages/placeholders/offline-touch.css'

export function KioskPausedScreen({ notice }: { notice: string | null }) {
  const contact = useSupportContactSnapshot()
  return (
    <div className="fusion-w5 fusion-w5--system k9-system-state" data-kiosk-screen="license-paused" data-kiosk-viewport="kiosk">
      <KioskStageFit>
        <PublicTouchFrame page="offline" main title="暂停服务" eyebrow="机器状态" sub={notice ? '现在不能开始新的办理' : ''} status={{ tone: 'warn', label: '暂停服务' }} back={false} nav={false}>
          <div className="of-page">
            <p className="qxp-note of-truth">{machineUnusableLine(contact)}</p>
          </div>
        </PublicTouchFrame>
      </KioskStageFit>
    </div>
  )
}
