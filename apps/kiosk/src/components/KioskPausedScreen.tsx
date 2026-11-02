import { QxTouchIcon, type QxTouchIconName } from './qingxu/touch/QxTouchIcon'
import { KioskStageFit } from './kiosk-shell/KioskStageFit'
import { MINIAPP_DISPLAY_NAME } from '../copy/miniappLinkCopy'
import { machineUnusableLine, whenMiniapp, type PublicSupportContact } from '../copy/unattendedCopy'
import { useSupportContactSnapshot } from '../hooks/useSupportContact'
import { ArtBox, Card } from '../pages/public-touch/PublicBlocks'
import { IllusMachine } from '../pages/public-touch/PublicIllus'
import { PublicTouchFrame } from '../pages/public-touch/PublicTouchFrame'
import '../pages/placeholders/system-state-qx.css'
import '../pages/placeholders/offline-touch.css'

/**
 * 暂停就是不能开始新的办理，所以副标题不看授权提示（notice）：进暂停时的结束使用清场会整页重载，
 * 重载后凭证可能已过期，读回来的机器资料是「没验过」、没有提示，按提示决定会让副标题从屏上消失。
 * 整机不能办：这一屏不放任何按钮或链接。
 */

/** 机器状态稿上的状态卡（k9s-cap）。整句放在名称上，不退成 of-truth 那种一行小字。 */
function FactCard({
  tone,
  icon,
  title,
  detail,
  status = false,
}: {
  tone: 'clay' | 'slate'
  icon: QxTouchIconName
  title: string
  detail?: string
  status?: boolean
}) {
  return (
    <div className="k9s-cap" role={status ? 'status' : undefined}>
      <span className="k9s-ic" data-tone={tone} aria-hidden="true"><QxTouchIcon name={icon} size={32} /></span>
      <span className="k9s-cap-main">
        <span className="k9s-cap-name">{title}</span>
        {detail ? <span className="k9s-cap-dep">{detail}</span> : null}
      </span>
    </div>
  )
}

/** 小程序未发布时为空串，调用方不画这一块。 */
function recordsOnPhone(contact: PublicSupportContact): string {
  return whenMiniapp(contact, `打开${MINIAPP_DISPLAY_NAME}小程序「我的」，记录都在。`)
}

export function KioskPausedScreen() {
  const contact = useSupportContactSnapshot()
  const onPhone = recordsOnPhone(contact)
  return (
    <div className="fusion-w5 fusion-w5--system k9-system-state" data-kiosk-screen="license-paused" data-kiosk-viewport="kiosk">
      <KioskStageFit>
        <PublicTouchFrame page="offline" main title="暂停服务" eyebrow="机器状态" sub="现在不能开始新的办理" status={{ tone: 'warn', label: '暂停服务' }} back={false} nav={false}>
          <div className="of-page">
            <FactCard tone="clay" icon="call" status title={machineUnusableLine(contact)} />
            {onPhone ? <FactCard tone="slate" icon="phone" title="在手机上也能看" detail={onPhone} /> : null}
            <Card className="of-machine">
              <ArtBox><IllusMachine /></ArtBox>
            </Card>
          </div>
        </PublicTouchFrame>
      </KioskStageFit>
    </div>
  )
}
