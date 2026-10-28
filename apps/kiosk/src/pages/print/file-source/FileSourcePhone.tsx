// 选文件页「手机扫码上传」各态的正文（稿 upload）：二维码、三步、等待与已收到、取消与过期。
// 两种出错——二维码没出来、确认没成功——在 FileSourceError.tsx 的出错板件里，不在这里。
// 只画传进来的状态，不发请求；轮询与确认在 PrintUploadPage / useUploadSession。

import { QRCodeSVG } from 'qrcode.react'
import { InfoIcon, Loader2Icon } from 'lucide-react'
import { QxTouchCallout } from '../../../components/qingxu/touch/QxTouchCallout'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import type { FileSourceScreen, PhoneSessionView, UploadTab } from './fileSourceModel'
import { ChannelGrid, FileRow } from './FileSourceBits'

function PhoneQrSlot({
  qrUrl,
  loading,
  expiresLabel,
  inactive = false,
}: {
  qrUrl: string | null
  loading: boolean
  expiresLabel: string
  inactive?: boolean
}) {
  if (inactive) {
    return <div className="fs-qr-blank" data-testid="file-source-qr"><InfoIcon size={38} aria-hidden="true" /><strong>这张上传码已失效</strong><span>旧码不再接收文件，请重新出一张码。</span></div>
  }
  if (qrUrl) {
    return (
      <div className="fs-qr-live" data-testid="file-source-qr">
        <QRCodeSVG value={qrUrl} size={360} level="M" marginSize={1} />
        <span>
          {expiresLabel && !expiresLabel.includes('NaN')
            ? `二维码有效期 ${expiresLabel}。单份不超过 10MB。`
            : '二维码有效期从生成时起算，10 分钟。单份不超过 10MB。'}
        </span>
      </div>
    )
  }
  return (
    <div className="fs-qr-blank" data-testid="file-source-qr">
      {loading ? <Loader2Icon size={36} aria-hidden="true" /> : null}
      <strong>码还没出来</strong>
      <span>正在准备上传二维码，请稍候。</span>
    </div>
  )
}

const PHONE_STEPS = [
  { title: '扫码', detail: '相机或微信' },
  { title: '在手机上选文件、点上传', detail: 'PDF、JPG、PNG' },
  { title: '回到这台机器点确认', detail: '确认前不会进入下一步' },
] as const

export function PhoneBoard({
  screen,
  phone,
  qrUrl,
  expiresLabel,
  channelKeys,
  usbMode,
  helpText,
  onSelectChannel,
}: {
  screen: FileSourceScreen
  phone: PhoneSessionView
  qrUrl: string | null
  expiresLabel: string
  channelKeys: UploadTab[]
  usbMode: 'ok' | 'unavailable' | 'offline'
  helpText: string
  onSelectChannel: (key: UploadTab) => void
}) {
  const received = ['phone-uploaded', 'phone-confirming', 'phone-cancel-requesting', 'phone-cancel-failed'].includes(screen)
  const showQr = !received
  const waiting = screen === 'phone-ready' || screen === 'phone-waiting' || screen === 'phone-generating' || screen === 'phone-uploading'
  const liveText = received
    ? (screen === 'phone-uploaded'
      ? '系统已收到，等你确认'
      : screen === 'phone-confirming'
        ? '确认结果回来前，这份还没有进入本次办理。'
        : screen === 'phone-cancel-requesting'
          ? '取消结果回来前，这份仍然挂着，不说已经作废。'
          : '取消没有确认成功，这份仍留着等你决定。')
    : '等你在手机上传文件 · 传好后会显示在下面，再点确认'
  return (
    <>
      {showQr ? (
        <PhoneQrSlot
          qrUrl={qrUrl}
          loading={phone.loading}
          expiresLabel={expiresLabel}
          inactive={screen === 'phone-expired' || screen === 'phone-cancelled'}
        />
      ) : null}
      {waiting || received ? (
        <div className="qxt-steps fs-phone-steps">
          {PHONE_STEPS.map((step, index) => (
            <div className="qxt-step" key={step.title} data-state={received ? (index < 2 ? 'done' : 'now') : undefined}>
              <span className="qxt-step-n">{index + 1}</span>
              <b>{step.title}</b>
              <small>{step.detail}</small>
            </div>
          ))}
        </div>
      ) : null}
      {waiting || received ? (
        <div className="fs-live" role="status">
          {received ? <QxTouchIcon name="check" size={36} strokeWidth={2.4} /> : <span className="fs-spin" aria-hidden="true" />}
          <b>{liveText}</b>
        </div>
      ) : null}
      {screen === 'phone-status-unknown' ? (
        <QxTouchCallout kind="remind" icon="alert">暂时查不到结果，不代表二维码已经过期。可以再查一次，或重新出一张码。</QxTouchCallout>
      ) : null}
      {screen === 'phone-expired' || screen === 'phone-cancelled' ? (
        <QxTouchCallout kind="howto">重新出码会建立新的上传，旧码不再收文件。</QxTouchCallout>
      ) : null}
      {waiting || received ? (
        <div className={`fs-drop${phone.pendingName ? ' fs-drop-got' : ''}`}>
          {phone.pendingName ? (
            <FileRow
              name={phone.pendingName}
              meta={`${phone.pendingSize ?? ''} · 手机扫码上传`}
              tag=""
              tagTone="doing"
              mark="PDF"
              testId="file-source-phone-file"
            />
          ) : (
            <>
              <QxTouchIcon name="file" size={40} strokeWidth={1.8} />
              <span className="fs-placeholder">传好的文件会出现在这里</span>
            </>
          )}
        </div>
      ) : null}
      {screen === 'phone-uploaded' ? (
        <QxTouchCallout kind="fine">请核对文件名和大小。在这台机器上确认后，才能继续材料检查。确认前它还不是当前文件。</QxTouchCallout>
      ) : null}
      {screen === 'phone-cancel-failed' ? (
        <QxTouchCallout kind="remind" icon="alert">取消未成功，旧二维码可能仍有效。可以重试取消，或确认使用这份文件。</QxTouchCallout>
      ) : null}
      {screen === 'phone-uploading' ? (
        <QxTouchCallout kind="fine">请保持手机上传页面打开，传完后回来确认文件。本机看不到你扫没扫，只认系统收到文件。</QxTouchCallout>
      ) : null}
      {waiting && screen !== 'phone-uploading' ? (
        <QxTouchCallout kind="fine">本机看不到你扫没扫，只认系统收到文件。</QxTouchCallout>
      ) : null}
      {screen === 'phone-cancelled' || screen === 'phone-generating' ? (
        <ChannelGrid keys={channelKeys} active={screen === 'phone-cancelled' ? 'qr' : null} usbMode={usbMode} onSelect={onSelectChannel} />
      ) : null}
      {helpText ? <QxTouchCallout kind="remind">{helpText}</QxTouchCallout> : null}
    </>
  )
}
