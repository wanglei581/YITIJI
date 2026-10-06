import { CloudUploadIcon, SmartphoneIcon, UsbIcon } from 'lucide-react'
import { KIOSK_LOCAL_FILE_UNAVAILABLE_REASON, type UploadChannel } from './resumeSourceModel'

interface ResumeSourceCardsProps {
  kiosk: boolean
  selected: UploadChannel
  busy: boolean
  usbLocked: boolean
  usbNote: string | null
  onSelect: (channel: UploadChannel) => void
  onRetryUsb: () => void
  showUsbRetry: boolean
}

/** 三张来源卡。一体机上「本机文件」照稿留着，但置灰且点了没有反应。 */
export function ResumeSourceCards({
  kiosk, selected, busy, usbLocked, usbNote, onSelect, onRetryUsb, showUsbRetry,
}: ResumeSourceCardsProps) {
  const cards: Array<{ type: UploadChannel; label: string; title: string; description: string; helper: string; icon: typeof UsbIcon }> = [
    {
      type: 'usb',
      label: 'U盘上传',
      title: 'U 盘',
      description: '从已插入的 U 盘里选一份简历',
      helper: '只读取你点中的那一份',
      icon: UsbIcon,
    },
    {
      type: 'cloud',
      label: '本机文件',
      title: '本机文件',
      description: '从本机下载目录里选一份简历',
      helper: '不会保存你的云盘账号',
      icon: CloudUploadIcon,
    },
    {
      type: 'phone',
      label: '手机扫码上传',
      title: '手机扫码上传',
      description: '用手机扫码选择简历，再回到这里确认',
      helper: '手机传完，在这里确认',
      icon: SmartphoneIcon,
    },
  ]
  return (
    <section className="qx-rt-pick" aria-labelledby="qx-rt-pick-h" data-testid="resume-source-cards">
      <h2 className="qx-rt-sec-h" id="qx-rt-pick-h">简历文件从哪儿来 <small>点一下直接进这条通道</small></h2>
      <div className="qx-rt-srcs" role="group" aria-label="选择简历来源">
        {cards.map((card) => {
          const kioskLocal = kiosk && card.type === 'cloud'
          const locked = kioskLocal || (card.type === 'usb' && usbLocked)
          const Icon = card.icon
          return (
            <button
              type="button"
              key={card.type}
              className="qx-rt-src"
              aria-label={card.label}
              aria-pressed={selected === card.type}
              data-testid={card.type === 'cloud' ? 'resume-local-file-card' : undefined}
              data-unavailable={kioskLocal ? 'kiosk' : undefined}
              disabled={busy || locked}
              onClick={() => {
                if (busy || locked) return
                onSelect(card.type)
              }}
            >
              <span className="ico"><Icon className="h-8 w-8" /></span>
              <span className="n">{card.title}</span>
              <span className="d">{card.description}</span>
              <span className="go">
                {kioskLocal ? KIOSK_LOCAL_FILE_UNAVAILABLE_REASON : card.type === 'usb' && usbLocked ? (usbNote ?? '暂时不能用') : card.helper}
              </span>
            </button>
          )
        })}
      </div>
      {showUsbRetry ? (
        <button type="button" className="qx-btn" data-variant="ghost" data-testid="resume-usb-retry" onClick={onRetryUsb}>
          重新检查
        </button>
      ) : null}
    </section>
  )
}
